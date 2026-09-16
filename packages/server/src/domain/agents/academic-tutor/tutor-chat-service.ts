import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type { TutorChatRequest, TutorChatResponse, TutorChatStreamEvent } from "@proxus/shared";
import { ArtifactRepository } from "../../artifacts/artifact.ts";
import { MaterialRepository } from "../../materials/material.ts";
import { AgentSession, SessionNotFound, SessionRepository, type AgentMessage } from "../harness/index.ts";
import { makeAcademicTutorHarness } from "../academic-tutor.ts";
import { describeUiContext } from "./ui-context.ts";
import { tutorOptions } from "./tutor-options.ts";

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
    const harness = makeAcademicTutorHarness(materialRepository, artifactRepository, yield* tutorOptions);
    const session = AgentSession.make(harness);

    const persistTurn = (sessionId: string, messages: readonly AgentMessage[]) =>
      sessions.appendMessages({ sessionId, messages });

    // A turn completed when its last message is the tutor's answer.
    const turnCompleted = (messages: readonly AgentMessage[]) => messages.at(-1)?.role === "assistant";

    // What the student has open, as a one-turn system note. An unknown artifact
    // id is ignored rather than failing the turn.
    const uiContextNote = (input: TutorChatRequest): Effect.Effect<string | undefined> =>
      input.context?.openArtifactId === undefined
        ? Effect.succeed(undefined)
        : artifactRepository.getArtifact(input.context.openArtifactId).pipe(
            Effect.map((artifact) => describeUiContext(artifact, { openQuestionId: input.context?.openQuestionId, openNodeId: input.context?.openNodeId })),
            Effect.catch(() => Effect.succeed(undefined))
          );

    return {
      sendMessage: (input) => Effect.gen(function* () {
        const stored = yield* sessions.getSession(input.sessionId);
        const systemNote = yield* uiContextNote(input);
        const result = yield* session.run({
          input: input.input,
          messages: stored.messages,
          maxSteps: input.maxSteps ?? 8,
          ...(systemNote === undefined ? {} : { systemNote })
        }).pipe(Effect.provide(harness.layer));

        if (turnCompleted(result.newMessages)) {
          yield* persistTurn(input.sessionId, result.newMessages);
        }

        return result;
      }),

      streamMessage: (input) => Stream.unwrap(Effect.gen(function* () {
        const stored = yield* sessions.getSession(input.sessionId);
        const systemNote = yield* uiContextNote(input);
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
          maxSteps: input.maxSteps ?? 8,
          ...(systemNote === undefined ? {} : { systemNote })
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
