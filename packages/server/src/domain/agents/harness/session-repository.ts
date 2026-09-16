import { Context, Data, Effect } from "effect";
import type { AgentMessage } from "./message.ts";

export interface StoredAgentSession {
  readonly id: string;
  readonly messages: readonly AgentMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Folder the conversation belongs to; absent means General. */
  readonly folderId?: string | undefined;
}

export interface MakeSessionInput {
  readonly id: string;
  readonly folderId?: string | undefined;
}

export interface ListSessionsInput {
  /** Only sessions of this folder (`general` includes sessions without folder). */
  readonly folderId?: string | undefined;
}

export interface AppendMessagesInput {
  readonly sessionId: string;
  readonly messages: readonly AgentMessage[];
}

export class SessionAlreadyExists extends Data.TaggedError("SessionAlreadyExists")<{
  readonly sessionId: string;
}> { }

export class SessionNotFound extends Data.TaggedError("SessionNotFound")<{
  readonly sessionId: string;
}> { }

export class SessionRepositoryStorageError extends Data.TaggedError("SessionRepositoryStorageError")<{
  readonly reason: unknown;
}> { }

export class SessionRepositorySerializationError extends Data.TaggedError("SessionRepositorySerializationError")<{
  readonly reason: unknown;
}> { }

export type SessionRepositoryError =
  | SessionAlreadyExists
  | SessionNotFound
  | SessionRepositoryStorageError
  | SessionRepositorySerializationError;

export interface StoredAgentSessionSummary {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly preview: string;
  readonly folderId?: string | undefined;
}

export interface SessionRepository {
  readonly getSession: (
    id: string
  ) => Effect.Effect<StoredAgentSession, SessionRepositoryError | SessionNotFound>;
  readonly makeSession: (
    input: MakeSessionInput
  ) => Effect.Effect<StoredAgentSession, SessionRepositoryError>;
  readonly appendMessages: (
    input: AppendMessagesInput
  ) => Effect.Effect<void, SessionRepositoryError>;
  /** Sessions ordered by last update, newest first. */
  readonly listSessions: (input?: ListSessionsInput) => Effect.Effect<readonly StoredAgentSessionSummary[], SessionRepositoryError>;
}

export const summarizeSession = (session: StoredAgentSession): StoredAgentSessionSummary => {
  const firstUser = session.messages.find((message) => message.role === "user");
  const preview = firstUser === undefined ? "" : firstUser.content.replace(/\s+/g, " ").trim().slice(0, 80);
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview,
    ...(session.folderId === undefined ? {} : { folderId: session.folderId })
  };
};

export const SessionRepository = Context.Service<SessionRepository>(
  "@proxus/server/agents/SessionRepository"
);
