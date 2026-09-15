import { Cause, Effect, Queue, Stream } from "effect";
import { LanguageModel, Prompt, Tool } from "effect/unstable/ai";
import { AgentEventSink, type SessionEvent } from "./event.ts";
import { newTurnId, timed, traceGrounding, traceModelCall, traceModelError, traceTurnFinished, traceTurnStarted, withTurn } from "./trace.ts";
import type { AgentHarness, AgentToolkit } from "./harness.ts";
import { isMaterialPageImages } from "../../materials/material.ts";
import { AgentMessage, type AgentMessage as AgentMessageType } from "./message.ts";
import { groundingDisclaimer, groundingReminder, renderedPages, ungroundedCitations } from "./grounding.ts";

export interface AgentSessionRunOptions {
  readonly maxSteps?: number;
}

export interface AgentSessionRunInput extends AgentSessionRunOptions {
  readonly input: string;
  readonly messages?: readonly AgentMessageType[];
}

export interface AgentSessionRunResult {
  readonly output: string;
  readonly newMessages: readonly AgentMessageType[];
  readonly messages: readonly AgentMessageType[];
}

export interface AgentSession {
  readonly run: (
    input: AgentSessionRunInput
  ) => Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
  readonly stream: (
    input: AgentSessionRunInput
  ) => Stream.Stream<SessionEvent, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
}

export const AgentSession = {
  make: (harness: AgentHarness): AgentSession => ({
    run: (input) => run(harness, input),
    stream: (input) => stream(harness, input)
  }),
  run,
  stream
};

function run(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return execute(harness, input, () => Effect.void);
}

function stream(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Stream.Stream<SessionEvent, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return Stream.callback<SessionEvent, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>((queue) =>
    execute(harness, input, (event) => Queue.offer(queue, event).pipe(Effect.asVoid)).pipe(
      Effect.andThen(Queue.end(queue)),
      Effect.matchCauseEffect({
        onFailure: (cause) => Queue.failCause(queue, cause),
        onSuccess: () => Effect.void
      })
    )
  );
}

function execute(
  harness: AgentHarness,
  input: AgentSessionRunInput,
  emit: (event: SessionEvent) => Effect.Effect<void>
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  const turnId = newTurnId();

  return withTurn(turnId, Effect.gen(function* () {
    const toolkit = yield* harness.toolkit;
    const previousMessages = input.messages ?? [];
    const newMessages: AgentMessageType[] = [];
    const allMessages = () => [...previousMessages, ...newMessages] as const;
    const appendMessage = (message: AgentMessageType): Effect.Effect<void> => Effect.gen(function* () {
      newMessages.push(message);
      yield* emit({ type: "message", message });
    });
    const sink: AgentEventSink = { emit };

    yield* appendMessage(AgentMessage.user(input.input));

    let lastToolResult = "";
    let groundingNote: string | undefined;
    let groundingRetries = 0;
    const maxSteps = input.maxSteps ?? 8;

    yield* traceTurnStarted({ inputLength: input.input.length, historyLength: previousMessages.length, maxSteps });

    for (let step = 0; step < maxSteps; step++) {
      const prompt = renderPrompt(harness.systemPrompt, allMessages(), groundingNote);
      const [exit, durationMs] = yield* timed(Effect.exit(LanguageModel.generateText({
        prompt,
        toolkit,
        toolChoice: "auto" as const
      }).pipe(Effect.provideService(AgentEventSink, sink))));

      if (exit._tag === "Failure") {
        // The model (or the provider) failed: report it as an error event and stop the
        // turn. No assistant message is fabricated; the caller may retry the same input.
        const error = Cause.squash(exit.cause);
        yield* traceModelError({ step, durationMs, error });
        const output = modelErrorText(error);
        yield* emit({ type: "error", message: output, retryable: true });
        yield* traceTurnFinished({ steps: step + 1, outputLength: output.length, reason: "error" });
        return {
          output,
          newMessages,
          messages: allMessages()
        };
      }

      const response = exit.value;
      yield* traceModelCall({
        step,
        durationMs,
        toolCalls: response.toolCalls.map((toolCall) => toolCall.name),
        textLength: response.text.length
      });

      for (const toolCall of response.toolCalls) {
        yield* appendMessage(AgentMessage.toolCall(toolCall.id, toolCall.name, toolCall.params, toolCall.metadata));
      }

      for (const toolResult of response.toolResults) {
        yield* appendMessage(AgentMessage.toolResult(toolResult.id, toolResult.name, toolResult.result, toolResult.isFailure));
      }

      if (response.toolResults.length === 0) {
        let output = response.text.length > 0 ? response.text : lastToolResult;

        // Grounding guard: the draft may only cite pages rendered in this conversation.
        const ungrounded = ungroundedCitations(output, renderedPages(allMessages()));
        if (ungrounded.length > 0 && groundingRetries < 1) {
          groundingRetries += 1;
          groundingNote = groundingReminder(ungrounded);
          yield* traceGrounding({ outcome: "retry", pages: ungrounded });
          continue;
        }
        if (ungrounded.length > 0) {
          // The answer is accepted without a flag when, in this turn, the model tried to
          // render pages (the citation then refers to what it attempted to read) or found
          // that there are no materials at all (the page number is the user's reference:
          // "I could not find page 2 of your notes"). Otherwise the answer is flagged.
          const turnMessages = newMessages;
          const attemptedView = turnMessages.some((message) => isMaterialsCommand(message, "view"));
          const noMaterials = turnMessages.some((message) =>
            message.role === "tool-result" && !message.isFailure && message.result === "No PDF materials found."
          );
          if (!attemptedView && !noMaterials) {
            output += groundingDisclaimer(ungrounded);
            yield* traceGrounding({ outcome: "flagged", pages: ungrounded });
          }
        }

        yield* appendMessage(AgentMessage.assistant(output));
        yield* traceTurnFinished({ steps: step + 1, outputLength: output.length, reason: "answer" });
        return {
          output,
          newMessages,
          messages: allMessages()
        };
      }

      lastToolResult = String(response.toolResults.at(-1)?.result ?? lastToolResult);
    }

    const output = lastToolResult.length > 0
      ? lastToolResult
      : "Agent stopped after reaching the maximum number of steps.";
    yield* appendMessage(AgentMessage.assistant(output));
    yield* traceTurnFinished({ steps: maxSteps, outputLength: output.length, reason: "max-steps" });

    return {
      output,
      newMessages,
      messages: allMessages()
    };
  }));
}

