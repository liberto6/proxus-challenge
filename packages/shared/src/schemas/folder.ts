import { Schema } from "effect";

/**
 * A folder groups the student's materials, conversations and practice. Each
 * item carries an optional `folderId`; items without one belong to the
 * `General` folder, which always exists and cannot be deleted.
 */
export const generalFolderId = "general";
export const generalFolderTitle = "General";

export const folderTitleLimits = { min: 1, max: 60 } as const;

export const Folder = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.String
});
export type Folder = typeof Folder.Type;

export const FolderListResponse = Schema.Struct({
  folders: Schema.Array(Folder)
});
export type FolderListResponse = typeof FolderListResponse.Type;

export const CreateFolderInput = Schema.Struct({
  title: Schema.String
});
export type CreateFolderInput = typeof CreateFolderInput.Type;

export const RenameFolderInput = Schema.Struct({
  title: Schema.String
});
export type RenameFolderInput = typeof RenameFolderInput.Type;

/** A folder cannot be deleted while it still holds content; the counts tell the student why. */
export class FolderNotEmpty extends Schema.TaggedErrorClass<FolderNotEmpty>()("FolderNotEmpty", {
  materials: Schema.Number,
  sessions: Schema.Number,
  artifacts: Schema.Number
}) {}

/** The `General` folder, or a title already used by another folder. */
export class FolderTitleTaken extends Schema.TaggedErrorClass<FolderTitleTaken>()("FolderTitleTaken", {
  title: Schema.String
}) {}

/** Query filter shared by the listings that can be scoped to one folder. */
export const FolderQuery = Schema.Struct({
  folderId: Schema.optional(Schema.String)
});
export type FolderQuery = typeof FolderQuery.Type;

export const folderOf = (item: { readonly folderId?: string | undefined }): string => item.folderId ?? generalFolderId;
