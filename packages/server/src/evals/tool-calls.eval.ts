import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Layer, Logger, References, Ref, Stream } from "effect";
import { LanguageModel, Response } from "effect/unstable/ai";
import { AgentHarness, AgentSession } from "../domain/agents/harness/index.ts";
import { makeMaterialCommands } from "../domain/agents/academic-tutor/material-commands.ts";
import { AcademicTutorSkills } from "../domain/agents/academic-tutor/skills/index.ts";
import { MaterialNotFound, MaterialRepository, type PdfMaterial } from "../domain/materials/material.ts";
import { classifyFailure, promptContents, requestBody, skipThoughtSignature, toResponseParts } from "../infra/agents/gemini-language-model.ts";
import { describeModelFailure } from "../domain/agents/harness/session.ts";

/**
 * Deterministic eval (no API calls): the tool-call protocol between the harness
 * and the Gemini adapter.
 *
 * Regression guarded: tool calls were rendered back to the model as assistant
 * text (`Tool call cli: {...}`), and the model learned to answer with that text
 * instead of calling the tool. The history must use native tool-call and
 * tool-result parts, and the adapter must send them as Gemini `functionCall` /
 * `functionResponse` parts.
 *
 *   pnpm --filter @proxus/server run eval:tutor:tool-calls
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

// --- Fixtures ----------------------------------------------------------------

const fixtureMaterial: PdfMaterial = {
  id: "algebra-basica",
  title: "Algebra basica",
  fileName: "algebra-basica.pdf",
  pageCount: 12,
  uploadedAt: "2026-01-01T00:00:00.000Z"
};

const FixtureMaterialRepository = Layer.succeed(MaterialRepository, {
  list: () => Effect.succeed([fixtureMaterial]),
  get: (id) => id === fixtureMaterial.id
    ? Effect.succeed(fixtureMaterial)
    : Effect.fail(new MaterialNotFound({ materialId: id })),
  renderPages: (materialId) => Effect.fail(new MaterialNotFound({ materialId })),
  save: () => Effect.die("material repository save is not used by this eval"),
  remove: () => Effect.die("material repository remove is not used by this eval")
});

const makeHarness = (materialRepository: MaterialRepository) => AgentHarness.make({
  name: "You are a test tutor.",
  skills: AcademicTutorSkills,
  commands: [makeMaterialCommands(materialRepository)]
});

/**
 * Scripted model: step 1 calls `cli materials list`; step 2 records the prompt
 * it received and answers with text. This is what a real model sees on its
 * second step after the harness executed the tool.
 */
const makeScriptedModel = (received: Ref.Ref<readonly LanguageModel.ProviderOptions[]>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) => Effect.gen(function* () {
        const seen = yield* Ref.get(received);
        yield* Ref.update(received, (all) => [...all, options]);

        if (seen.length === 0) {
          return [
            Response.makePart("tool-call", {
              id: "call_1",
              name: "cli",
              params: { input: "materials list" },
              providerExecuted: false
            })
          ];
        }

        return [Response.makePart("text", { text: "You have one material: algebra-basica." })];
      }),
      streamText: () => { throw new Error("not used"); }
    })
  );

// --- Trace capture -------------------------------------------------------------

interface TraceLine {
  readonly message: string;
  readonly level: string;
  readonly annotations: Record<string, unknown>;
}

const captureLogger = (lines: TraceLine[]) =>
  Logger.make((options) => {
    lines.push({
      message: Array.isArray(options.message) ? options.message.map(String).join(" ") : String(options.message),
      level: options.logLevel,
      annotations: { ...options.fiber.getRef(References.CurrentLogAnnotations) }
    });
  });

// --- Case 1: the harness renders tool history as native parts -----------------

