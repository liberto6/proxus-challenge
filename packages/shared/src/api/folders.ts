import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { CreateFolderInput, Folder, FolderListResponse, FolderNotEmpty, FolderTitleTaken, UpdateFolderInput } from "../schemas/folder.ts";

/**
 * Folders group materials, conversations and practice. There is no move or
 * copy between folders on purpose: a PDF belongs to one folder; to use it
 * elsewhere the student uploads it again.
 */
export class FoldersApi extends HttpApiGroup.make("folders")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: FolderListResponse
    }),
    HttpApiEndpoint.post("create", "/", {
      payload: CreateFolderInput,
      success: Folder,
      error: [HttpApiError.BadRequest, HttpApiSchema.status(409)(FolderTitleTaken)]
    }),
    HttpApiEndpoint.patch("update", "/:id", {
      params: {
        id: Schema.String
      },
      payload: UpdateFolderInput,
      success: Folder,
      error: [HttpApiError.BadRequest, HttpApiError.NotFound, HttpApiSchema.status(409)(FolderTitleTaken)]
    }),
    HttpApiEndpoint.delete("remove", "/:id", {
      params: {
        id: Schema.String
      },
      error: [HttpApiError.NotFound, HttpApiSchema.status(409)(FolderNotEmpty)]
    })
  )
  .prefix("/folders")
{}
