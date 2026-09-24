import { Schema } from "effect";
import { AgentMessage } from "./agent-message.ts";

/**
 * Events streamed by the tutor while it works on one turn.
 *
 * - `message`: a persisted conversation message (user, assistant, tool call, tool result).
 * - `progress`: a transient, human-readable status ("Leyendo páginas 1-2 de ...").
 * - `text-delta`: a fragment of the answer the model is writing right now, to show it as it
 *   arrives. The final `message` (role assistant) carries the whole text and replaces the draft.
 * - `text-reset`: the draft shown so far is not the answer (the model went on to call a tool,
 *   or the harness asked it to answer again); the UI clears it.
 * - `error`: the turn stopped because the model or a tool failed; `retryable` tells the UI
 *   whether resending the same input makes sense.
 * - `done`: end of the turn.
 */
export const AgentMessageEvent = Schema.Struct({
  type: Schema.Literal("message"),
  message: AgentMessage
});
export type AgentMessageEvent = typeof AgentMessageEvent.Type;

export const AgentProgressEvent = Schema.Struct({
  type: Schema.Literal("progress"),
  label: Schema.String
});
export type AgentProgressEvent = typeof AgentProgressEvent.Type;

export const AgentTextDeltaEvent = Schema.Struct({
  type: Schema.Literal("text-delta"),
  delta: Schema.String
});
export type AgentTextDeltaEvent = typeof AgentTextDeltaEvent.Type;

export const AgentTextResetEvent = Schema.Struct({
  type: Schema.Literal("text-reset")
});
export type AgentTextResetEvent = typeof AgentTextResetEvent.Type;

export const AgentErrorEvent = Schema.Struct({
  type: Schema.Literal("error"),
  message: Schema.String,
  retryable: Schema.Boolean
});
export type AgentErrorEvent = typeof AgentErrorEvent.Type;

export const AgentDoneEvent = Schema.Struct({
  type: Schema.Literal("done")
});
export type AgentDoneEvent = typeof AgentDoneEvent.Type;

export const AgentEvent = Schema.Union([
  AgentMessageEvent,
  AgentProgressEvent,
  AgentTextDeltaEvent,
  AgentTextResetEvent,
  AgentErrorEvent,
  AgentDoneEvent
]);
export type AgentEvent = typeof AgentEvent.Type;
