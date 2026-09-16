import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Layer, Ref, Stream } from "effect";
import { AiError, LanguageModel, Response } from "effect/unstable/ai";
import {
  SessionNotFound,
  SessionRepository,
  summarizeSession,
  type AppendMessagesInput,
  type MakeSessionInput,
  type StoredAgentSession
} from "../domain/agents/harness/index.ts";
import { TutorChatService, TutorChatServiceLive } from "../domain/agents/academic-tutor/tutor-chat-service.ts";
import { ArtifactRepository } from "../domain/artifacts/artifact.ts";
import { MaterialNotFound, MaterialRepository, type PdfMaterial } from "../domain/materials/material.ts";
import { FolderNotFound, FolderRepository, generalFolder } from "../domain/folders/folder.ts";

/**
 * Deterministic eval (no API calls): the conversation is persisted on the
 * server per session, only the new input travels, and a failed turn persists
 * nothing so a retry does not duplicate the user message.
 *
 *   pnpm --filter @proxus/server run eval:tutor:sessions
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

// Folders are not what this eval measures: every conversation lives in General.
const GeneralOnlyFolderRepository = Layer.succeed(FolderRepository, {
  list: () => Effect.succeed([generalFolder]),
  get: (id) => id === generalFolder.id ? Effect.succeed(generalFolder) : Effect.fail(new FolderNotFound({ folderId: id })),
  create: () => Effect.die("not used"),
  rename: () => Effect.die("not used"),
  remove: () => Effect.die("not used")
});

const FixtureMaterialRepository = Layer.succeed(MaterialRepository, {
  list: () => Effect.succeed([fixtureMaterial]),
  get: (id) => id === fixtureMaterial.id ? Effect.succeed(fixtureMaterial) : Effect.fail(new MaterialNotFound({ materialId: id })),
  renderPages: (materialId) => Effect.fail(new MaterialNotFound({ materialId })),
  save: () => Effect.die("material repository save is not used by this eval"),
  remove: () => Effect.die("material repository remove is not used by this eval")
});

// Artifacts are not exercised here; the service only needs the port to exist.
const UnusedArtifactRepository = Layer.succeed(ArtifactRepository, new Proxy({}, {
  get: () => () => Effect.die("artifact repository is not used by the sessions eval")
}) as ArtifactRepository);

const InMemorySessionRepository = Layer.effect(
  SessionRepository,
  Effect.gen(function* () {
    const store = yield* Ref.make(new Map<string, StoredAgentSession>());

    const getSession = (id: string) => Ref.get(store).pipe(
      Effect.flatMap((sessions) => {
        const session = sessions.get(id);
        return session === undefined ? Effect.fail(new SessionNotFound({ sessionId: id })) : Effect.succeed(session);
      })
    );

    const makeSession = (input: MakeSessionInput) => Effect.gen(function* () {
      const now = new Date().toISOString();
      const session: StoredAgentSession = { id: input.id, messages: [], createdAt: now, updatedAt: now };
      yield* Ref.update(store, (sessions) => new Map(sessions).set(input.id, session));
      return session;
    });

    const appendMessages = (input: AppendMessagesInput) => getSession(input.sessionId).pipe(
      Effect.flatMap((session) => Ref.update(store, (sessions) => new Map(sessions).set(input.sessionId, {
        ...session,
        messages: [...session.messages, ...input.messages],
        updatedAt: new Date().toISOString()
      })))
    );

    const listSessions = () => Ref.get(store).pipe(
      Effect.map((sessions) => [...sessions.values()].map(summarizeSession))
    );

    return { getSession, makeSession, appendMessages, listSessions };
  })
);

/** Scripted model: turn 1 lists materials then answers; turn 2 answers; turn 3 fails. */
const makeScriptedModel = (received: Ref.Ref<readonly LanguageModel.ProviderOptions[]>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) => Effect.gen(function* () {
        const index = (yield* Ref.get(received)).length;
        yield* Ref.update(received, (all) => [...all, options]);
        const parts: Array<Response.PartEncoded> = [];
        switch (index) {
          case 0:
            parts.push(Response.makePart("tool-call", { id: "call_1", name: "cli", params: { input: "materials list" }, providerExecuted: false }));
            break;
          case 1:
            parts.push(Response.makePart("text", { text: "Tienes un material: algebra-basica." }));
            break;
          case 2:
            // No page citation here: the grounding guard would force a re-read.
            parts.push(Response.makePart("text", { text: "Claro, empecemos por lo básico cuando quieras." }));
            break;
          default:
            return yield* AiError.make({
              module: "ScriptedModel",
              method: "generateText",
              reason: new AiError.UnknownError({ description: "simulated provider outage" })
            });
        }
        return parts;
      }),
      streamText: () => { throw new Error("not used"); }
    })
  );

