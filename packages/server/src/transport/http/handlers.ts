import { Effect, FileSystem, Layer } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { FolderNotEmpty, FolderTitleTaken, ProxusApi } from "@proxus/shared";
import { TutorChatService } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { SessionRepository } from "../../domain/agents/harness/index.ts";
import { ArtifactRepository, type Artifact } from "../../domain/artifacts/artifact.ts";
import { buildDictationSamples, toArtifactView } from "../../domain/artifacts/explain.ts";
import { FolderRepository, folderOf, isFolderEmpty } from "../../domain/folders/folder.ts";
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
      .handle("createSession", ({ payload }) =>
        sessions.makeSession({ id: crypto.randomUUID(), folderId: payload.folderId }).pipe(Effect.orDie)
      )
      .handle("listSessions", ({ query }) =>
        sessions.listSessions({ folderId: query.folderId }).pipe(
          Effect.map((items) => ({ sessions: items })),
          Effect.orDie
        )
      )
      .handle("getSession", ({ params }) =>
        sessions.getSession(params.id).pipe(Effect.orDie)
      )
      .handle("removeSession", ({ params }) =>
        sessions.removeSession(params.id).pipe(
          Effect.catchTag("SessionNotFound", () => new HttpApiError.NotFound()),
          Effect.catch((error) => Effect.die(error))
        )
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
      .handle("list", ({ query }) => materials.list().pipe(
        Effect.map((items) => ({ materials: items.filter((material) => query.folderId === undefined || folderOf(material) === query.folderId) })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => materials.get(params.id).pipe(Effect.orDie))
      .handle("getPage", ({ params }) => Effect.gen(function* () {
        const material = yield* materials.get(params.id).pipe(
          Effect.catchTag("MaterialNotFound", () => new HttpApiError.NotFound()),
          Effect.catchTag("MaterialRepositoryError", (error) => Effect.die(error))
        );
        if (!Number.isInteger(params.page) || params.page < 1 || params.page > material.pageCount) {
          return yield* new HttpApiError.BadRequest();
        }
        const rendered = yield* materials.renderPages(material.id, [params.page]).pipe(Effect.orDie);
        const image = rendered.pages[0];
        if (image === undefined) {
          return yield* new HttpApiError.NotFound();
        }
        return { materialId: material.id, page: image.page, pageCount: material.pageCount, mediaType: image.mediaType, data: image.data };
      }))
      .handle("upload", ({ payload }) => Effect.gen(function* () {
        // The multipart file is buffered to a temporary path by the platform.
        const bytes = yield* fs.readFile(payload.file.path).pipe(Effect.orDie);
        const title = payload.title === undefined || payload.title.trim().length === 0
          ? titleFromFileName(payload.file.name)
          : payload.title;
        const folderId = payload.folderId === undefined || payload.folderId.trim().length === 0 ? undefined : payload.folderId;
        return yield* materials.save({ title, fileName: payload.file.name, bytes, folderId }).pipe(
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
  title: artifact.title,
  ...(artifact.source === undefined ? {} : { source: artifact.source }),
  ...(artifact.createdAt === undefined ? {} : { createdAt: artifact.createdAt }),
  ...(artifact.folderId === undefined ? {} : { folderId: artifact.folderId })
});

export const ArtifactsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "artifacts",
  Effect.fn(function* (handlers) {
    const artifacts = yield* ArtifactRepository;

    return handlers
      .handle("list", ({ query }) => artifacts.listArtifacts({ kind: query.kind, folderId: query.folderId }).pipe(
        Effect.map((items) => ({ artifacts: items.map(artifactSummary) })),
        Effect.orDie
      ))
      // The web never receives an explanation objective's solutions.
      .handle("get", ({ params }) => artifacts.getArtifact(params.id).pipe(Effect.map(toArtifactView), Effect.orDie))
      .handle("submit", ({ params, payload }) => artifacts.submitAttempt({
        ...payload,
        artifactId: params.id
      }).pipe(
        Effect.flatMap((attempt) => artifacts.gradeAttempt(attempt.id)),
        Effect.orDie
      ))
      .handle("listAttempts", ({ params }) => artifacts.listAttempts(params.id).pipe(
        Effect.map((attempts) => ({ attempts })),
        Effect.orDie
      ))
      .handle("dictationSamples", ({ params }) => artifacts.getArtifact(params.id).pipe(
        Effect.catch((error) => error._tag === "ArtifactNotFound" ? new HttpApiError.NotFound() : Effect.die(error)),
        Effect.flatMap((artifact) => artifact.kind === "explain"
          ? Effect.succeed({ samples: buildDictationSamples(artifact) })
          : new HttpApiError.NotFound())
      ));
  })
);

/**
 * Folders. Deleting one is refused while it still holds materials,
 * conversations or artifacts: the counts go back so the interface can say why.
 */
export const FoldersHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "folders",
  Effect.fn(function* (handlers) {
    const folders = yield* FolderRepository;
    const materials = yield* MaterialRepository;
    const sessions = yield* SessionRepository;
    const artifacts = yield* ArtifactRepository;

    // An empty conversation is not content: opening a folder creates one.
    const contentsOf = (folderId: string) => Effect.all({
      materials: materials.list().pipe(Effect.map((items) => items.filter((item) => folderOf(item) === folderId).length)),
      sessions: sessions.listSessions({ folderId }).pipe(Effect.map((items) => items.filter((item) => item.messageCount > 0).length)),
      artifacts: artifacts.listArtifacts({ folderId }).pipe(Effect.map((items) => items.length))
    }).pipe(Effect.orDie);

    const removeEmptySessions = (folderId: string) => sessions.listSessions({ folderId }).pipe(
      Effect.flatMap((items) => Effect.forEach(items.filter((item) => item.messageCount === 0), (item) => sessions.removeSession(item.id), { discard: true })),
      Effect.orDie
    );

    return handlers
      .handle("list", () => folders.list().pipe(
        Effect.map((items) => ({ folders: items })),
        Effect.orDie
      ))
      .handle("create", ({ payload }) => folders.create(payload.title).pipe(
        Effect.catchTag("FolderTitleInvalid", () => new HttpApiError.BadRequest()),
        Effect.catchTag("FolderTitleTaken", (error) => new FolderTitleTaken({ title: error.title })),
        Effect.catchTag("FolderRepositoryError", (error) => Effect.die(error))
      ))
      .handle("rename", ({ params, payload }) => folders.rename(params.id, payload.title).pipe(
        Effect.catchTag("FolderNotFound", () => new HttpApiError.NotFound()),
        Effect.catchTag("FolderTitleInvalid", () => new HttpApiError.BadRequest()),
        Effect.catchTag("FolderTitleTaken", (error) => new FolderTitleTaken({ title: error.title })),
        Effect.catchTag("FolderRepositoryError", (error) => Effect.die(error))
      ))
      .handle("remove", ({ params }) => Effect.gen(function* () {
        yield* folders.get(params.id).pipe(
          Effect.catchTag("FolderNotFound", () => new HttpApiError.NotFound()),
          Effect.catchTag("FolderRepositoryError", (error) => Effect.die(error))
        );
        const contents = yield* contentsOf(params.id);
        if (!isFolderEmpty(contents)) {
          return yield* new FolderNotEmpty(contents);
        }
        yield* removeEmptySessions(params.id);
        yield* folders.remove(params.id).pipe(
          Effect.catchTag("FolderNotFound", () => new HttpApiError.NotFound()),
          Effect.catchTag("FolderRepositoryError", (error) => Effect.die(error))
        );
      }));
  })
);

export const HttpHandlersLive = Layer.mergeAll(
  TutorHttpHandlers,
  MaterialsHttpHandlers,
  ArtifactsHttpHandlers,
  FoldersHttpHandlers
);
