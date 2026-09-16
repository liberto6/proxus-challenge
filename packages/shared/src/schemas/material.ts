import { Schema } from "effect";

export const PdfMaterial = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  fileName: Schema.String,
  pageCount: Schema.Number,
  uploadedAt: Schema.String,
  /** Folder the PDF belongs to; absent means the General folder. */
  folderId: Schema.optional(Schema.String)
});
export type PdfMaterial = typeof PdfMaterial.Type;

export const PageImage = Schema.Struct({
  page: Schema.Number,
  mediaType: Schema.Literal("image/png"),
  data: Schema.String
});
export type PageImage = typeof PageImage.Type;

export const MaterialPageImages = Schema.Struct({
  type: Schema.Literal("material-page-images"),
  material: PdfMaterial,
  pages: Schema.Array(PageImage)
});
export type MaterialPageImages = typeof MaterialPageImages.Type;

/** One rendered page, for previews in the interface (`GET /materials/:id/pages/:page`). */
export const MaterialPagePreview = Schema.Struct({
  materialId: Schema.String,
  page: Schema.Number,
  pageCount: Schema.Number,
  mediaType: Schema.Literal("image/png"),
  /** Data URI of the rendered page. */
  data: Schema.String
});
export type MaterialPagePreview = typeof MaterialPagePreview.Type;

export const MaterialListResponse = Schema.Struct({
  materials: Schema.Array(PdfMaterial)
});
export type MaterialListResponse = typeof MaterialListResponse.Type;
