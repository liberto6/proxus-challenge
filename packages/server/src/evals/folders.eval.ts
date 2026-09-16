import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, FileSystem, Layer, Path } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { generalFolderId } from "@proxus/shared";
import { FileFolderRepository } from "../infra/folders/file-folder-repository.ts";
import { FileSessionRepository } from "../infra/agents/file-session-repository.ts";
import { FileArtifactRepository } from "../infra/artifacts/file-artifact-repository.ts";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";
import { FolderScope, folderOf, generalFolder, isFolderEmpty } from "../domain/folders/folder.ts";
import { Layer as EffectLayer, Ref } from "effect";
import { LanguageModel, Response } from "effect/unstable/ai";
import { AgentHarness, AgentSession } from "../domain/agents/harness/index.ts";
import { renderedPages } from "../domain/agents/harness/grounding.ts";
import { academicTutorSystemPrompt } from "../domain/agents/academic-tutor.ts";
import { makeArtifactCommands } from "../domain/agents/academic-tutor/artifact-commands.ts";
import { makeMaterialCommands } from "../domain/agents/academic-tutor/material-commands.ts";
import { makeAcademicTutorSkills } from "../domain/agents/academic-tutor/skills/index.ts";
import { ArtifactNotFound, makeArtifact, type Artifact, type ArtifactRepository as ArtifactRepositoryType } from "../domain/artifacts/artifact.ts";
import { MaterialNotFound, MaterialRepository, type MaterialPageImages, type PdfMaterial } from "../domain/materials/material.ts";

