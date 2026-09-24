import { Config, Data, Duration, Effect, Layer, Redacted, Schema, Stream } from "effect";
import {
  AiError,
  LanguageModel,
  Model as AiModel,
  Response,
  Tool
} from "effect/unstable/ai";
import { emitProgress, emitTextDelta } from "../../domain/agents/harness/event.ts";

/**
 * Gemini adapter for the Effect AI `LanguageModel` service.
 *
 * Infrastructure: talks to the Google Generative Language REST API with the
 * native `fetch`. It maps Effect AI prompt parts to Gemini content parts,
 * including tool calls (`functionCall`) and tool results (`functionResponse`),
 * and declares tools from their JSON schema.
 */

const defaultModel = "gemini-3.5-flash";

const FunctionCall = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
});

const GeminiPart = Schema.Struct({
  text: Schema.optional(Schema.String),
  thought: Schema.optional(Schema.Boolean),
  thoughtSignature: Schema.optional(Schema.String),
  functionCall: Schema.optional(FunctionCall)
});

const GeminiResponse = Schema.Struct({
  candidates: Schema.optional(Schema.Array(Schema.Struct({
    content: Schema.optional(Schema.Struct({
      parts: Schema.optional(Schema.Array(GeminiPart))
    })),
    finishReason: Schema.optional(Schema.String)
  }))),
  promptFeedback: Schema.optional(Schema.Struct({
    blockReason: Schema.optional(Schema.String)
  }))
});

type GeminiResponse = typeof GeminiResponse.Type;

/**
 * Why a successful HTTP response carries nothing the harness can use (no text,
 * no function call), when the provider says so. `STOP` with empty parts is
 * left to the harness, which asks the model again.
 */
export const emptyResponseReason = (json: GeminiResponse): string | undefined => {
  const blockReason = json.promptFeedback?.blockReason;
  if (blockReason !== undefined) {
    return `the provider blocked the prompt (${blockReason})`;
  }
  switch (json.candidates?.[0]?.finishReason) {
    case "MAX_TOKENS":
      return "the model ran out of output tokens before answering (MAX_TOKENS), usually because it spent them thinking";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
    case "SPII":
      return `the provider withheld the answer (${json.candidates?.[0]?.finishReason})`;
    case "RECITATION":
      return "the provider withheld the answer because it matched copyrighted text (RECITATION)";
    case "MALFORMED_FUNCTION_CALL":
      return "the model produced a malformed function call (MALFORMED_FUNCTION_CALL)";
    default:
      return undefined;
  }
};

type GeminiPart = typeof GeminiPart.Type;

class GeminiConfigError extends Data.TaggedError("GeminiConfigError")<{
  readonly reason: string;
}> {}

const GeminiConfig = Effect.gen(function* () {
  const apiKey = yield* Config.redacted("GOOGLE_GENERATIVE_AI_API_KEY");
  const model = yield* Config.string("GEMINI_MODEL").pipe(
    Config.orElse(() => Config.succeed(defaultModel))
  );

  const apiKeyValue = Redacted.value(apiKey).trim();

  if (apiKeyValue.length === 0) {
    return yield* new GeminiConfigError({ reason: "Missing GOOGLE_GENERATIVE_AI_API_KEY" });
  }

  return {
    apiKey: apiKeyValue,
    model: model.trim().length === 0 ? defaultModel : model.trim()
  };
});

const toAiError = (description: string) =>
  AiError.make({
    module: "GeminiLanguageModel",
    method: "generateText",
    reason: new AiError.UnknownError({ description })
  });

// ---------------------------------------------------------------------------
// Prompt -> Gemini request
// ---------------------------------------------------------------------------

export type GeminiContentPart =
  | { readonly text: string }
  | { readonly inlineData: { readonly mimeType: string; readonly data: string } }
  | { readonly functionCall: { readonly name: string; readonly args: Record<string, unknown> }; readonly thoughtSignature: string }
  | { readonly functionResponse: { readonly name: string; readonly response: Record<string, unknown> } };

export interface GeminiContent {
  readonly role: "user" | "model";
  readonly parts: readonly GeminiContentPart[];
}

type PromptMessage = LanguageModel.ProviderOptions["prompt"]["content"][number];

const messageText = (message: PromptMessage) =>
  messageParts(message).flatMap((part) => "text" in part ? [part.text] : []).join("\n");

