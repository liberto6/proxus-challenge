import { isMain } from "../lib/is-main.ts";
import { Console, Effect, Layer, Stream } from "effect";
import { Model as AiModel } from "effect/unstable/ai";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AgentSession, SessionRepository } from "../domain/agents/harness/index.ts";
import { makeAcademicTutorHarness } from "../domain/agents/academic-tutor.ts";
import { MaterialRepository } from "../domain/materials/material.ts";
import { ArtifactRepository } from "../domain/artifacts/artifact.ts";
import { GeminiModel } from "../infra/agents/gemini-language-model.ts";
import { FileSessionRepository } from "../infra/agents/file-session-repository.ts";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";
import { FileArtifactRepository } from "../infra/artifacts/file-artifact-repository.ts";

/**
 * CLI entrypoint: runs one tutor turn against the local `.data` storage.
 *
 *   pnpm --filter @proxus/server run agent:tutor "list my uploaded materials"
 */
export const academicTutorAgent = Effect.gen(function* () {
  const provider = yield* AiModel.ProviderName;
  const modelName = yield* AiModel.ModelName;
  const sessionRepository = yield* SessionRepository;
  const materialRepository = yield* MaterialRepository;
  const artifactRepository = yield* ArtifactRepository;
  const task = process.argv.slice(2).join(" ").trim() || "List my uploaded materials.";
  const sessionId = process.env.AGENT_SESSION_ID ?? "academic-tutor-demo";
  const storedSession = yield* sessionRepository.getSession(sessionId).pipe(
    Effect.catchTag("SessionNotFound", () => sessionRepository.makeSession({ id: sessionId }))
  );

  const harness = makeAcademicTutorHarness(materialRepository, artifactRepository);
  const session = AgentSession.make(harness);

  console.log(`Provider: ${provider}`);
  console.log(`Model: ${modelName}`);
  console.log(`Session: ${sessionId}`);
  console.log("Conversation messages:");

  const events = yield* session.stream({
    input: task,
    messages: storedSession.messages,
    maxSteps: 8
  }).pipe(
    Stream.provide(harness.layer),
    Stream.tap((event) => Effect.gen(function* () {
      if (event.type === "message") {
        yield* sessionRepository.appendMessages({
          sessionId,
          messages: [event.message]
        });
        yield* Console.log(JSON.stringify(event.message, null, 2));
      } else if (event.type === "progress") {
        yield* Console.log(`… ${event.label}`);
      } else {
        yield* Console.error(`Turn failed${event.retryable ? " (retryable)" : ""}: ${event.message}`);
      }
    })),
    Stream.runCollect
  );

  let output = "";
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === "message" && event.message.role === "assistant") {
      output = event.message.content;
      break;
    }
    if (event?.type === "error") {
      output = event.message;
      break;
    }
  }

  console.log(output);

  return output;
}).pipe(
  Effect.provide(Layer.mergeAll(
    GeminiModel,
    FileSessionRepository.layer(".data/agent-sessions").pipe(
      Layer.provide(NodeServices.layer)
    ),
    FileMaterialRepository.layer(".data/materials/pdfs").pipe(
      Layer.provide(PopplerPdfService.layer),
      Layer.provide(NodeServices.layer)
    ),
    FileArtifactRepository.layer(".data/artifacts").pipe(
      Layer.provide(NodeServices.layer)
    )
  ))
);

if (isMain(import.meta.url)) {
  Effect.runPromise(academicTutorAgent);
}
