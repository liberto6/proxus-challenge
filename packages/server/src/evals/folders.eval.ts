import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, FileSystem, Layer, Path } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { generalFolderId } from "@proxus/shared";
import { FileFolderRepository } from "../infra/folders/file-folder-repository.ts";
import { FileSessionRepository } from "../infra/agents/file-session-repository.ts";
import { FileArtifactRepository } from "../infra/artifacts/file-artifact-repository.ts";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";
import { folderOf, isFolderEmpty } from "../domain/folders/folder.ts";

/**
 * Deterministic eval (no API) of folders: the folder repository, and the
 * `folderId` that materials, sessions and artifacts carry and filter by.
 * Needs Poppler for the material part (as `eval:materials`).
 *
 *   pnpm --filter @proxus/server run eval:folders
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

const repositoriesCase = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "proxus-folders-eval-" });
  const folders = yield* FileFolderRepository.make(path.join(root, "folders"));
  const sessions = yield* FileSessionRepository.make(path.join(root, "sessions"));
  const artifacts = yield* FileArtifactRepository.make(path.join(root, "artifacts"));
  const materials = yield* FileMaterialRepository.make(path.join(root, "pdfs"));
  const results: CriterionResult[] = [];

  // General exists before anything is stored, and stays first.
  const initial = yield* folders.list();
  results.push(criterion("general-exists-by-default", initial.length === 1 && initial[0]?.id === generalFolderId && initial[0].title === "General", initial.map((folder) => folder.id).join(",")));

  const biology = yield* folders.create("  Biología   1º ");
  const physics = yield* folders.create("Física");
  const listed = yield* folders.list();
  results.push(
    criterion("create-normalizes-title-and-slug-id", biology.title === "Biología 1º" && /^biologia-1-[0-9a-f]{6}$/.test(biology.id), `${biology.id}: ${biology.title}`),
    criterion("list-general-first-then-by-creation", listed.map((folder) => folder.id).join(",") === [generalFolderId, biology.id, physics.id].join(","), listed.map((folder) => folder.title).join(" > "))
  );

  const clash = yield* folders.create("biologia 1º").pipe(Effect.exit);
  const empty = yield* folders.create("   ").pipe(Effect.exit);
  results.push(
    criterion("create-rejects-title-taken-ignoring-accents", clash._tag === "Failure" && String(clash.cause).includes("FolderTitleTaken"), clash._tag),
    criterion("create-rejects-empty-title", empty._tag === "Failure" && String(empty.cause).includes("FolderTitleInvalid"), empty._tag)
  );

  const renamedGeneral = yield* folders.rename(generalFolderId, "Todo lo demás");
  const afterRename = yield* folders.list();
  results.push(criterion("general-can-be-renamed-and-is-persisted", renamedGeneral.id === generalFolderId && afterRename[0]?.title === "Todo lo demás", afterRename[0]?.title ?? ""));

  const removeGeneral = yield* folders.remove(generalFolderId).pipe(Effect.exit);
  results.push(criterion("general-cannot-be-removed", removeGeneral._tag === "Failure", removeGeneral._tag));

  // Membership on items.
  const fixture = yield* fs.readFile(path.join("fixtures", "materials", "ciclo-del-agua.pdf"));
  const inBiology = yield* materials.save({ title: "Ciclo del agua", fileName: "ciclo.pdf", bytes: fixture, folderId: biology.id });
  const inGeneral = yield* materials.save({ title: "Suelto", fileName: "suelto.pdf", bytes: fixture });
  const materialList = yield* materials.list();
  results.push(
    criterion("material-keeps-folder-in-meta", materialList.find((item) => item.id === inBiology.id)?.folderId === biology.id, `folderId: ${materialList.find((item) => item.id === inBiology.id)?.folderId}`),
    criterion("material-without-folder-is-general", folderOf(inGeneral) === generalFolderId && materialList.find((item) => item.id === inGeneral.id)?.folderId === undefined, "no folderId")
  );

  yield* sessions.makeSession({ id: "s-bio", folderId: biology.id });
  yield* sessions.makeSession({ id: "s-old" });
  const bioSessions = yield* sessions.listSessions({ folderId: biology.id });
  const generalSessions = yield* sessions.listSessions({ folderId: generalFolderId });
  const allSessions = yield* sessions.listSessions();
  results.push(
    criterion("sessions-filter-by-folder", bioSessions.length === 1 && bioSessions[0]?.id === "s-bio" && bioSessions[0].folderId === biology.id, bioSessions.map((session) => session.id).join(",")),
    criterion("sessions-without-folder-are-general", generalSessions.length === 1 && generalSessions[0]?.id === "s-old" && allSessions.length === 2, `${generalSessions.map((session) => session.id).join(",")} / all ${allSessions.length}`)
  );

  const note = { kind: "note" as const, title: "Nota", markdown: "# hola" };
  const inBioArtifact = yield* artifacts.createArtifact(note, { folderId: biology.id });
  const looseArtifact = yield* artifacts.createArtifact(note);
  const bioArtifacts = yield* artifacts.listArtifacts({ folderId: biology.id });
  const generalArtifacts = yield* artifacts.listArtifacts({ folderId: generalFolderId });
  results.push(
    criterion("artifact-created-with-folder", inBioArtifact.folderId === biology.id && bioArtifacts.length === 1 && bioArtifacts[0]?.id === inBioArtifact.id, bioArtifacts.map((artifact) => artifact.id).join(",")),
    criterion("artifact-without-folder-is-general", looseArtifact.folderId === undefined && generalArtifacts.length === 1 && generalArtifacts[0]?.id === looseArtifact.id, generalArtifacts.map((artifact) => artifact.id).join(","))
  );

  // What a folder holds, for the delete refusal.
  const contents = {
    materials: materialList.filter((item) => folderOf(item) === biology.id).length,
    sessions: bioSessions.length,
    artifacts: bioArtifacts.length
  };
  results.push(criterion("folder-contents-counted", !isFolderEmpty(contents) && contents.materials === 1 && contents.sessions === 1 && contents.artifacts === 1, JSON.stringify(contents)));
  const physicsContents = {
    materials: materialList.filter((item) => folderOf(item) === physics.id).length,
    sessions: (yield* sessions.listSessions({ folderId: physics.id })).length,
    artifacts: (yield* artifacts.listArtifacts({ folderId: physics.id })).length
  };
  yield* folders.remove(physics.id);
  const afterRemove = yield* folders.list();
  results.push(criterion("empty-folder-removed", isFolderEmpty(physicsContents) && !afterRemove.some((folder) => folder.id === physics.id), afterRemove.map((folder) => folder.id).join(",")));

  return results;
}).pipe(
  Effect.scoped,
  Effect.provide(Layer.mergeAll(PopplerPdfService.layer.pipe(Layer.provide(NodeServices.layer)), NodeServices.layer))
);

class FoldersEvalFailed extends Data.TaggedError("FoldersEvalFailed")<{}> {}

export const foldersEval = Effect.gen(function* () {
  const results = yield* repositoriesCase;
  const lines = ["folders (repositories; no API)"];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));
  if (passed !== results.length) {
    return yield* new FoldersEvalFailed();
  }
  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(foldersEval);
}