const messageParts = (message: PromptMessage): readonly GeminiContentPart[] => {
  if (typeof message.content === "string") {
    return [{ text: message.content }];
  }

  return message.content.flatMap((part): readonly GeminiContentPart[] => {
    switch (part.type) {
      case "text":
        return [{ text: part.text }];
      case "file": {
        const data = fileDataToBase64(part.data);
        return data === undefined
          ? []
          : [{ inlineData: { mimeType: part.mediaType, data } }];
      }
      case "tool-call":
        return [{
          functionCall: { name: part.name, args: toRecord(part.params) },
          thoughtSignature: thoughtSignatureOf(part.options)
        }];
      case "tool-result":
        return [{ functionResponse: { name: part.name, response: toFunctionResponse(part.result, part.isFailure) } }];
      default:
        return [];
    }
  });
};

/**
 * Gemini 2.5 (thinking models) returns a `thoughtSignature` with each function
 * call and requires it back when the call is replayed in the history. The
 * harness stores it in the tool-call message metadata under `google`. When a
 * call has no signature (scripted history, parallel calls after the first),
 * Google documents this placeholder to skip validation.
 */
export const skipThoughtSignature = "skip_thought_signature_validator";

const thoughtSignatureOf = (options: Record<string, unknown> | undefined): string => {
  const google = options?.google;
  const signature = typeof google === "object" && google !== null
    ? (google as Record<string, unknown>).thoughtSignature
    : undefined;

  return typeof signature === "string" && signature.length > 0 ? signature : skipThoughtSignature;
};

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

// Gemini requires `functionResponse.response` to be a JSON object.
const toFunctionResponse = (result: unknown, isFailure: boolean): Record<string, unknown> => {
  if (isFailure) {
    return { error: result === undefined ? "Tool failed" : result };
  }

  return typeof result === "object" && result !== null && !Array.isArray(result)
    ? result as Record<string, unknown>
    : { result: result === undefined ? null : result };
};

const fileDataToBase64 = (data: string | Uint8Array | URL) => {
  if (typeof data !== "string") {
    return undefined;
  }

  const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(data);
  return dataUrlMatch?.[1] ?? data;
};

const promptSystemInstruction = (prompt: LanguageModel.ProviderOptions["prompt"]) => {
  const text = prompt.content
    .filter((message) => message.role === "system")
    .map(messageText)
    .join("\n");

  return text.length === 0
    ? undefined
    : { parts: [{ text }] };
};

/**
 * Non-system messages as Gemini contents. Assistant messages become `model`
 * turns; user and tool messages become `user` turns. Consecutive turns with the
 * same role are merged, so a tool result and the images it attaches travel in
 * one `user` turn and parallel tool calls in one `model` turn.
 */
export const promptContents = (prompt: LanguageModel.ProviderOptions["prompt"]): readonly GeminiContent[] => {
  const contents: GeminiContent[] = [];

  for (const message of prompt.content) {
    if (message.role === "system") {
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    const parts = messageParts(message);
    if (parts.length === 0) {
      continue;
    }

    const last = contents.at(-1);
    if (last !== undefined && last.role === role) {
      contents[contents.length - 1] = { role, parts: [...last.parts, ...parts] };
    } else {
      contents.push({ role, parts });
    }
  }

  return contents;
};

// ---------------------------------------------------------------------------
// Tools -> Gemini function declarations
// ---------------------------------------------------------------------------

// Gemini accepts an OpenAPI-style subset of JSON Schema and rejects unknown
// keywords such as `additionalProperties` or `$schema`.
const geminiSchemaKeys = new Set([
  "type", "description", "properties", "required", "items", "enum", "nullable", "format",
  "anyOf", "minimum", "maximum", "minItems", "maxItems", "title"
]);

export const toGeminiSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) {
    return schema.map(toGeminiSchema);
  }

  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!geminiSchemaKeys.has(key)) {
      continue;
    }

    if (key === "properties" && typeof value === "object" && value !== null) {
      output[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, property]) => [name, toGeminiSchema(property)])
      );
    } else if (key === "items" || key === "anyOf") {
      output[key] = toGeminiSchema(value);
    } else {
      output[key] = value;
    }
  }

  return output;
};

const toolDeclarations = (tools: LanguageModel.ProviderOptions["tools"]) =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(Tool.getJsonSchema(tool))
  }));

const geminiTools = (tools: LanguageModel.ProviderOptions["tools"]) =>
  tools.length === 0 ? [] : [{ functionDeclarations: toolDeclarations(tools) }];

