import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Folder } from "@proxus/shared";
import {
  FolderNotFound,
  FolderRepository,
  FolderRepositoryError,
  FolderTitleTakenError,
  folderIdFor,
  folderTitleKey,
  generalFolder,
  generalFolderId,
  normalizeFolderTitle,
  type FolderRepository as FolderRepositoryType
} from "../../domain/folders/folder.ts";

const FolderFromJson = Schema.fromJsonString(Folder);

/**
 * One JSON file per folder under `.data/folders`. General is not stored until
 * it is renamed; until then `list` prepends it.
 */
export const FileFolderRepository = {
  make: (directory: string): Effect.Effect<FolderRepositoryType, never, FileSystem.FileSystem | Path.Path> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mapError = (reason: unknown) => new FolderRepositoryError({ reason });
    const folderPath = (id: string) => path.join(directory, `${encodeURIComponent(id)}.json`);

    const readStored = (): Effect.Effect<readonly Folder[], FolderRepositoryError> => Effect.gen(function* () {
      const exists = yield* fs.exists(directory).pipe(Effect.mapError(mapError));
      if (!exists) return [];
      const entries = yield* fs.readDirectory(directory).pipe(Effect.mapError(mapError));
      const folders = yield* Effect.forEach(
        entries.filter((entry) => entry.endsWith(".json")),
        (entry) => fs.readFileString(path.join(directory, entry)).pipe(
          Effect.mapError(mapError),
          Effect.flatMap((text) => Schema.decodeUnknownEffect(FolderFromJson)(text).pipe(Effect.mapError(mapError)))
        ),
        { concurrency: 4 }
      );
      return folders;
    });

    const write = (folder: Folder): Effect.Effect<void, FolderRepositoryError> => Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(mapError));
      yield* fs.writeFileString(folderPath(folder.id), `${JSON.stringify(folder, null, 2)}\n`).pipe(Effect.mapError(mapError));
    });

    const list = () => readStored().pipe(Effect.map((stored) => {
      const general = stored.find((folder) => folder.id === generalFolderId) ?? generalFolder;
      const rest = stored.filter((folder) => folder.id !== generalFolderId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return [general, ...rest];
    }));

    const get = (id: string) => list().pipe(Effect.flatMap((folders) => {
      const found = folders.find((folder) => folder.id === id);
      return found === undefined ? Effect.fail(new FolderNotFound({ folderId: id })) : Effect.succeed(found);
    }));

    const ensureTitleFree = (title: string, exceptId?: string) => list().pipe(Effect.flatMap((folders) => {
      const key = folderTitleKey(title);
      const clash = folders.find((folder) => folder.id !== exceptId && folderTitleKey(folder.title) === key);
      return clash === undefined ? Effect.void : Effect.fail(new FolderTitleTakenError({ title }));
    }));

    const create = (rawTitle: string) => Effect.gen(function* () {
      const title = yield* normalizeFolderTitle(rawTitle);
      yield* ensureTitleFree(title);
      const folder: Folder = { id: folderIdFor(title), title, createdAt: new Date().toISOString() };
      yield* write(folder);
      return folder;
    });

    const rename = (id: string, rawTitle: string) => Effect.gen(function* () {
      const current = yield* get(id);
      const title = yield* normalizeFolderTitle(rawTitle);
      yield* ensureTitleFree(title, id);
      const folder: Folder = { ...current, title };
      yield* write(folder);
      return folder;
    });

    const remove = (id: string) => Effect.gen(function* () {
      if (id === generalFolderId) {
        return yield* new FolderNotFound({ folderId: id });
      }
      yield* get(id);
      yield* fs.remove(folderPath(id)).pipe(Effect.mapError(mapError));
    });

    return { list, get, create, rename, remove };
  }),
  layer: (directory: string) => Layer.effect(FolderRepository)(FileFolderRepository.make(directory))
};