/**
 * Deterministic eval (no API) of folders.
 *
 * Part 1: the folder repository, and the `folderId` that materials, sessions
 *         and artifacts carry and filter by (needs Poppler, as `eval:materials`).
 * Part 2: the tutor's scope, with a scripted model: inside a folder the tutor
 *         lists only its PDFs, cannot read another folder's PDF, and stamps the
 *         folder on what it creates; without a scope nothing is filtered.
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

  const biology = yield* folders.create({ title: "  Biología   1º ", subject: { university: "UCM", degree: "Biología", year: 1, name: "Biología celular" } });
  const physics = yield* folders.create({ title: "Física" });
  const listed = yield* folders.list();
  results.push(
    criterion("create-normalizes-title-and-slug-id", biology.title === "Biología 1º" && /^biologia-1-[0-9a-f]{6}$/.test(biology.id), `${biology.id}: ${biology.title}`),
    criterion("list-general-first-then-by-creation", listed.map((folder) => folder.id).join(",") === [generalFolderId, biology.id, physics.id].join(","), listed.map((folder) => folder.title).join(" > "))
  );

  const clash = yield* folders.create({ title: "biologia 1º" }).pipe(Effect.exit);
  const empty = yield* folders.create({ title: "   " }).pipe(Effect.exit);
  results.push(
    criterion("create-rejects-title-taken-ignoring-accents", clash._tag === "Failure" && String(clash.cause).includes("FolderTitleTaken"), clash._tag),
    criterion("create-rejects-empty-title", empty._tag === "Failure" && String(empty.cause).includes("FolderTitleInvalid"), empty._tag)
  );

  const renamedGeneral = yield* folders.update(generalFolderId, { title: "Todo lo demás" });
  const afterRename = yield* folders.list();
  results.push(criterion("general-can-be-renamed-and-is-persisted", renamedGeneral.id === generalFolderId && afterRename[0]?.title === "Todo lo demás", afterRename[0]?.title ?? ""));

  const removeGeneral = yield* folders.remove(generalFolderId).pipe(Effect.exit);
  results.push(criterion("general-cannot-be-removed", removeGeneral._tag === "Failure", removeGeneral._tag));

  // The subject travels with the folder: kept on rename, replaced when given, cleared with null.
  const storedBiology = yield* folders.get(biology.id);
  const keptSubject = yield* folders.update(biology.id, { title: "Biología 1.º" });
  const changedSubject = yield* folders.update(biology.id, { title: "Biología 1.º", subject: { university: "UCM", degree: "Biología", year: 2, name: "Fisiología I" } });
  const clearedSubject = yield* folders.update(biology.id, { title: "Biología 1.º", subject: null });
  results.push(
    criterion("subject-persisted-on-create", storedBiology.subject?.name === "Biología celular" && storedBiology.subject.university === "UCM", JSON.stringify(storedBiology.subject)),
    criterion("subject-kept-on-rename", keptSubject.subject?.name === "Biología celular" && keptSubject.title === "Biología 1.º", JSON.stringify(keptSubject.subject)),
    criterion("subject-replaced-on-update", changedSubject.subject?.name === "Fisiología I" && changedSubject.subject.year === 2, JSON.stringify(changedSubject.subject)),
    criterion("subject-cleared-with-null", clearedSubject.subject === undefined && (yield* folders.get(biology.id)).subject === undefined, "no subject")
  );

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

// --- Part 2: the tutor's scope --------------------------------------------------

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const biologyPdf: PdfMaterial = { id: "ciclo-del-agua", title: "El ciclo del agua", fileName: "ciclo-del-agua.pdf", pageCount: 3, uploadedAt: "2026-01-01T00:00:00.000Z", folderId: "biologia" };
const physicsPdf: PdfMaterial = { id: "leyes-de-newton", title: "Leyes de Newton", fileName: "leyes-de-newton.pdf", pageCount: 4, uploadedAt: "2026-01-01T00:00:00.000Z", folderId: "fisica" };
const loosePdf: PdfMaterial = { id: "apuntes-sueltos", title: "Apuntes sueltos", fileName: "apuntes-sueltos.pdf", pageCount: 2, uploadedAt: "2026-01-01T00:00:00.000Z" };
const allPdfs = [biologyPdf, physicsPdf, loosePdf];

const ScriptedMaterialRepository = EffectLayer.succeed(MaterialRepository, {
  list: () => Effect.succeed(allPdfs),
  get: (id) => {
    const found = allPdfs.find((material) => material.id === id);
    return found === undefined ? Effect.fail(new MaterialNotFound({ materialId: id })) : Effect.succeed(found);
  },
  renderPages: (id, pages) => {
    const found = allPdfs.find((material) => material.id === id);
    return found === undefined
      ? Effect.fail(new MaterialNotFound({ materialId: id }))
      : Effect.succeed<MaterialPageImages>({ type: "material-page-images", material: found, pages: pages.map((page) => ({ page, mediaType: "image/png", data: `data:image/png;base64,${onePixelPng}` })) });
  },
  save: () => Effect.die("not used"),
  remove: () => Effect.die("not used")
});

const makeInMemoryArtifacts = Effect.gen(function* () {
  const ref = yield* Ref.make<readonly Artifact[]>([]);
  const repository: ArtifactRepositoryType = {
    createArtifact: (input, options) => Effect.gen(function* () {
      const artifact = makeArtifact(input, options);
      yield* Ref.update(ref, (all) => [...all, artifact]);
      return artifact;
    }),
    saveArtifact: (artifact) => Ref.update(ref, (all) => [...all.filter((item) => item.id !== artifact.id), artifact]),
    getArtifact: (id) => Ref.get(ref).pipe(Effect.flatMap((all) => {
      const found = all.find((item) => item.id === id);
      return found === undefined ? Effect.fail(new ArtifactNotFound({ artifactId: id })) : Effect.succeed(found);
    })),
    listArtifacts: (input) => Ref.get(ref).pipe(Effect.map((all) => all.filter((item) =>
      (input?.kind === undefined || item.kind === input.kind) && (input?.folderId === undefined || folderOf(item) === input.folderId)
    ))),
    submitAttempt: () => Effect.die("not used"),
    saveAttempt: () => Effect.die("not used"),
    getAttempt: () => Effect.die("not used"),
    listAttempts: () => Effect.succeed([]),
    gradeAttempt: () => Effect.die("not used")
  };
  return { repository, ref };
});

type Step = ReadonlyArray<Response.PartEncoded>;
const text = (content: string): Step => [Response.makePart("text", { text: content })];
const call = (id: string, input: string): Step => [Response.makePart("tool-call", { id, name: "cli", params: { input }, providerExecuted: false })];

const scriptedModel = (steps: readonly Step[]) =>
  EffectLayer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      return yield* LanguageModel.make({
        generateText: () => Ref.getAndUpdate(calls, (n) => n + 1).pipe(Effect.map((index) => [...(steps[index] ?? steps[steps.length - 1] ?? [])])),
        streamText: () => { throw new Error("not used"); }
      });
    })
  );

/** Runs one scripted turn, optionally inside a folder, and returns the tool results and stored artifacts. */
const runScoped = (folderId: string | undefined, input: string, steps: readonly Step[]) => Effect.gen(function* () {
  const materials = yield* MaterialRepository;
  const { repository, ref } = yield* makeInMemoryArtifacts;
  yield* repository.createArtifact({ kind: "note", title: "Nota de física", markdown: "# F = m·a" }, { folderId: "fisica" });
  const harness = AgentHarness.make({
    name: academicTutorSystemPrompt,
    skills: makeAcademicTutorSkills({ autoDiagram: true }),
    commands: [makeMaterialCommands(materials), makeArtifactCommands(repository, materials)]
  });
  const run = AgentSession.make(harness).run({ input, maxSteps: 8 }).pipe(
    Effect.provide(EffectLayer.mergeAll(harness.layer, scriptedModel(steps)))
  );
  const result = yield* (folderId === undefined ? run : run.pipe(Effect.provideService(FolderScope, { folderId })));
  const toolResults = result.messages
    .filter((message) => message.role === "tool-result")
    .map((message) => message.role === "tool-result" ? (typeof message.result === "string" ? message.result : JSON.stringify(message.result)) : "");
  return { result, toolResults, artifacts: yield* Ref.get(ref) };
}).pipe(Effect.provide(ScriptedMaterialRepository));