const harnessHistoryCase = Effect.gen(function* () {
  const received = yield* Ref.make<readonly LanguageModel.ProviderOptions[]>([]);
  const materialRepository = yield* MaterialRepository;
  const harness = makeHarness(materialRepository);
  const session = AgentSession.make(harness);
  const trace: TraceLine[] = [];

  const result = yield* session.run({ input: "List my materials", maxSteps: 4 }).pipe(
    Effect.provide(Layer.mergeAll(harness.layer, makeScriptedModel(received), Logger.layer([captureLogger(trace)])))
  );

  const traceEvents = trace.map((line) => line.annotations["agent.event"]);
  const toolLine = trace.find((line) => line.annotations["agent.event"] === "tool.call" && line.annotations["agent.tool"] === "cli");
  const turnIds = new Set(trace.filter((line) => typeof line.annotations["agent.event"] === "string").map((line) => line.annotations["agent.turn"]));

  const prompts = yield* Ref.get(received);
  const secondPrompt = prompts[1];
  const messages = secondPrompt?.prompt.content ?? [];

  const assistantToolCall = messages.find((message) =>
    message.role === "assistant"
    && typeof message.content !== "string"
    && message.content.some((part) => part.type === "tool-call" && part.name === "cli" && part.id === "call_1")
  );
  const toolResult = messages.find((message) =>
    message.role === "tool"
    && message.content.some((part) => part.type === "tool-result" && part.name === "cli" && part.id === "call_1" && !part.isFailure)
  );
  const textParts = messages.flatMap((message) =>
    typeof message.content === "string"
      ? [message.content]
      : message.content.flatMap((part) => part.type === "text" ? [part.text] : [])
  );
  const leakedToolText = textParts.filter((text) => /^Tool (call|result) /.test(text));

  const toolMessageIds = result.messages.flatMap((message) =>
    message.role === "tool-call" || message.role === "tool-result" ? [message.id] : []
  );
  const idsPaired = toolMessageIds.length === 2 && toolMessageIds.every((id) => id === "call_1");

  return [
    criterion("model-was-called-twice", prompts.length === 2, `model calls: ${prompts.length}`),
    criterion("history-has-native-tool-call-part", assistantToolCall !== undefined, "assistant message with tool-call part id=call_1"),
    criterion("history-has-native-tool-result-part", toolResult !== undefined, "tool message with tool-result part id=call_1"),
    criterion("no-tool-text-in-history", leakedToolText.length === 0, leakedToolText.length === 0 ? "no 'Tool call/result' text parts" : `leaked: ${leakedToolText.join(" | ")}`),
    criterion("session-messages-carry-ids", idsPaired, "tool-call and tool-result messages share id call_1"),
    criterion("final-answer-is-text", result.output === "You have one material: algebra-basica.", `output: ${result.output}`),
    criterion("trace-has-turn-model-tool-events",
      traceEvents.includes("turn.started") && traceEvents.filter((event) => event === "model.call").length === 2 && traceEvents.includes("turn.finished"),
      `events: ${traceEvents.filter(Boolean).join(" > ")}`),
    criterion("trace-tool-call-has-duration-and-input",
      toolLine !== undefined && typeof toolLine.annotations["agent.durationMs"] === "number" && String(toolLine.annotations["agent.input"]).includes("materials list"),
      `tool line: ${JSON.stringify(toolLine?.annotations)}`),
    criterion("trace-lines-share-one-turn-id", turnIds.size === 1 && typeof [...turnIds][0] === "string", `turn ids: ${[...turnIds].join(",")}`),
    ...(secondPrompt === undefined ? [] : geminiRequestCriteria(secondPrompt))
  ];
});

// --- Case 2: the adapter maps parts to Gemini function calling ---------------

const geminiRequestCriteria = (options: LanguageModel.ProviderOptions): readonly CriterionResult[] => {
  const body = requestBody(options);
  const contents = promptContents(options.prompt);

  const modelTurn = contents.find((content) =>
    content.role === "model" && content.parts.some((part) => "functionCall" in part && part.functionCall.name === "cli" && part.functionCall.args.input === "materials list")
  );
  const signatureFallback = modelTurn?.parts.some((part) => "functionCall" in part && part.thoughtSignature === skipThoughtSignature) ?? false;
  const responseTurn = contents.find((content) =>
    content.role === "user" && content.parts.some((part) => "functionResponse" in part && part.functionResponse.name === "cli")
  );
  const alternates = contents.every((content, index) => index === 0 || contents[index - 1]?.role !== content.role);

  const declarations = body.tools[0]?.functionDeclarations ?? [];
  const cli = declarations.find((declaration) => declaration.name === "cli");
  const cliParameters = cli?.parameters as { properties?: Record<string, unknown>; additionalProperties?: unknown } | undefined;
  const declaredFromSchema = cliParameters?.properties?.input !== undefined && cliParameters.additionalProperties === undefined;

  return [
    criterion("gemini-model-turn-has-functionCall", modelTurn !== undefined, "model turn with functionCall cli(input: materials list)"),
    criterion("gemini-user-turn-has-functionResponse", responseTurn !== undefined, "user turn with functionResponse cli"),
    criterion("gemini-turns-alternate-roles", alternates, `roles: ${contents.map((content) => content.role).join(" > ")}`),
    criterion("gemini-declarations-from-tool-schema", declaredFromSchema, "cli declaration has properties.input and no additionalProperties"),
    criterion("gemini-functionCall-without-signature-uses-skip-placeholder", signatureFallback, "scripted call carries the documented skip placeholder")
  ];
};

// --- Case 2b: the stream emits typed progress before the tool result ----------