const toolChoiceConfig = (options: LanguageModel.ProviderOptions) => {
  if (options.toolChoice === "none" || options.tools.length === 0) {
    return undefined;
  }

  if (options.toolChoice === "required") {
    return {
      mode: "ANY",
      allowedFunctionNames: options.tools.map((tool) => tool.name)
    };
  }

  if (typeof options.toolChoice === "object" && "tool" in options.toolChoice) {
    return {
      mode: "ANY",
      allowedFunctionNames: [options.toolChoice.tool]
    };
  }

  if (typeof options.toolChoice === "object" && "oneOf" in options.toolChoice) {
    return options.toolChoice.mode === "required"
      ? {
          mode: "ANY",
          allowedFunctionNames: options.toolChoice.oneOf
        }
      : { mode: "AUTO" };
  }

  return { mode: "AUTO" };
};

const toolConfig = (options: LanguageModel.ProviderOptions) => {
  const functionCallingConfig = toolChoiceConfig(options);

  return functionCallingConfig === undefined
    ? undefined
    : { functionCallingConfig };
};

export const requestBody = (options: LanguageModel.ProviderOptions) => ({
  systemInstruction: promptSystemInstruction(options.prompt),
  contents: promptContents(options.prompt),
  tools: geminiTools(options.tools),
  toolConfig: toolConfig(options)
});

// ---------------------------------------------------------------------------
// Gemini response -> Effect AI response parts
// ---------------------------------------------------------------------------

// Transient failures (rate limit, overload) are retried a few times, waiting
// what Google asks for (Retry-After header or "retry in Ns" in the body), capped.
const maxAttempts = 4;
const maxRetryDelayMs = 65_000;

export const retryDelayMs = (response: { readonly status: number; readonly headers: { get(name: string): string | null } }, errorText: string): number | undefined => {
  if (response.status !== 429 && response.status !== 503) {
    return undefined;
  }

  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) {
    return Math.min(header * 1000, maxRetryDelayMs);
  }

  const inBody = /retry in (\d+(?:\.\d+)?)s/i.exec(errorText);
  if (inBody?.[1] !== undefined) {
    return Math.min(Math.ceil(Number(inBody[1]) * 1000) + 500, maxRetryDelayMs);
  }

  return 5_000;
};

/**
 * Classifies a failed Gemini response into a typed `AiError`, so the caller
 * can decide what to show and whether a retry makes sense.
 *
 * A 429 whose quota is a per-day limit is `QuotaExhaustedError` (retrying
 * within the day is pointless); any other 429 is `RateLimitError`; 503 is
 * `InternalProviderError` (temporary); 401/403 is `AuthenticationError`.
 */
export const classifyFailure = (status: number, errorText: string, model: string): AiError.AiError => {
  const parsed = parseGeminiError(errorText);
  const metadata = { model, status, message: parsed.message, quotaId: parsed.quotaId ?? null };
  const reason = status === 429 && /perday/i.test(parsed.quotaId ?? "")
    ? new AiError.QuotaExhaustedError({ metadata })
    : status === 429
      ? new AiError.RateLimitError({ metadata })
      : status === 503
        ? new AiError.InternalProviderError({ description: parsed.message, metadata })
        : status === 401 || status === 403
          ? new AiError.AuthenticationError({ kind: "Unknown", metadata })
          : new AiError.UnknownError({ description: parsed.message, metadata });

  return AiError.make({ module: "GeminiLanguageModel", method: "generateText", reason });
};

const parseGeminiError = (errorText: string): { readonly message: string; readonly quotaId: string | undefined } => {
  try {
    const json = JSON.parse(errorText) as {
      error?: { message?: string; details?: Array<{ violations?: Array<{ quotaId?: string }> }> };
    };
    const message = json.error?.message?.split("\n")[0] ?? errorText;
    const quotaId = json.error?.details?.flatMap((detail) => detail.violations ?? []).find((violation) => violation.quotaId)?.quotaId;
    return { message, quotaId };
  } catch {
    return { message: errorText.slice(0, 300), quotaId: undefined };
  }
};

// `streamGenerateContent` with `alt=sse` answers with server-sent events: one
// `data: {...}` line per chunk, each a GenerateContentResponse with the new parts.
// Text arrives in fragments; a function call arrives whole in one chunk.
const geminiUrl = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

