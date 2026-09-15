import { Context, Data, Effect } from "effect";

export interface PdfMaterial {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly pageCount: number;
  readonly uploadedAt: string;
}

export interface PageImage {
  readonly page: number;
  readonly mediaType: "image/png";
  readonly data: string;
}

export interface MaterialPageImages {
  readonly type: "material-page-images";
  readonly material: PdfMaterial;
  readonly pages: readonly PageImage[];
}

export class MaterialNotFound extends Data.TaggedError("MaterialNotFound")<{
  readonly materialId: string;
}> {}

export class InvalidPageRange extends Data.TaggedError("InvalidPageRange")<{
  readonly range: string;
  readonly reason: string;
}> {}

export class MaterialRepositoryError extends Data.TaggedError("MaterialRepositoryError")<{
  readonly reason: unknown;
}> {}

/** The uploaded file is not a usable PDF (wrong format, empty, unreadable). */
export class InvalidMaterialFile extends Data.TaggedError("InvalidMaterialFile")<{
  readonly fileName: string;
  readonly reason: string;
}> {}

export interface SaveMaterialInput {
  /** Display title; the material id is derived from it. */
  readonly title: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface MaterialRepository {
  readonly list: () => Effect.Effect<readonly PdfMaterial[], MaterialRepositoryError>;
  readonly get: (id: string) => Effect.Effect<PdfMaterial, MaterialNotFound | MaterialRepositoryError>;
  readonly renderPages: (
    id: string,
    pages: readonly number[]
  ) => Effect.Effect<MaterialPageImages, MaterialNotFound | MaterialRepositoryError>;
  /** Validates and stores a PDF; returns the new material. */
  readonly save: (input: SaveMaterialInput) => Effect.Effect<PdfMaterial, InvalidMaterialFile | MaterialRepositoryError>;
  readonly remove: (id: string) => Effect.Effect<void, MaterialNotFound | MaterialRepositoryError>;
}

/** Stable, URL-safe id from a title plus a short random suffix to avoid collisions. */
export const materialIdFor = (title: string, suffix: string = crypto.randomUUID().slice(0, 6)): string => {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${slug.length > 0 ? slug : "material"}-${suffix}`;
};

/** Title from an uploaded file name: extension removed, separators as spaces. */
export const titleFromFileName = (fileName: string): string => {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  return base.length > 0 ? base : "Material";
};

export const MaterialRepository = Context.Service<MaterialRepository>(
  "@proxus/server/materials/MaterialRepository"
);

export const parsePageSelection = (
  selection: string
): Effect.Effect<readonly number[], InvalidPageRange> => Effect.gen(function* () {
  const pages = new Set<number>();
  const parts = selection.split(",").map((part) => part.trim()).filter((part) => part.length > 0);

  if (parts.length === 0) {
    return yield* new InvalidPageRange({ range: selection, reason: "Expected pages like 10 or 13-20" });
  }

  for (const part of parts) {
    const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (rangeMatch !== null) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        return yield* new InvalidPageRange({ range: selection, reason: `Invalid range: ${part}` });
      }
      for (let page = start; page <= end; page++) {
        pages.add(page);
      }
      continue;
    }

    const page = Number(part);
    if (!Number.isSafeInteger(page) || page < 1) {
      return yield* new InvalidPageRange({ range: selection, reason: `Invalid page: ${part}` });
    }
    pages.add(page);
  }

  return [...pages].sort((a, b) => a - b);
});

export const isMaterialPageImages = (value: unknown): value is MaterialPageImages => {
  if (typeof value !== "object" || value === null || !("type" in value) || value.type !== "material-page-images") {
    return false;
  }

  const candidate = value as { readonly pages?: unknown };
  return Array.isArray(candidate.pages);
};
