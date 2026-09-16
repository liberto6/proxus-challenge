import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import {
  SessionAlreadyExists,
  SessionNotFound,
  SessionRepository,
  SessionRepositorySerializationError,
  SessionRepositoryStorageError,
  type AppendMessagesInput,
  type ListSessionsInput,
  type MakeSessionInput,
  type SessionRepository as SessionRepositoryType,
  type SessionRepositoryError,
  type StoredAgentSession,
  summarizeSession
} from "../../domain/agents/harness/index.ts";
import { folderOf } from "../../domain/folders/folder.ts";

const UserMessageSchema = Schema.Struct({
  role: Schema.Literal("user"),
  content: Schema.String
});

const AssistantMessageSchema = Schema.Struct({
  role: Schema.Literal("assistant"),
  content: Schema.String
});

const ToolCallMessageSchema = Schema.Struct({
  role: Schema.Literal("tool-call"),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Unknown,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
});

const ToolResultMessageSchema = Schema.Struct({
  role: Schema.Literal("tool-result"),
  id: Schema.String,
  name: Schema.String,
  result: Schema.Unknown,
  isFailure: Schema.Boolean
});

const AgentMessageSchema = Schema.Union([
  UserMessageSchema,
  AssistantMessageSchema,
  ToolCallMessageSchema,
  ToolResultMessageSchema
]);

const StoredAgentSessionSchema = Schema.Struct({
  id: Schema.String,
  messages: Schema.Array(AgentMessageSchema),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  folderId: Schema.optional(Schema.String)
});

const StoredAgentSessionFromJson = Schema.fromJsonString(StoredAgentSessionSchema);

export const FileSessionRepository = {
  make: (directory: string): Effect.Effect<SessionRepositoryType, never, FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const pathForSession = (sessionId: string) =>
      path.join(directory, `${encodeURIComponent(sessionId)}.json`);

    const mapStorageError = (reason: unknown) => new SessionRepositoryStorageError({ reason });

    const readSessionFile = (sessionId: string): Effect.Effect<StoredAgentSession, SessionRepositoryError> => Effect.gen(function* () {
      const sessionPath = pathForSession(sessionId);
      const sessionExists = yield* fs.exists(sessionPath).pipe(
        Effect.mapError(mapStorageError)
      );

      if (!sessionExists) {
        return yield* new SessionNotFound({ sessionId });
      }

      const text = yield* fs.readFileString(sessionPath).pipe(
        Effect.mapError(mapStorageError)
      );

      return yield* Schema.decodeUnknownEffect(StoredAgentSessionFromJson)(text).pipe(
        Effect.mapError((reason) => new SessionRepositorySerializationError({ reason }))
      );
    });

    const writeSessionFile = (session: StoredAgentSession): Effect.Effect<void, SessionRepositoryError> => Effect.gen(function* () {
      const encoded = yield* Schema.encodeUnknownEffect(StoredAgentSessionSchema)(session).pipe(
        Effect.mapError((reason) => new SessionRepositorySerializationError({ reason }))
      );
      const prettyJson = JSON.stringify(encoded, null, 2);

      if (prettyJson === undefined) {
        return yield* new SessionRepositorySerializationError({ reason: "Session did not encode to JSON" });
      }

      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError(mapStorageError)
      );

      yield* fs.writeFileString(pathForSession(session.id), `${prettyJson}\n`).pipe(
        Effect.mapError(mapStorageError)
      );
    });

    const getSession = (id: string) => readSessionFile(id);

    const makeSession = (input: MakeSessionInput) => Effect.gen(function* () {
      const sessionPath = pathForSession(input.id);
      const sessionExists = yield* fs.exists(sessionPath).pipe(
        Effect.mapError(mapStorageError)
      );

      if (sessionExists) {
        return yield* new SessionAlreadyExists({ sessionId: input.id });
      }

      const now = new Date().toISOString();
      const session: StoredAgentSession = {
        id: input.id,
        messages: [],
        createdAt: now,
        updatedAt: now,
        ...(input.folderId === undefined ? {} : { folderId: input.folderId })
      };

      yield* writeSessionFile(session);

      return session;
    });

    const appendMessages = (input: AppendMessagesInput) => Effect.gen(function* () {
      if (input.messages.length === 0) {
        return;
      }

      const session = yield* readSessionFile(input.sessionId);
      const updatedSession: StoredAgentSession = {
        ...session,
        messages: [...session.messages, ...input.messages],
        updatedAt: new Date().toISOString()
      };

      yield* writeSessionFile(updatedSession);
    });

    const listSessions = (input: ListSessionsInput = {}) => Effect.gen(function* () {
      const directoryExists = yield* fs.exists(directory).pipe(Effect.mapError(mapStorageError));
      if (!directoryExists) {
        return [];
      }

      const entries = yield* fs.readDirectory(directory).pipe(Effect.mapError(mapStorageError));
      const ids = entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => decodeURIComponent(entry.slice(0, -".json".length)));

      const sessions = yield* Effect.forEach(ids, (id) => readSessionFile(id), { concurrency: 4 });
      return sessions
        .filter((session) => input.folderId === undefined || folderOf(session) === input.folderId)
        .map(summarizeSession)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });

    return {
      getSession,
      makeSession,
      appendMessages,
      listSessions
    };
  }),
  layer: (directory: string) => Layer.effect(SessionRepository)(FileSessionRepository.make(directory))
};
