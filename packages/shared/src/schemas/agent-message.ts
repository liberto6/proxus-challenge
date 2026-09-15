import { Schema } from "effect";

export const UserMessage = Schema.Struct({
  role: Schema.Literal("user"),
  content: Schema.String
});
export type UserMessage = typeof UserMessage.Type;

export const AssistantMessage = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: Schema.String
});
export type AssistantMessage = typeof AssistantMessage.Type;

export const ToolCallMessage = Schema.Struct({
  role: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  /** Provider-specific data that must travel back with the call (e.g. Gemini thought signatures). */
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
});
export type ToolCallMessage = typeof ToolCallMessage.Type;

export const ToolResultMessage = Schema.Struct({
  role: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: Schema.Unknown,
  isFailure: Schema.Boolean
});
export type ToolResultMessage = typeof ToolResultMessage.Type;

export const AgentMessage = Schema.Union([
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ToolResultMessage
]);
export type AgentMessage = typeof AgentMessage.Type;