// --- Cases -------------------------------------------------------------------

const sessionsCase = Effect.gen(function* () {
  const received = yield* Ref.make<readonly LanguageModel.ProviderOptions[]>([]);
  const results: CriterionResult[] = [];

  const program = Effect.gen(function* () {
    const tutor = yield* TutorChatService;
    const sessions = yield* SessionRepository;

    const created = yield* sessions.makeSession({ id: "s1" });
    results.push(criterion("session-created-empty", created.messages.length === 0, `messages: ${created.messages.length}`));

    // Turn 1 (stream): only sessionId + input travel; messages are persisted at the end.
    const events = yield* tutor.streamMessage({ sessionId: "s1", input: "Lista mis materiales" }).pipe(Stream.runCollect);
    const stored1 = yield* sessions.getSession("s1");
    const roles1 = stored1.messages.map((message) => message.role);
    results.push(
      criterion("turn1-stream-ends-with-done", events.at(-1)?.type === "done", `last event: ${events.at(-1)?.type}`),
      criterion("turn1-persisted-full-turn", JSON.stringify(roles1) === JSON.stringify(["user", "tool-call", "tool-result", "assistant"]), `stored roles: ${roles1.join(" > ")}`)
    );

    // Turn 2 (non-stream): the model must see turn 1 from the store, not from the client.
    const response = yield* tutor.sendMessage({ sessionId: "s1", input: "¿Por dónde empiezo?" });
    const prompts = yield* Ref.get(received);
    const turn2Prompt = prompts[2];
    const sawPreviousAnswer = (turn2Prompt?.prompt.content ?? []).some((message) =>
      message.role === "assistant"
      && message.content.some((part) => part.type === "text" && part.text.includes("Tienes un material"))
    );
    const stored2 = yield* sessions.getSession("s1");
    // Every turn tells the model which folder it works in (General for sessions without one).
    const folderNote = (turn2Prompt?.prompt.content ?? []).some((message) =>
      message.role === "system" && typeof message.content === "string" && message.content.includes('FOLDER: the student is working in the folder "General"')
    );
    results.push(
      criterion("turn-note-names-the-folder", folderNote, "system note carries the folder name"),
      criterion("turn2-model-saw-stored-history", sawPreviousAnswer, "turn 2 prompt includes turn 1 answer loaded from the store"),
      criterion("turn2-persisted", stored2.messages.length === 6 && response.output.includes("empecemos"), `stored messages: ${stored2.messages.length}`)
    );

    // Turn 3: provider fails -> error event, nothing persisted.
    const events3 = yield* tutor.streamMessage({ sessionId: "s1", input: "Otra pregunta" }).pipe(Stream.runCollect);
    const stored3 = yield* sessions.getSession("s1");
    results.push(
      criterion("turn3-emits-error-event", events3.some((event) => event.type === "error" && event.retryable), `events: ${events3.map((event) => event.type).join(" > ")}`),
      criterion("turn3-failed-turn-not-persisted", stored3.messages.length === 6, `stored messages after failure: ${stored3.messages.length}`)
    );

    // Unknown session is rejected.
    const missing = yield* tutor.streamMessage({ sessionId: "nope", input: "hola" }).pipe(Stream.runCollect, Effect.exit);
    results.push(criterion("unknown-session-rejected", missing._tag === "Failure", `exit: ${missing._tag}`));

    const list = yield* sessions.listSessions();
    results.push(criterion("list-has-summary-with-preview", list.length === 1 && list[0]?.preview === "Lista mis materiales" && list[0]?.messageCount === 6, JSON.stringify(list[0])));
  });

  const dependencies = Layer.mergeAll(FixtureMaterialRepository, UnusedArtifactRepository, InMemorySessionRepository, GeneralOnlyFolderRepository);
  yield* program.pipe(
    Effect.provide(Layer.mergeAll(
      TutorChatServiceLive.pipe(Layer.provide(dependencies)),
      dependencies,
      makeScriptedModel(received)
    ))
  );

  return results;
});

// --- Runner ------------------------------------------------------------------

class SessionsEvalFailed extends Data.TaggedError("SessionsEvalFailed")<{}> {}

export const sessionsEval = Effect.gen(function* () {
  const results = yield* sessionsCase;
  const lines = ["academic-tutor.sessions"];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new SessionsEvalFailed();
  }
  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(sessionsEval);
}
