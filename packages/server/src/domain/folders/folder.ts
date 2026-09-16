import { Context, Data, Effect, Option } from "effect";
import { folderOf, folderTitleLimits, generalFolderId, generalFolderTitle, type Folder, type FolderSubject } from "@proxus/shared";

/**
 * Folders group materials, conversations and practice. Membership lives on
 * each item (`folderId`, absent = General), so the repository only stores the
 * folders themselves. `General` always exists: it is virtual until renamed.
 */
export { Folder, FolderSubject, folderOf, generalFolderId, generalFolderTitle } from "@proxus/shared";

export class FolderNotFound extends Data.TaggedError("FolderNotFound")<{
  readonly folderId: string;
}> {}

export class FolderTitleInvalid extends Data.TaggedError("FolderTitleInvalid")<{
  readonly title: string;
  readonly reason: string;
}> {}

export class FolderTitleTakenError extends Data.TaggedError("FolderTitleTaken")<{
  readonly title: string;
}> {}

export class FolderRepositoryError extends Data.TaggedError("FolderRepositoryError")<{
  readonly reason: unknown;
}> {}

export interface CreateFolder {
  readonly title: string;
  readonly subject?: FolderSubject | undefined;
}

export interface UpdateFolder {
  readonly title: string;
  /** Absent keeps the current subject; `null` clears it. */
  readonly subject?: FolderSubject | null | undefined;
}

export interface FolderRepository {
  /** All folders, General first, the rest by creation date. */
  readonly list: () => Effect.Effect<readonly Folder[], FolderRepositoryError>;
  readonly get: (id: string) => Effect.Effect<Folder, FolderNotFound | FolderRepositoryError>;
  readonly create: (input: CreateFolder) => Effect.Effect<Folder, FolderTitleInvalid | FolderTitleTakenError | FolderRepositoryError>;
  readonly update: (id: string, input: UpdateFolder) => Effect.Effect<Folder, FolderNotFound | FolderTitleInvalid | FolderTitleTakenError | FolderRepositoryError>;
  /** Deletes the folder record only; the caller checks it is empty first. General cannot be removed. */
  readonly remove: (id: string) => Effect.Effect<void, FolderNotFound | FolderRepositoryError>;
}

export const FolderRepository = Context.Service<FolderRepository>("@proxus/server/folders/FolderRepository");

/**
 * The folder a tutor turn works in. The chat service provides it from the
 * conversation's folder; commands filter what they list and refuse what lies
 * outside. Without it (CLI, older evals) nothing is filtered.
 */
export interface FolderScope {
  readonly folderId: string;
}

export const FolderScope = Context.Service<FolderScope>("@proxus/server/folders/FolderScope");

/** The folder of the current turn, or `undefined` when the turn is not scoped. */
export const currentFolder: Effect.Effect<string | undefined> = Effect.serviceOption(FolderScope).pipe(
  Effect.map((scope) => Option.isSome(scope) ? scope.value.folderId : undefined)
);

/** Whether an item belongs to the scope (`undefined` scope admits everything). */
export const inScope = (scope: string | undefined, item: { readonly folderId?: string | undefined }): boolean =>
  scope === undefined || folderOf(item) === scope;

/** The General folder as shown when nothing has been stored for it yet. */
export const generalFolder: Folder = { id: generalFolderId, title: generalFolderTitle, createdAt: "1970-01-01T00:00:00.000Z" };

/** Trims and checks a title; the comparison key ignores case and accents so "Biología" and "biologia" clash. */
export const normalizeFolderTitle = (title: string): Effect.Effect<string, FolderTitleInvalid> => {
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (trimmed.length < folderTitleLimits.min) {
    return Effect.fail(new FolderTitleInvalid({ title, reason: "El nombre no puede estar vacío" }));
  }
  if (trimmed.length > folderTitleLimits.max) {
    return Effect.fail(new FolderTitleInvalid({ title, reason: `El nombre no puede superar ${folderTitleLimits.max} caracteres` }));
  }
  return Effect.succeed(trimmed);
};

export const folderTitleKey = (title: string): string =>
  title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();

/** Stable, URL-safe id from a title plus a short random suffix. */
export const folderIdFor = (title: string, suffix: string = crypto.randomUUID().slice(0, 6)): string => {
  const slug = folderTitleKey(title).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return `${slug.length > 0 ? slug : "carpeta"}-${suffix}`;
};

/** What a folder still holds; a folder is deleted only when every count is zero. */
export interface FolderContents {
  readonly materials: number;
  readonly sessions: number;
  readonly artifacts: number;
}

export const isFolderEmpty = (contents: FolderContents): boolean =>
  contents.materials === 0 && contents.sessions === 0 && contents.artifacts === 0;