const isMaterialsCommand = (message: AgentMessageType, subcommand: "list" | "view"): boolean => {
  if (message.role !== "tool-call" || message.name !== "cli") {
    return false;
  }
  const input = typeof message.input === "object" && message.input !== null
    ? (message.input as { input?: unknown }).input
    : undefined;
  return typeof input === "string" && new RegExp(`^\\s*materials\\s+${subcommand}\\b`).test(input);
};

const modelErrorText = (error: unknown): string =>
  `I hit an internal model/tool-routing error, so I stopped this turn safely instead of crashing the app.\n\n${formatAgentError(error)}`;

const formatAgentError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
};

/**
 * Renders the conversation as prompt messages for the model.
 *
 * Tool calls and tool results are rendered as native `tool-call` / `tool-result`
 * parts (assistant and tool messages), never as free text: when they were
 * rendered as text such as `Tool call cli: {...}`, the model learned to answer
 * with that text instead of calling the tool.
 */
export const renderPrompt = (
  systemPrompt: string,
  messages: readonly AgentMessageType[],
  note?: string
): readonly Prompt.MessageEncoded[] => [
  {
    role: "system",
    content: systemPrompt
  },
  ...(note === undefined ? [] : [{ role: "system" as const, content: note }]),
  ...messages.flatMap(renderMessage)
];

const renderMessage = (message: AgentMessageType): readonly Prompt.MessageEncoded[] => {
  switch (message.role) {
    case "user":
      return [{
        role: "user",
        content: message.content
      }];
    case "assistant":
      return [{
        role: "assistant",
        content: message.content
      }];
    case "tool-call":
      return [{
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: message.id,
            name: message.name,
            params: message.input,
            providerExecuted: false,
            ...(message.metadata === undefined ? {} : { options: message.metadata as Prompt.ToolCallPartEncoded["options"] })
          }
        ]
      }];
    case "tool-result":
      if (!message.isFailure && isMaterialPageImages(message.result)) {
        const result = message.result;
        const pages = result.pages.map((page) => page.page);
        return [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                id: message.id,
                name: message.name,
                isFailure: false,
                result: {
                  type: "material-page-images",
                  materialId: result.material.id,
                  title: result.material.title,
                  pages,
                  note: "The rendered pages are attached as images in the next message."
                }
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Rendered pages ${pages.join(", ")} from ${result.material.title}.`
              },
              ...result.pages.map((page) => ({
                type: "file" as const,
                mediaType: page.mediaType,
                data: page.data,
                fileName: `${result.material.id}-page-${page.page}.png`
              }))
            ]
          }
        ];
      }

      return [{
        role: "tool",
        content: [
          {
            type: "tool-result",
            id: message.id,
            name: message.name,
            isFailure: message.isFailure,
            result: jsonSafe(message.result)
          }
        ]
      }];
  }
};

const jsonSafe = (value: unknown): unknown => {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};