/** Parts accumulated from a stream of chunks, in the shape `toResponseParts` expects. */
export interface StreamedResponse {
  /** Visible text so far (model thoughts are left out). */
  readonly text: string;
  /** Function-call parts, whole, in order of arrival (with their thought signatures). */
  readonly calls: ReadonlyArray<GeminiPart>;
  readonly finishReason: string | undefined;
  readonly blockReason: string | undefined;
}

export const emptyStreamedResponse: StreamedResponse = { text: "", calls: [], finishReason: undefined, blockReason: undefined };

/** Folds one decoded chunk into the accumulated response; `delta` is the visible text it added. */
export const foldChunk = (state: StreamedResponse, chunk: GeminiResponse): { readonly state: StreamedResponse; readonly delta: string } => {
  let delta = "";
  const calls = [...state.calls];
  for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
    if (part.functionCall !== undefined) {
      calls.push(part);
    } else if (part.text !== undefined && part.thought !== true) {
      delta += part.text;
    }
  }
  return {
    state: {
      text: state.text + delta,
      calls,
      finishReason: chunk.candidates?.[0]?.finishReason ?? state.finishReason,
      blockReason: chunk.promptFeedback?.blockReason ?? state.blockReason
    },
    delta
  };
};

/** The JSON payload of one SSE line, or `undefined` for anything that is not a data line. */
export const parseSseLine = (line: string): unknown => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) {
    return undefined;
  }
  const payload = trimmed.slice("data:".length).trim();
  if (payload.length === 0 || payload === "[DONE]") {
    return undefined;
  }
  return JSON.parse(payload) as unknown;
};

/** Everything the adapter needs to finish a step, as if it had come from `generateContent`. */
export const toGeminiResponse = (state: StreamedResponse): GeminiResponse => ({
  candidates: [{
    content: {
      parts: [
        ...(state.text.length > 0 ? [{ text: state.text }] : []),
        ...state.calls
      ]
    },
    ...(state.finishReason === undefined ? {} : { finishReason: state.finishReason })
  }],
  ...(state.blockReason === undefined ? {} : { promptFeedback: { blockReason: state.blockReason } })
});

const decodeGeminiResponse = (json: unknown) =>
  Schema.decodeUnknownSync(GeminiResponse)(json);

/**
 * Every `functionCall` part becomes a tool-call part (Gemini may return several
 * in parallel). Text parts are kept unless they are model thoughts. A call to a
 * name that is not a tool is redirected to `load_skill` when that tool exists,
 * because models sometimes try to call a skill as if it were a tool.
 */
export const toResponseParts = (
  parts: ReadonlyArray<GeminiPart>,
  tools: LanguageModel.ProviderOptions["tools"]
) => {
  const toolNames = new Set(tools.map((tool) => tool.name));

  return parts.flatMap((part): Array<Response.PartEncoded> => {
    const functionCall = part.functionCall;

    if (functionCall?.name !== undefined) {
      const toolCall = toolNames.has(functionCall.name)
        ? { name: functionCall.name, params: functionCall.args ?? {} }
        : toolNames.has("load_skill")
          ? { name: "load_skill", params: { name: functionCall.name } }
          : { name: functionCall.name, params: functionCall.args ?? {} };

      if (!toolNames.has(toolCall.name)) {
        const availableTools = tools.map((tool) => tool.name).join(", ");
        throw new Error(`Invalid tool call "${functionCall.name}". Available tools: ${availableTools}.`);
      }

      return [
        Response.makePart("tool-call", {
          id: functionCall.id ?? `call_${crypto.randomUUID()}`,
          name: toolCall.name,
          params: toolCall.params,
          providerExecuted: false,
          ...(part.thoughtSignature === undefined ? {} : { metadata: { google: { thoughtSignature: part.thoughtSignature } } })
        })
      ];
    }

    if (part.text !== undefined && part.thought !== true) {
      return [Response.makePart("text", { text: part.text })];
    }

    return [];
  });
};

