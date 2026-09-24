import { Effect } from "effect";

/**
 * Agent traces: one structured log line per meaningful event of a turn, so a
 * failing turn can be reconstructed from the server log alone.
 *
 * Every line inside a turn carries the `agent.turn` annotation (see `withTurn`).
 * Lines are emitted through the Effect logger already used by the HTTP layer,
 * so they share its format and destination.
 */

export const newTurnId = (): string => crypto.randomUUID().slice(0, 8);

/** Runs `effect` with the turn id annotated on every log line it emits. */
export const withTurn = <A, E, R>(turnId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  effect.pipe(Effect.annotateLogs({ "agent.turn": turnId }));

export const traceTurnStarted = (input: { readonly inputLength: number; readonly historyLength: number; readonly maxSteps: number }) =>
  Effect.logInfo("agent turn started").pipe(Effect.annotateLogs({
    "agent.event": "turn.started",
    "agent.inputLength": input.inputLength,
    "agent.historyLength": input.historyLength,
    "agent.maxSteps": input.maxSteps
  }));

export const traceModelCall = (input: {
  readonly step: number;
  readonly durationMs: number;
  readonly toolCalls: readonly string[];
  readonly textLength: number;
}) =>
  Effect.logInfo("agent model call").pipe(Effect.annotateLogs({
    "agent.event": "model.call",
    "agent.step": input.step,
    "agent.durationMs": input.durationMs,
    "agent.toolCalls": input.toolCalls.join(",") || "-",
    "agent.textLength": input.textLength
  }));

export const traceModelError = (input: { readonly step: number; readonly durationMs: number; readonly error: unknown }) =>
  Effect.logError("agent model call failed").pipe(Effect.annotateLogs({
    "agent.event": "model.error",
    "agent.step": input.step,
    "agent.durationMs": input.durationMs,
    "agent.error": describeError(input.error)
  }));

export const traceToolCall = (input: {
  readonly tool: string;
  readonly input: unknown;
  readonly durationMs: number;
  readonly isFailure: boolean;
}) =>
  (input.isFailure ? Effect.logWarning("agent tool call failed") : Effect.logInfo("agent tool call")).pipe(
    Effect.annotateLogs({
      "agent.event": input.isFailure ? "tool.failed" : "tool.call",
      "agent.tool": input.tool,
      "agent.input": summarize(input.input),
      "agent.durationMs": input.durationMs
    })
  );

export const traceGrounding = (input: { readonly outcome: "retry" | "flagged"; readonly pages: readonly number[] }) =>
  Effect.logWarning(input.outcome === "retry"
    ? "grounding check failed, asking the model to render the cited pages"
    : "grounding check still failing after retry, answer flagged").pipe(
    Effect.annotateLogs({
      "agent.event": `grounding.${input.outcome}`,
      "agent.pages": input.pages.join(",")
    })
  );

export const traceEmptyAnswer = (input: { readonly step: number; readonly outcome: "retry" | "failed" }) =>
  Effect.logWarning("agent step returned no text and no tool call").pipe(Effect.annotateLogs({
    "agent.event": `empty-answer.${input.outcome}`,
    "agent.step": input.step
  }));

export const traceTurnFinished = (input: { readonly steps: number; readonly outputLength: number; readonly reason: "answer" | "max-steps" | "error" }) =>
  Effect.logInfo("agent turn finished").pipe(Effect.annotateLogs({
    "agent.event": "turn.finished",
    "agent.steps": input.steps,
    "agent.outputLength": input.outputLength,
    "agent.reason": input.reason
  }));

/** Times an effect and reports its duration in milliseconds alongside the result. */
export const timed = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<readonly [A, number], E, R> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const result = yield* effect;
    return [result, Date.now() - startedAt] as const;
  });

const describeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message.slice(0, 500);
  }
  return String(error).slice(0, 500);
};

const summarize = (value: unknown): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
};
