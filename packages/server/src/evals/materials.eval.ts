import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, FileSystem, Layer, Path } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";

/**
 * Deterministic eval (no API calls, needs Poppler): uploading and deleting
 * materials through the file repository, on a temporary directory.
 *
 *   pnpm --filter @proxus/server run eval:materials
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

const materialsCase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "proxus-materials-eval-" });
  const materials = yield* FileMaterialRepository.make(directory);
  const results: CriterionResult[] = [];

  const fixture = yield* fs.readFile(path.join("fixtures", "materials", "ciclo-del-agua.pdf"));

  // Valid PDF with an accented, spaced title.
  const saved = yield* materials.save({ title: "Ciclo del Agua – Tema 1", fileName: "Ciclo del Agua.pdf", bytes: fixture });
  const listed = yield* materials.list();
  results.push(
    criterion("save-derives-safe-id", /^ciclo-del-agua-tema-1-[0-9a-f]{6}$/.test(saved.id), `id: ${saved.id}`),
    criterion("save-keeps-title-and-pages", saved.title === "Ciclo del Agua – Tema 1" && saved.pageCount === 3, `title: ${saved.title}, pages: ${saved.pageCount}`),
    criterion("list-shows-saved-material", listed.length === 1 && listed[0]?.title === saved.title && listed[0]?.pageCount === 3, `listed: ${listed.map((material) => material.id).join(",")}`)
  );

  // Not a PDF.
  const notPdf = yield* materials.save({ title: "Apuntes", fileName: "apuntes.pdf", bytes: new TextEncoder().encode("hola, esto es texto") }).pipe(Effect.exit);
  const notPdfReason = notPdf._tag === "Failure" ? String(notPdf.cause) : "";
  results.push(criterion("rejects-non-pdf", notPdf._tag === "Failure" && notPdfReason.includes("InvalidMaterialFile"), notPdfReason.slice(0, 120)));

  // Looks like a PDF but Poppler cannot read it.
  const broken = yield* materials.save({ title: "Roto", fileName: "roto.pdf", bytes: new TextEncoder().encode("%PDF-1.4\ngarbage") }).pipe(Effect.exit);
  const stillOne = yield* materials.list();
  const leftovers = (yield* fs.readDirectory(directory)).filter((entry) => entry.endsWith(".part"));
  results.push(
    criterion("rejects-unreadable-pdf", broken._tag === "Failure" && String(broken.cause).includes("InvalidMaterialFile"), broken._tag === "Failure" ? String(broken.cause).slice(0, 300) : "Success"),
    criterion("rejected-files-leave-no-trace", stillOne.length === 1 && leftovers.length === 0, `materials: ${stillOne.length}, leftovers: ${leftovers.length}`)
  );

  // Hand-copied file without sidecar keeps working with its file name as id.
  yield* fs.writeFile(path.join(directory, "manual.pdf"), fixture);
  const withManual = yield* materials.list();
  results.push(criterion("hand-copied-file-listed", withManual.some((material) => material.id === "manual" && material.title === "manual"), withManual.map((material) => material.id).join(",")));

  // Remove.
  yield* materials.remove(saved.id);
  const afterRemove = yield* materials.list();
  const filesLeft = yield* fs.readDirectory(directory);
  const removeMissing = yield* materials.remove(saved.id).pipe(Effect.exit);
  results.push(
    criterion("remove-deletes-pdf-and-meta", !afterRemove.some((material) => material.id === saved.id) && !filesLeft.some((entry) => entry.startsWith(saved.id)), `files: ${filesLeft.join(",")}`),
    criterion("remove-unknown-is-not-found", removeMissing._tag === "Failure" && String(removeMissing.cause).includes("MaterialNotFound"), removeMissing._tag)
  );

  return results;
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.mergeAll(PopplerPdfService.layer.pipe(Layer.provide(NodeServices.layer)), NodeServices.layer))
);

class MaterialsEvalFailed extends Data.TaggedError("MaterialsEvalFailed")<{}> {}

export const materialsEval = Effect.gen(function* () {
  const results = yield* materialsCase;
  const lines = ["materials.upload-and-delete"];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new MaterialsEvalFailed();
  }
  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(materialsEval);
}
