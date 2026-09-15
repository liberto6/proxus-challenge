import { Effect, FileSystem, Layer } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { ProxusApi } from "@proxus/shared";
import { TutorChatService } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { SessionRepository } from "../../domain/agents/harness/index.ts";
import { ArtifactRepository, type Artifact } from "../../domain/artifacts/artifact.ts";
import { MaterialRepository, titleFromFileName } from "../../domain/materials/material.ts";

export const TutorHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "tutor",
  Effect.fn(function* (handlers) {
    const tutor = yield* TutorChatService;
    const sessions = yield* SessionRepository;

    return handlers
      .handle("chat", ({ payload }) =>
        tutor.sendMessage(payload).pipe(Effect.orDie)
      )
      .handle("createSession", () =>
        sessions.makeSession({ id: crypto.randomUUID() }).pipe(Effect.orDie)
      )
      .handle("listSessions", () =>
        sessions.listSessions().pipe(
          Effect.map((items) => ({ sessions: items })),
          Effect.orDie
        )
      )
      .handle("getSession", ({ params }) =>
        sessions.getSession(params.id).pipe(Effect.orDie)
      );
  })
);

export const MaterialsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "materials",
  Effect.fn(function* (handlers) {
    const materials = yield* MaterialRepository;
    const fs = yield* FileSystem.FileSystem;

    return handlers
      .handle("list", () => materials.list().pipe(
        Effect.map((items) => ({ materials: items })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => materials.get(params.id).pipe(Effect.orDie))
      .handle("upload", ({ payload }) => Effect.gen(function* () {
        // The multipart file is buffered to a temporary path by the platform.
        const bytes = yield* fs.readFile(payload.file.path).pipe(Effect.orDie);
        const title = payload.title === undefined || payload.title.trim().length === 0
          ? titleFromFileName(payload.file.name)
          : payload.title;
        return yield* materials.save({ title, fileName: payload.file.name, bytes }).pipe(
          Effect.catchTag("InvalidMaterialFile", (error) =>
            Effect.logWarning("material upload rejected").pipe(
              Effect.annotateLogs({ fileName: error.fileName, reason: error.reason }),
              Effect.andThen(new HttpApiError.BadRequest())
            )
          ),
          Effect.catchTag("MaterialRepositoryError", (error) => Effect.die(error))
        );
      }))
      .handle("remove", ({ params }) => materials.remove(params.id).pipe(
        Effect.catchTag("MaterialNotFound", () => new HttpApiError.NotFound()),
        Effect.catchTag("MaterialRepositoryError", (error) => Effect.die(error))
      ));
  })
);

const artifactSummary = (artifact: Artifact) => ({
  id: artifact.id,
  kind: artifact.kind,
  title: artifact.title
});

export const ArtifactsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "artifacts",
  Effect.fn(function* (handlers) {
    const artifacts = yield* ArtifactRepository;

    return handlers
      .handle("list", ({ query }) => artifacts.listArtifacts({ kind: query.kind }).pipe(
        Effect.map((items) => ({ artifacts: items.map(artifactSummary) })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => artifacts.getArtifact(params.id).pipe(Effect.orDie))
      .handle("submit", ({ params, payload }) => artifacts.submitAttempt({
        ...payload,
        artifactId: params.id
      }).pipe(
        Effect.flatMap((attempt) => artifacts.gradeAttempt(attempt.id)),
        Effect.orDie
      ));
  })
);

export const HttpHandlersLive = Layer.mergeAll(
  TutorHttpHandlers,
  MaterialsHttpHandlers,
  ArtifactsHttpHandlers
);