const streamEventsCase = Effect.gen(function* () {
  const received = yield* Ref.make<readonly LanguageModel.ProviderOptions[]>([]);
  const materialRepository = yield* MaterialRepository;
  const harness = makeHarness(materialRepository);
  const events = yield* AgentSession.make(harness).stream({ input: "List my materials", maxSteps: 4 }).pipe(
    Stream.provide(Layer.mergeAll(harness.layer, makeScriptedModel(received))),
    Stream.runCollect
  );

  const types = events.map((event) => event.type === "message" ? `message:${event.message.role}` : event.type);
  const progressIndex = types.indexOf("progress");
  const resultIndex = types.indexOf("message:tool-result");
  const progressLabel = events.find((event) => event.type === "progress");

  return [
    criterion("stream-emits-progress-before-tool-result", progressIndex !== -1 && resultIndex !== -1 && progressIndex < resultIndex, `events: ${types.join(" > ")}`),
    criterion("stream-progress-label-is-readable", progressLabel?.type === "progress" && progressLabel.label === "Consultando tus materiales", `label: ${progressLabel?.type === "progress" ? progressLabel.label : "-"}`)
  ];
});

// --- Case 3: the adapter parses every function call in a response ------------

const geminiResponseCase = Effect.sync(() => {
  const options = { tools: [{ name: "cli" }, { name: "load_skill" }] } as unknown as LanguageModel.ProviderOptions;
  const parts = toResponseParts([
    { text: "thinking...", thought: true },
    { functionCall: { name: "cli", args: { input: "materials list" } }, thoughtSignature: "sig-abc" },
    { functionCall: { name: "cli", args: { input: "materials view algebra-basica 1" } } },
    { functionCall: { name: "use-uploaded-materials", args: {} } }
  ], options.tools);

  const toolCalls = parts.filter((part) => part.type === "tool-call");
  const redirected = toolCalls.find((part) => part.type === "tool-call" && part.name === "load_skill");
  const redirectedParams = redirected !== undefined && redirected.type === "tool-call"
    ? (redirected.params as { name?: string }).name
    : undefined;

  const first = toolCalls[0];
  const signature = first !== undefined && first.type === "tool-call"
    ? ((first.metadata as { google?: { thoughtSignature?: string } } | undefined)?.google?.thoughtSignature)
    : undefined;
  const replayed = promptContents({ content: [{
    role: "assistant",
    content: [{ type: "tool-call", id: "call_x", name: "cli", params: { input: "materials list" }, providerExecuted: false, options: { google: { thoughtSignature: "sig-abc" } } }]
  }] } as unknown as LanguageModel.ProviderOptions["prompt"]);
  const replayedSignature = replayed[0]?.parts.some((part) => "functionCall" in part && part.thoughtSignature === "sig-abc") ?? false;

  return [
    criterion("parses-parallel-function-calls", toolCalls.length === 3, `tool-call parts: ${toolCalls.length}`),
    criterion("keeps-thought-signature-in-metadata", signature === "sig-abc", `metadata.google.thoughtSignature: ${signature}`),
    criterion("replays-thought-signature-on-functionCall", replayedSignature, "tool-call part options.google.thoughtSignature -> functionCall thoughtSignature"),
    criterion("drops-thought-parts", parts.every((part) => part.type !== "text"), "no text part from thought"),
    criterion("redirects-skill-name-to-load_skill", redirectedParams === "use-uploaded-materials", `load_skill params.name: ${redirectedParams}`)
  ];
});

// --- Case 4: provider failures are classified and explained --------------------

const providerFailureCase = Effect.sync(() => {
  const dailyQuota = JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota.\n* Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\nPlease retry in 59s.",
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }]
    }
  });
  const perMinute = JSON.stringify({ error: { code: 429, message: "Rate limit", status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] } });

  const daily = describeModelFailure(classifyFailure(429, dailyQuota, "gemini-3.6-flash"));
  const minute = describeModelFailure(classifyFailure(429, perMinute, "gemini-3.6-flash"));
  const overloaded = describeModelFailure(classifyFailure(503, "{\"error\":{\"message\":\"high demand\"}}", "gemini-3.6-flash"));
  const auth = describeModelFailure(classifyFailure(403, "{\"error\":{\"message\":\"API key not valid\"}}", "gemini-3.6-flash"));

  return [
    criterion("daily-quota-not-retryable-and-explained", !daily.retryable && daily.message.includes("cuota diaria") && daily.message.includes("gemini-3.6-flash"), daily.message),
    criterion("per-minute-limit-retryable", minute.retryable && minute.message.includes("por minuto"), minute.message),
    criterion("overload-retryable", overloaded.retryable && overloaded.message.includes("saturado"), overloaded.message),
    criterion("auth-error-not-retryable", !auth.retryable && auth.message.includes("clave"), auth.message)
  ];
});

// --- Runner ------------------------------------------------------------------

class ToolCallsEvalFailed extends Data.TaggedError("ToolCallsEvalFailed")<{}> {}

export const toolCallsEval = Effect.gen(function* () {
  const results = [
    ...(yield* harnessHistoryCase.pipe(Effect.provide(FixtureMaterialRepository))),
    ...(yield* streamEventsCase.pipe(Effect.provide(FixtureMaterialRepository))),
    ...(yield* geminiResponseCase),
    ...(yield* providerFailureCase)
  ];

  const lines = ["academic-tutor.tool-calls"];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new ToolCallsEvalFailed();
  }

  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(toolCallsEval);
}