export const GeminiLanguageModelLive = Layer.effect(
  LanguageModel.LanguageModel,
  Effect.gen(function* () {
    const config = yield* GeminiConfig;

    const asAiError = (cause: unknown) => cause instanceof AiError.AiError
      ? cause
      : toAiError(cause instanceof Error ? cause.message : String(cause));

    // One HTTP attempt, up to the response headers. Transient provider failures
    // (429 rate limit, 503 overload) are returned as `{ retryAfterMs }` so the
    // caller can wait visibly; a 200 hands back the open stream.
    const attemptOnce = (body: string) =>
      Effect.tryPromise({
        try: async (signal): Promise<{ readonly response: globalThis.Response } | { readonly retryAfterMs: number; readonly errorText: string }> => {
          const response = await fetch(geminiUrl(config.model, config.apiKey), {
            method: "POST",
            headers: { "content-type": "application/json", "accept": "text/event-stream" },
            body,
            signal
          });

          if (response.ok) {
            return { response };
          }

          const errorText = await response.text();
          const failure = classifyFailure(response.status, errorText, config.model);
          const retryAfterMs = retryDelayMs(response, errorText);
          // Only transient failures are worth waiting for.
          const transient = failure.reason._tag === "RateLimitError" || failure.reason._tag === "InternalProviderError";
          if (retryAfterMs === undefined || !transient) {
            throw failure;
          }
          return { retryAfterMs, errorText };
        },
        catch: asAiError
      });

    // Reads the SSE body chunk by chunk. Visible text goes out as `text-delta`
    // events while it arrives (the session shows them as the draft answer); at the
    // end the whole response is turned into parts exactly as before.
    const readStream = (response: globalThis.Response, tools: LanguageModel.ProviderOptions["tools"]) => Effect.gen(function* () {
      if (response.body === null) {
        return yield* toAiError("Empty response: the provider sent no body.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let state = emptyStreamedResponse;
      let chunks = 0;

      const consume = (line: string) => Effect.gen(function* () {
        const raw = parseSseLine(line);
        if (raw === undefined) return;
        chunks += 1;
        const folded = foldChunk(state, decodeGeminiResponse(raw));
        state = folded.state;
        yield* emitTextDelta(folded.delta);
      });

      const read = Effect.gen(function* () {
        while (true) {
          const { value, done } = yield* Effect.tryPromise({ try: () => reader.read(), catch: asAiError });
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            yield* consume(line);
          }
        }
        buffer += decoder.decode();
        for (const line of buffer.split("\n")) {
          yield* consume(line);
        }
      }).pipe(
        // Cancelling the turn closes the connection to the provider too.
        Effect.onInterrupt(() => Effect.promise(() => reader.cancel().catch(() => undefined)))
      );
      yield* read;

      if (process.env.GEMINI_DEBUG === "1") {
        console.error(`[gemini] stream: ${chunks} chunk(s), ${state.text.length} chars, ${state.calls.length} call(s), finish=${state.finishReason ?? "-"}`);
      }
      const json = toGeminiResponse(state);
      const parts = toResponseParts(json.candidates?.[0]?.content?.parts ?? [], tools);
      if (parts.length === 0) {
        const reason = emptyResponseReason(json);
        if (reason !== undefined) {
          return yield* toAiError(`Empty response: ${reason}.`);
        }
      }
      return parts;
    });

    return yield* LanguageModel.make({
      generateText: (options) => Effect.gen(function* () {
        const body = JSON.stringify(requestBody(options));

        for (let attempt = 1; ; attempt++) {
          const result = yield* attemptOnce(body);
          if ("response" in result) {
            return yield* readStream(result.response, options.tools);
          }

          if (attempt >= maxAttempts) {
            return yield* classifyFailure(429, result.errorText, config.model);
          }

          // Waiting is visible: a trace line for the log and a progress event for the UI.
          const seconds = Math.ceil(result.retryAfterMs / 1000);
          yield* Effect.logWarning("gemini rate limited, waiting before retry").pipe(
            Effect.annotateLogs({ "agent.event": "model.retry", "agent.attempt": attempt, "agent.waitMs": result.retryAfterMs })
          );
          yield* emitProgress(`Límite de peticiones del proveedor: reintentando en ${seconds} s (intento ${attempt} de ${maxAttempts - 1})`);
          yield* Effect.sleep(Duration.millis(result.retryAfterMs));
        }
      }),
      streamText: () => Stream.empty
    });
  })
).pipe(Layer.orDie);

// The model label reported through `AiModel.ModelName` must match what the
// adapter actually calls, which comes from GEMINI_MODEL when set.
const configuredModel = (process.env.GEMINI_MODEL ?? "").trim() || defaultModel;

export const GeminiModel = AiModel.make(
  "google",
  configuredModel,
  GeminiLanguageModelLive
);
