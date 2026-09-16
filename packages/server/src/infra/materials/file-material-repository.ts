import { Cause, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  InvalidMaterialFile,
  MaterialNotFound,
  MaterialRepository,
  MaterialRepositoryError,
  materialIdFor,
  type MaterialPageImages,
  type MaterialRepository as MaterialRepositoryType,
  type PdfMaterial,
  type SaveMaterialInput
} from "../../domain/materials/material.ts";
import { PdfService } from "../../domain/materials/pdf-service.ts";

/**
 * Materials as PDF files in one directory.
 *
 * Layout: `<id>.pdf` plus an optional `<id>.meta.json` with the display title
 * and upload time. Files copied by hand without a sidecar keep working: their
 * id and title are the file name.
 */

interface PdfFile {
  readonly material: PdfMaterial;
  readonly path: string;
}

const MaterialMeta = Schema.Struct({
  title: Schema.String,
  uploadedAt: Schema.String,
  folderId: Schema.optional(Schema.String)
});
const MaterialMetaFromJson = Schema.fromJsonString(MaterialMeta);

const pdfHeader = "%PDF-";

export const FileMaterialRepository = {
  make: (directory: string): Effect.Effect<MaterialRepositoryType, never, FileSystem.FileSystem | Path.Path | PdfService> => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const pdf = yield* PdfService;
    const mapError = (reason: unknown) => new MaterialRepositoryError({ reason });

    const pdfPath = (id: string) => path.join(directory, `${id}.pdf`);
    const metaPath = (id: string) => path.join(directory, `${id}.meta.json`);

    const readMeta = (id: string) => Effect.gen(function* () {
      const exists = yield* fs.exists(metaPath(id)).pipe(Effect.mapError(mapError));
      if (!exists) {
        return Option.none<typeof MaterialMeta.Type>();
      }
      const text = yield* fs.readFileString(metaPath(id)).pipe(Effect.mapError(mapError));
      return Option.some(yield* Schema.decodeUnknownEffect(MaterialMetaFromJson)(text).pipe(Effect.mapError(mapError)));
    });

    const listFiles = (): Effect.Effect<readonly PdfFile[], MaterialRepositoryError> => Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(
        Effect.mapError(mapError)
      );

      const entries = yield* fs.readDirectory(directory).pipe(
        Effect.mapError(mapError)
      );

      return yield* Effect.forEach(
        entries.filter((entry) => path.extname(entry).toLowerCase() === ".pdf").sort(),
        (fileName): Effect.Effect<PdfFile, MaterialRepositoryError> => Effect.gen(function* () {
          const id = path.basename(fileName, ".pdf");
          const fullPath = path.join(directory, fileName);
          const stat = yield* fs.stat(fullPath).pipe(
            Effect.mapError(mapError)
          );
          const meta = yield* readMeta(id);
          const material: PdfMaterial = {
            id,
            title: Option.map(meta, (value) => value.title).pipe(Option.getOrElse(() => id)),
            fileName,
            pageCount: yield* pdf.pageCount(fullPath).pipe(Effect.mapError(mapError)),
            uploadedAt: Option.map(meta, (value) => value.uploadedAt).pipe(
              Option.getOrElse(() => Option.getOrElse(stat.mtime, () => new Date(0)).toISOString())
            ),
            ...(Option.flatMap(meta, (value) => Option.fromNullishOr(value.folderId)).pipe(Option.match({ onNone: () => ({}), onSome: (folderId) => ({ folderId }) })))
          };
          return { material, path: fullPath };
        }),
        { concurrency: 1 }
      );
    });

    const getFile = (id: string): Effect.Effect<PdfFile, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const files = yield* listFiles();
      const found = files.find((file) => file.material.id === id);
      if (found === undefined) {
        return yield* new MaterialNotFound({ materialId: id });
      }
      return found;
    });

    const list = () => listFiles().pipe(
      Effect.map((files) => files.map((file) => file.material))
    );

    const get = (id: string) => getFile(id).pipe(
      Effect.map((file) => file.material)
    );

    const renderPages = (
      id: string,
      pages: readonly number[]
    ): Effect.Effect<MaterialPageImages, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const file = yield* getFile(id);
      const invalidPage = pages.find((page) => page < 1 || page > file.material.pageCount);
      if (invalidPage !== undefined) {
        return yield* new MaterialRepositoryError({
          reason: `Page ${invalidPage} is outside 1-${file.material.pageCount} for material ${id}`
        });
      }

      const images = yield* Effect.forEach(pages, (page) => pdf.renderPage({ path: file.path, page }).pipe(
        Effect.mapError(mapError)
      ), { concurrency: 1 });

      return {
        type: "material-page-images" as const,
        material: file.material,
        pages: images
      };
    });

    const save = (input: SaveMaterialInput): Effect.Effect<PdfMaterial, InvalidMaterialFile | MaterialRepositoryError> => Effect.gen(function* () {
      const title = input.title.trim();
      if (title.length === 0) {
        return yield* new InvalidMaterialFile({ fileName: input.fileName, reason: "El título está vacío" });
      }
      if (input.bytes.length === 0) {
        return yield* new InvalidMaterialFile({ fileName: input.fileName, reason: "El fichero está vacío" });
      }
      const header = new TextDecoder("latin1").decode(input.bytes.subarray(0, pdfHeader.length));
      if (header !== pdfHeader) {
        return yield* new InvalidMaterialFile({ fileName: input.fileName, reason: "No es un PDF" });
      }

      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(mapError));

      const id = materialIdFor(title);
      const target = pdfPath(id);
      const staging = `${target}.part`;
      yield* fs.writeFile(staging, input.bytes).pipe(Effect.mapError(mapError));

      // Poppler must be able to read it, as it will when rendering pages. Any
      // failure (error or defect) means the file is unusable: discard it.
      const counted = yield* Effect.exit(pdf.pageCount(staging));
      if (counted._tag === "Failure") {
        yield* fs.remove(staging).pipe(Effect.ignore);
        const reason = Cause.squash(counted.cause);
        return yield* new InvalidMaterialFile({
          fileName: input.fileName,
          reason: `Poppler no puede leerlo: ${reason instanceof Error ? reason.message : String(reason)}`
        });
      }
      const pageCount = counted.value;
      if (pageCount < 1) {
        yield* fs.remove(staging).pipe(Effect.ignore);
        return yield* new InvalidMaterialFile({ fileName: input.fileName, reason: "El PDF no tiene páginas" });
      }

      yield* fs.rename(staging, target).pipe(Effect.mapError(mapError));
      const uploadedAt = new Date().toISOString();
      const folder = input.folderId === undefined ? {} : { folderId: input.folderId };
      yield* fs.writeFileString(metaPath(id), `${JSON.stringify({ title, uploadedAt, ...folder }, null, 2)}\n`).pipe(Effect.mapError(mapError));

      return { id, title, fileName: `${id}.pdf`, pageCount, uploadedAt, ...folder };
    });

    const remove = (id: string): Effect.Effect<void, MaterialNotFound | MaterialRepositoryError> => Effect.gen(function* () {
      const file = yield* getFile(id);
      yield* fs.remove(file.path).pipe(Effect.mapError(mapError));
      yield* fs.remove(metaPath(id)).pipe(Effect.ignore);
    });

    return { list, get, renderPages, save, remove };
  }),
  layer: (directory: string) => Layer.effect(MaterialRepository)(FileMaterialRepository.make(directory))
};
