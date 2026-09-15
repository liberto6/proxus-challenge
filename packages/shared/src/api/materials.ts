import { Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi";
import { MaterialListResponse, PdfMaterial } from "../schemas/material.ts";

export const maxMaterialUploadBytes = 20 * 1024 * 1024;

/** Multipart body of `POST /materials`: one PDF file and an optional display title. */
export const MaterialUpload = Schema.Struct({
  file: Multipart.SingleFileSchema,
  title: Schema.optional(Schema.String)
}).pipe(HttpApiSchema.asMultipart({ maxFileSize: maxMaterialUploadBytes, maxParts: 2 }));

export class MaterialsApi extends HttpApiGroup.make("materials")
  .add(
    HttpApiEndpoint.get("list", "/", {
      success: MaterialListResponse
    }),
    HttpApiEndpoint.get("get", "/:id", {
      params: {
        id: Schema.String
      },
      success: PdfMaterial
    }),
    HttpApiEndpoint.post("upload", "/", {
      payload: MaterialUpload,
      success: PdfMaterial,
      error: HttpApiError.BadRequest
    }),
    HttpApiEndpoint.delete("remove", "/:id", {
      params: {
        id: Schema.String
      },
      error: HttpApiError.NotFound
    })
  )
  .prefix("/materials")
{}
