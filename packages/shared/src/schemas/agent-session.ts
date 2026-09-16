import { Schema } from "effect";
import { AgentMessage } from "./agent-message.ts";

/** A tutor conversation persisted on the server. */
export const AgentSession = Schema.Struct({
  id: Schema.String,
  messages: Schema.Array(AgentMessage),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** Folder the conversation belongs to; absent means General. The tutor works within it. */
  folderId: Schema.optional(Schema.String)
});
export type AgentSession = typeof AgentSession.Type;

export const AgentSessionSummary = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  messageCount: Schema.Number,
  /** First user message, shortened, to recognise the conversation in a list. */
  preview: Schema.String,
  folderId: Schema.optional(Schema.String)
});
export type AgentSessionSummary = typeof AgentSessionSummary.Type;

export const AgentSessionListResponse = Schema.Struct({
  sessions: Schema.Array(AgentSessionSummary)
});
export type AgentSessionListResponse = typeof AgentSessionListResponse.Type;