const scopeCase = Effect.gen(function* () {
  const results: CriterionResult[] = [];

  const createNote = `artifacts create '{"kind":"note","title":"Resumen","markdown":"# Ciclo"}'`;
  const inBiology = yield* runScoped("biologia", "¿Qué materiales tengo?", [
    call("c1", "materials list"),
    call("c2", "materials view leyes-de-newton 1"),
    call("c3", "materials view ciclo-del-agua 1"),
    call("c4", "artifacts list"),
    call("c5", "artifacts show " + "nota-inexistente"),
    call("c6", createNote),
    text("Tienes un material en esta carpeta.")
  ]);
  const listed = inBiology.toolResults[0] ?? "";
  const foreignView = inBiology.toolResults[1] ?? "";
  const rendered = renderedPages(inBiology.result.messages);
  results.push(
    criterion("scope-filters-materials-list", listed.includes("ciclo-del-agua") && !listed.includes("leyes-de-newton") && !listed.includes("apuntes-sueltos"), listed.replaceAll("\n", " | ")),
    criterion("scope-rejects-view-outside-folder", foreignView.includes("not in this folder") && !rendered.has("leyes-de-newton"), foreignView.slice(0, 80)),
    criterion("scope-allows-view-inside-folder", rendered.get("ciclo-del-agua")?.has(1) === true, `rendered: ${[...rendered.keys()].join(",")}`),
    criterion("scope-filters-artifacts-list", (inBiology.toolResults[3] ?? "").includes("No artifacts found"), inBiology.toolResults[3] ?? ""),
    criterion("scope-stamps-artifact-folder", inBiology.artifacts.some((artifact) => artifact.title === "Resumen" && artifact.folderId === "biologia"), inBiology.artifacts.map((artifact) => `${artifact.title}:${artifact.folderId ?? "-"}`).join(", "))
  );

  const inGeneral = yield* runScoped(generalFolder.id, "¿Qué materiales tengo?", [call("g1", "materials list"), text("Uno.")]);
  const generalList = inGeneral.toolResults[0] ?? "";
  results.push(criterion("general-scope-sees-unfoldered-materials", generalList.includes("apuntes-sueltos") && !generalList.includes("ciclo-del-agua"), generalList.replaceAll("\n", " | ")));

  const unscoped = yield* runScoped(undefined, "¿Qué materiales tengo?", [call("u1", "materials list"), call("u2", "artifacts list"), text("Tres.")]);
  const unscopedList = unscoped.toolResults[0] ?? "";
  results.push(criterion("no-scope-sees-everything", unscopedList.includes("ciclo-del-agua") && unscopedList.includes("leyes-de-newton") && unscopedList.includes("apuntes-sueltos") && (unscoped.toolResults[1] ?? "").includes("Nota de física"), "CLI and older evals are unfiltered"));

  return results;
});

class FoldersEvalFailed extends Data.TaggedError("FoldersEvalFailed")<{}> {}

export const foldersEval = Effect.gen(function* () {
  const results = [...(yield* repositoriesCase), ...(yield* scopeCase)];
  const lines = ["folders (repositories, tutor scope; no API)"];
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
