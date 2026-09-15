import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type { TutorChatRequest, TutorChatResponse, TutorChatStreamEvent } from "@proxus/shared";
import { ArtifactRepository } from "../../artifacts/artifact.ts";
import { MaterialRepository } from "../../materials/material.ts";
import { AgentSession, SessionNotFound, SessionRepository, type AgentMessage } from "../harness/index.ts";
import { makeAcademicTutorHarness } from "../academic-tutor.ts";

/**
 * Runs tutor turns against a persisted session.
 *
 * The client sends only the session id and the new input. The service loads
 * the stored history, runs the turn, and appends the turn's messages when it
 * completes. A turn that ends in an error persists nothing, so retrying the
 * same input does not duplicate the user message.
 */
export interface TutorChatService {
  readonly sendMessage: (
    input: TutorChatRequest
  ) => Effect.Effect<TutorChatResponse, SessionNotFound | unknown, LanguageModel.LanguageModel>;
  readonly streamMessage: (
    input: TutorChatRequest
  ) => Stream.Stream<TutorChatStreamEvent, SessionNotFound | unknown, LanguageModel.LanguageModel>;
}

export const TutorChatService = Context.Service<TutorChatService>(
  "@proxus/server/agents/academic-tutor/TutorChatService"
);

export const TutorChatServiceLive = Layer.effect(
  TutorChatService,
  Effect.gen(function* () {
    const materialRepository = yield* MaterialRepository;
    const artifactRepository = yield* ArtifactRepository;
    const sessions = yield* SessionRepository;
    const harness = makeAcademicTutorHarness(materialRepository, artifactRepository);
    const session = AgentSession.make(harness);

    const persistTurn = (sessionId: string, messages: readonly AgentMessage[]) =>
      sessions.appendMessages({ sessionId, messages });

    // A turn completed when its last message is the tutor's answer.
    const turnCompleted = (messages: readonly AgentMessage[]) => messages.at(-1)?.role === "assistant";

    return {
      sendMessage: (input) => Effect.gen(function* () {
        const stored = yield* sessions.getSession(input.sessionId);
        const result = yield* session.run({
          input: input.input,
          messages: stored.messages,
          maxSteps: input.maxSteps ?? 8
        }).pipe(Effect.provide(harness.layer));

        if (turnCompleted(result.newMessages)) {
          yield* persistTurn(input.sessionId, result.newMessages);
        }

        return result;
      }),

      streamMessage: (input) => Stream.unwrap(Effect.gen(function* () {
        const stored = yield* sessions.getSession(input.sessionId);
        const turnMessages: AgentMessage[] = [];
        let failed = false;

        const finish = Effect.gen(function* () {
          if (!failed && turnCompleted(turnMessages)) {
            yield* persistTurn(input.sessionId, turnMessages);
          }
          return { type: "done" as const };
        });

        return session.stream({
          input: input.input,
          messages: stored.messages,
          maxSteps: input.maxSteps ?? 8
        }).pipe(
          Stream.tap((event) => Effect.sync(() => {
            if (event.type === "message") {
              turnMessages.push(event.message);
            } else if (event.type === "error") {
              failed = true;
            }
          })),
          Stream.map((event): TutorChatStreamEvent => event),
          Stream.concat(Stream.fromEffect(finish)),
          Stream.provide(harness.layer)
        );
      }))
    };
  })
);
