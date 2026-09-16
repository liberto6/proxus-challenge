import { Schema } from "effect";

/**
 * A folder groups the student's materials, conversations and practice. Each
 * item carries an optional `folderId`; items without one belong to the
 * `General` folder, which always exists and cannot be deleted.
 */
export const generalFolderId = "general";
export const generalFolderTitle = "General";

export const folderTitleLimits = { min: 1, max: 60 } as const;

/**
 * The course a folder is about, chosen from a catalogue (university, degree,
 * subject). Optional: a folder without it works the same; with it, the app can
 * offer what is specific to that subject (tutoring between students).
 */
export const FolderSubject = Schema.Struct({
  university: Schema.String,
  degree: Schema.String,
  /** Year of the degree the subject belongs to, when the catalogue knows it. */
  year: Schema.optional(Schema.Number),
  name: Schema.String
});
export type FolderSubject = typeof FolderSubject.Type;

export const Folder = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.String,
  subject: Schema.optional(FolderSubject)
});
export type Folder = typeof Folder.Type;

export const FolderListResponse = Schema.Struct({
  folders: Schema.Array(Folder)
});
export type FolderListResponse = typeof FolderListResponse.Type;

export const CreateFolderInput = Schema.Struct({
  title: Schema.String,
  subject: Schema.optional(FolderSubject)
});
export type CreateFolderInput = typeof CreateFolderInput.Type;

/** `subject` absent keeps the current one; `null` clears it. */
export const UpdateFolderInput = Schema.Struct({
  title: Schema.String,
  subject: Schema.optional(Schema.NullOr(FolderSubject))
});
export type UpdateFolderInput = typeof UpdateFolderInput.Type;

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
