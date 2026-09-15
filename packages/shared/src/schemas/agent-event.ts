import { Schema } from "effect";
import { AgentMessage } from "./agent-message.ts";

/**
 * Events streamed by the tutor while it works on one turn.
 *
 * - `message`: a persisted conversation message (user, assistant, tool call, tool result).
 * - `progress`: a transient, human-readable status ("Leyendo páginas 1-2 de ...").
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
  AgentErrorEvent,
  AgentDoneEvent
]);
export type AgentEvent = typeof AgentEvent.Type;
