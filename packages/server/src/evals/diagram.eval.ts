import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Layer, Ref } from "effect";
import { LanguageModel, Response } from "effect/unstable/ai";
import type { CreateDiagramArtifactInput } from "@proxus/shared";
import { AgentHarness, AgentSession } from "../domain/agents/harness/index.ts";
import { progressLabelFor } from "../domain/agents/harness/event.ts";
import { academicTutorSystemPrompt } from "../domain/agents/academic-tutor.ts";
import { makeArtifactCommands } from "../domain/agents/academic-tutor/artifact-commands.ts";
import { makeMaterialCommands } from "../domain/agents/academic-tutor/material-commands.ts";
import { makeAcademicTutorSkills } from "../domain/agents/academic-tutor/skills/index.ts";
import { describeUiContext } from "../domain/agents/academic-tutor/ui-context.ts";
import { normalizeDiagramInput, validateDiagram, type DiagramIssueCode, type DiagramValidationContext } from "../domain/artifacts/diagram.ts";
import {
  ArtifactNotFound,
  makeArtifact,
  type Artifact,
  type ArtifactRepository as ArtifactRepositoryType
} from "../domain/artifacts/artifact.ts";
import { MaterialNotFound, MaterialRepository, type MaterialPageImages, type PdfMaterial } from "../domain/materials/material.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { makeAcademicTutorHarness } from "../domain/agents/academic-tutor.ts";
import { citedPages, renderedPages, ungroundedCitations } from "../domain/agents/harness/grounding.ts";
import { GeminiModel } from "../infra/agents/gemini-language-model.ts";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";

/**
 * Deterministic eval (no API calls) of the diagram artifact.
 *
 * Part 1: domain validation and normalization over fixed JSON.
 * Part 2: the repair loop, driven by a scripted model: render pages, send an
 *         invalid diagram, receive the problems, send a valid one.
 * Part 3: skill text, progress labels and UI context for diagrams.
 * Part 4 (`DIAGRAM_LIVE=1`, needs GOOGLE_GENERATIVE_AI_API_KEY and Poppler): six
 *         prompts against the real model with the fixture PDF, measuring whether
 *         the tutor draws when it should, does not when it should not, and anchors
 *         every node to rendered pages that cover the expected concepts.
 *
 *   pnpm --filter @proxus/server run eval:tutor:diagram
 *   DIAGRAM_LIVE=1 pnpm --filter @proxus/server run eval:tutor:diagram
 *   DIAGRAM_CASES=D1,D3 DIAGRAM_LIVE=1 pnpm --filter @proxus/server run eval:tutor:diagram
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

// --- Fixtures ----------------------------------------------------------------

const materialId = "ciclo-del-agua";

const fixtureMaterial: PdfMaterial = {
  id: materialId,
  title: "El ciclo del agua",
  fileName: "ciclo-del-agua.pdf",
  pageCount: 3,
  uploadedAt: "2026-01-01T00:00:00.000Z"
};

const node = (id: string, label: string, pages: readonly number[], description = `${label}: fase del ciclo del agua descrita en el material.`) =>
  ({ id, label, description, pages });

/** The water cycle as a process: four steps in a loop plus two side concepts. */
const validProcess: CreateDiagramArtifactInput = {
  kind: "diagram",
  title: "El ciclo del agua: fases",
  diagramType: "process",
  summary: "Las cuatro fases del ciclo del agua se encadenan en un bucle: evaporación, condensación, precipitación y recolección.",
  source: { materialId, pages: [1, 2] },
  nodes: [
    node("evaporacion", "Evaporación", [1], "El calor del sol convierte el agua líquida de océanos, ríos y lagos en vapor que sube a la atmósfera."),
    node("condensacion", "Condensación", [1], "El vapor se enfría en altura y forma nubes compuestas por gotas diminutas."),
    node("precipitacion", "Precipitación", [2], "Cuando las gotas crecen, caen como lluvia, nieve o granizo según la temperatura."),
    node("recoleccion", "Recolección", [2], "El agua vuelve a océanos y lagos (escorrentía) o se filtra al subsuelo formando acuíferos (infiltración)."),
    node("transpiracion", "Transpiración", [2], "Las plantas liberan vapor de agua que se suma al vapor procedente de la evaporación."),
    node("sublimacion", "Sublimación", [2], "Paso directo del hielo a vapor sin fundirse; también aporta vapor a la atmósfera.")
  ],
  mainPath: ["evaporacion", "condensacion", "precipitacion", "recoleccion"],
  cyclic: true,
  edges: [
    { from: "transpiracion", to: "condensacion", label: "aporta vapor" },
    { from: "sublimacion", to: "condensacion", label: "aporta vapor" }
  ]
};

const validConceptMap: CreateDiagramArtifactInput = {
  kind: "diagram",
  title: "Recolección del agua",
  diagramType: "concept-map",
  summary: "La recolección devuelve el agua a la superficie o al subsuelo; cada vía tiene su concepto asociado.",
  source: { materialId, pages: [2, 3] },
  rootId: "recoleccion",
  nodes: [
    node("recoleccion", "Recolección", [2], "Fase en la que el agua vuelve a océanos y lagos o se filtra al subsuelo."),
    node("escorrentia", "Escorrentía", [2, 3], "Agua que fluye por la superficie hacia ríos y mares."),
    node("infiltracion", "Infiltración", [2], "Agua que se filtra al subsuelo a través del terreno."),
    node("acuifero", "Acuífero", [2, 3], "Capa subterránea de roca permeable que almacena el agua infiltrada.")
  ],
  edges: [
    { from: "recoleccion", to: "escorrentia", label: "una vía es" },
    { from: "recoleccion", to: "infiltracion", label: "otra vía es" },
    { from: "infiltracion", to: "acuifero", label: "forma" }
  ]
};

const rendered12 = new Set([1, 2]);
const context: DiagramValidationContext = { pageCount: 3, renderedPages: rendered12 };

const codes = (input: CreateDiagramArtifactInput, ctx: DiagramValidationContext = context): readonly DiagramIssueCode[] =>
  validateDiagram(input, ctx).map((issue) => issue.code);

const has = (list: readonly DiagramIssueCode[], code: DiagramIssueCode) => list.includes(code);

// --- Part 1: validation ------------------------------------------------------

const validationCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  results.push(criterion("valid-process-accepted", codes(validProcess).length === 0, `issues: ${codes(validProcess).join(",")}`));
  results.push(criterion("valid-concept-map-accepted", codes(validConceptMap, { pageCount: 3, renderedPages: new Set([2, 3]) }).length === 0, `issues: ${codes(validConceptMap, { pageCount: 3, renderedPages: new Set([2, 3]) }).join(",")}`));

  const duplicate = codes({ ...validProcess, nodes: [...validProcess.nodes, node("condensacion", "Otra", [1], "Descripción repetida para forzar el duplicado de id.")] });
  results.push(criterion("duplicate-id", has(duplicate, "duplicate-node-id"), duplicate.join(",")));

  const unknownEdge = codes({ ...validProcess, edges: [{ from: "nube", to: "condensacion", label: "forma" }] });
  results.push(criterion("edge-unknown-node", has(unknownEdge, "edge-unknown-node"), unknownEdge.join(",")));

  const noPages = codes({ ...validProcess, nodes: validProcess.nodes.map((n) => n.id === "sublimacion" ? { ...n, pages: [] } : n) });
  results.push(criterion("node-no-pages", has(noPages, "node-no-pages"), noPages.join(",")));

  const outsideSource = codes({ ...validProcess, nodes: validProcess.nodes.map((n) => n.id === "sublimacion" ? { ...n, pages: [3] } : n) });
  results.push(criterion("page-outside-source", has(outsideSource, "node-page-outside-source"), outsideSource.join(",")));

  const outOfRange = codes({ ...validProcess, source: { materialId, pages: [1, 2, 7] } }, { pageCount: 3, renderedPages: new Set([1, 2, 7]) });
  results.push(criterion("page-out-of-range", has(outOfRange, "page-out-of-range"), outOfRange.join(",")));

  const notRendered = codes({ ...validProcess, source: { materialId, pages: [1, 2, 3] } });
  results.push(criterion("page-not-rendered", has(notRendered, "page-not-rendered") && !has(notRendered, "page-out-of-range"), notRendered.join(",")));

  const noRenderInfo = codes({ ...validProcess, source: { materialId, pages: [1, 2, 3] } }, { pageCount: 3 });
  results.push(criterion("range-only-without-rendered-pages", noRenderInfo.length === 0, noRenderInfo.join(",")));

  const disconnected = codes({ ...validProcess, edges: [validProcess.edges[0]!] });
  results.push(criterion("disconnected-node", has(disconnected, "node-disconnected"), disconnected.join(",")));

  const shortPath = codes({ ...validProcess, mainPath: ["evaporacion", "condensacion"] });
  results.push(criterion("main-path-too-short", has(shortPath, "process-main-path"), shortPath.join(",")));

  const unlabelled = codes({ ...validConceptMap, edges: validConceptMap.edges.map((edge, index) => index === 0 ? { from: edge.from, to: edge.to } : edge) }, { pageCount: 3, renderedPages: new Set([2, 3]) });
  results.push(criterion("concept-edge-needs-label", has(unlabelled, "concept-map-edge-label"), unlabelled.join(",")));

  const noRoot = codes({ ...validConceptMap, rootId: "agua" }, { pageCount: 3, renderedPages: new Set([2, 3]) });
  results.push(criterion("root-missing", has(noRoot, "concept-map-root"), noRoot.join(",")));

  const star: CreateDiagramArtifactInput = {
    ...validConceptMap,
    title: "Definiciones de la página 3",
    rootId: "definiciones",
    nodes: [
      node("definiciones", "Definiciones", [3], "Resumen de definiciones de la página tres del material."),
      node("acuifero", "Acuífero", [3], "Capa subterránea de roca permeable que almacena agua."),
      node("escorrentia", "Escorrentía", [3], "Agua que fluye por la superficie hacia ríos y mares."),
      node("humedad", "Humedad relativa", [3], "Porcentaje de vapor respecto al máximo posible."),
      node("perrault", "Perrault (1674)", [3], "Autor citado entre las fechas de la teoría moderna del ciclo.")
    ],
    edges: [
      { from: "definiciones", to: "acuifero", label: "incluye" },
      { from: "definiciones", to: "escorrentia", label: "incluye" },
      { from: "definiciones", to: "humedad", label: "incluye" },
      { from: "definiciones", to: "perrault", label: "incluye" }
    ],
    source: { materialId, pages: [3] }
  };
  const starCodes = codes(star, { pageCount: 3, renderedPages: new Set([3]) });
  results.push(criterion("degenerate-star", has(starCodes, "degenerate-list"), starCodes.join(",")));

  const looseProcess = codes({
    ...validProcess,
    nodes: [...validProcess.nodes, node("humedad", "Humedad relativa", [2]), node("acuifero", "Acuífero", [2]), node("escorrentia", "Escorrentía", [2]), node("infiltracion", "Infiltración", [2])],
    edges: [
      ...validProcess.edges,
      { from: "humedad", to: "condensacion", label: "influye en" },
      { from: "acuifero", to: "recoleccion", label: "resulta de" },
      { from: "escorrentia", to: "recoleccion", label: "es una vía de" },
      { from: "infiltracion", to: "recoleccion", label: "es una vía de" }
    ]
  });
  results.push(criterion("degenerate-process", has(looseProcess, "degenerate-list"), looseProcess.join(",")));

  const allAtOnce = codes({ ...validProcess, edges: [{ from: "nube", to: "condensacion", label: "forma" }], nodes: validProcess.nodes.map((n) => n.id === "sublimacion" ? { ...n, pages: [] } : n), source: { materialId, pages: [1, 2, 3] } });
  results.push(criterion("all-issues-reported-at-once", has(allAtOnce, "edge-unknown-node") && has(allAtOnce, "node-no-pages") && has(allAtOnce, "page-not-rendered"), allAtOnce.join(",")));

  const normalized = normalizeDiagramInput({
    kind: "diagram",
    nodes: [{ id: "Condensación", label: " Condensación ", description: "x", pages: 2 }],
    mainPath: ["Evaporación", "Condensación"],
    cyclic: true,
    edges: [
      { from: "Evaporación", to: "Condensación", label: "sigue" },
      { from: "Transpiración", to: "Condensación", label: "aporta vapor" },
      { from: "Transpiración", to: "Condensación", label: "aporta vapor" }
    ]
  }) as { nodes: Array<{ id: string; label: string; pages: unknown }>; edges: unknown[]; mainPath: string[] };
  results.push(criterion("normalize-single-page", JSON.stringify(normalized.nodes[0]?.pages) === "[2]" && normalized.nodes[0]?.id === "condensacion" && normalized.nodes[0]?.label === "Condensación", JSON.stringify(normalized.nodes[0])));
  results.push(criterion("normalize-duplicate-edge", normalized.edges.length === 1 && normalized.mainPath[0] === "evaporacion", `edges: ${normalized.edges.length}, mainPath: ${normalized.mainPath.join(",")}`));

  return results;
});

// --- Part 2: repair loop with a scripted model --------------------------------

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const ScriptedMaterialRepository = Layer.succeed(MaterialRepository, {
  list: () => Effect.succeed([fixtureMaterial]),
  get: (id) => id === materialId ? Effect.succeed(fixtureMaterial) : Effect.fail(new MaterialNotFound({ materialId: id })),
  renderPages: (id, pages) => id === materialId
    ? Effect.succeed<MaterialPageImages>({
        type: "material-page-images",
        material: fixtureMaterial,
        pages: pages.map((page) => ({ page, mediaType: "image/png", data: `data:image/png;base64,${onePixelPng}` }))
      })
    : Effect.fail(new MaterialNotFound({ materialId: id })),
  save: () => Effect.die("not used"),
  remove: () => Effect.die("not used")
});

class ArtifactStore extends Data.Class<{ readonly ref: Ref.Ref<readonly Artifact[]> }> {}

const makeInMemoryArtifacts = Effect.gen(function* () {
  const ref = yield* Ref.make<readonly Artifact[]>([]);
  const repository: ArtifactRepositoryType = {
    createArtifact: (input) => Effect.gen(function* () {
      const artifact = makeArtifact(input);
      yield* Ref.update(ref, (all) => [...all, artifact]);
      return artifact;
    }),
    saveArtifact: (artifact) => Ref.update(ref, (all) => [...all.filter((item) => item.id !== artifact.id), artifact]),
    getArtifact: (id) => Ref.get(ref).pipe(Effect.flatMap((all) => {
      const found = all.find((item) => item.id === id);
      return found === undefined ? Effect.fail(new ArtifactNotFound({ artifactId: id })) : Effect.succeed(found);
    })),
    listArtifacts: (input) => Ref.get(ref).pipe(Effect.map((all) => all.filter((item) => input?.kind === undefined || item.kind === input.kind))),
    submitAttempt: () => Effect.die("not used"),
    saveAttempt: () => Effect.die("not used"),
    getAttempt: () => Effect.die("not used"),
    listAttempts: () => Effect.succeed([]),
    gradeAttempt: () => Effect.die("not used")
  };
  return { repository, store: new ArtifactStore({ ref }) };
});

type Step = ReadonlyArray<Response.PartEncoded>;

const text = (content: string): Step => [Response.makePart("text", { text: content })];
const call = (id: string, input: string): Step => [
  Response.makePart("tool-call", { id, name: "cli", params: { input }, providerExecuted: false })
];
const create = (id: string, input: CreateDiagramArtifactInput): Step => call(id, `artifacts create '${JSON.stringify(input)}'`);

const scriptedModel = (steps: readonly Step[], calls: Ref.Ref<number>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: () => Effect.gen(function* () {
        const index = yield* Ref.getAndUpdate(calls, (n) => n + 1);
        return [...(steps[index] ?? steps[steps.length - 1] ?? [])];
      }),
      streamText: () => { throw new Error("not used"); }
    })
  );

const runScripted = (input: string, steps: readonly Step[]) => Effect.gen(function* () {
  const materials = yield* MaterialRepository;
  const { repository, store } = yield* makeInMemoryArtifacts;
  const harness = AgentHarness.make({
    name: academicTutorSystemPrompt,
    skills: makeAcademicTutorSkills({ autoDiagram: true }),
    commands: [makeMaterialCommands(materials), makeArtifactCommands(repository, materials)]
  });
  const calls = yield* Ref.make(0);
  const result = yield* AgentSession.make(harness).run({ input, maxSteps: 8 }).pipe(
    Effect.provide(Layer.mergeAll(harness.layer, scriptedModel(steps, calls)))
  );
  const artifacts = yield* Ref.get(store.ref);
  return { result, artifacts, modelCalls: yield* Ref.get(calls) };
});

const toolResults = (messages: ReadonlyArray<{ role: string; result?: unknown }>) =>
  messages.filter((message) => message.role === "tool-result").map((message) => typeof message.result === "string" ? message.result : JSON.stringify(message.result));

const repairCases = Effect.gen(function* () {
  const results: CriterionResult[] = [];

  // A. view -> invalid create (unknown edge target) -> valid create -> answer.
  const invalid: CreateDiagramArtifactInput = { ...validProcess, edges: [{ from: "nube", to: "condensacion", label: "forma" }, validProcess.edges[1]!] };
  const a = yield* runScripted("Explícame las fases del ciclo del agua, páginas 1-2.", [
    call("c1", `materials view ${materialId} 1-2`),
    create("c2", invalid),
    create("c3", validProcess),
    text("He dibujado el ciclo con sus cuatro fases (páginas 1-2). Ábrelo desde el panel.")
  ]);
  const aResults = toolResults(a.result.messages);
  const rejection = aResults.find((item) => item.startsWith("DIAGRAM_INVALID"));
  const createCalls = a.result.messages.filter((message) => message.role === "tool-call" && JSON.stringify(message.input).includes("artifacts create")).length;
  results.push(
    criterion("first-create-rejected-with-code", rejection !== undefined && rejection.includes("[edge-unknown-node]") && rejection.includes("\"nube\""), rejection?.split("\n")[1] ?? "no rejection"),
    criterion("rejection-lists-valid-ids", rejection !== undefined && rejection.includes("evaporacion, condensacion"), "valid ids listed"),
    criterion("second-create-persisted", a.artifacts.length === 1 && a.artifacts[0]?.kind === "diagram" && a.artifacts[0].nodes.length === 6, `artifacts: ${a.artifacts.length}`),
    criterion("persisted-source-matches-rendered", a.artifacts[0]?.source?.materialId === materialId && JSON.stringify(a.artifacts[0]?.source?.pages) === "[1,2]", JSON.stringify(a.artifacts[0]?.source)),
    criterion("two-create-calls-only", createCalls === 2 && a.modelCalls === 4, `create calls: ${createCalls}, model calls: ${a.modelCalls}`),
    criterion("created-confirmation-has-node-count", aResults.some((item) => item.includes("\"nodeCount\": 6") && item.includes("\"edgeCount\": 2") && item.includes("\"diagramType\": \"process\"")), "confirmation carries nodeCount, edgeCount, diagramType"),
    criterion("no-draft-json-in-assistant-text", !a.result.output.includes("\"nodes\""), a.result.output.slice(0, 80))
  );

  // B. create without rendering the pages first -> rejected, nothing persisted.
  const b = yield* runScripted("Hazme un esquema del ciclo del agua.", [
    create("d1", validProcess),
    text("No he podido crear el esquema.")
  ]);
  const bRejection = toolResults(b.result.messages).find((item) => item.startsWith("DIAGRAM_INVALID"));
  results.push(
    criterion("create-without-view-rejected", bRejection !== undefined && bRejection.includes("[page-not-rendered]") && bRejection.includes(`materials view ${materialId} 1,2`) && b.artifacts.length === 0, bRejection?.split("\n")[1] ?? "no rejection")
  );

  // C. unknown material id -> rejected with a pointer to `materials list`.
  const c = yield* runScripted("Hazme un esquema.", [
    create("e1", { ...validProcess, source: { materialId: "algebra", pages: [1, 2] } }),
    text("Listo.")
  ]);
  const cRejection = toolResults(c.result.messages).find((item) => item.startsWith("DIAGRAM_INVALID"));
  results.push(criterion("unknown-material-rejected", cRejection !== undefined && cRejection.includes("does not exist") && c.artifacts.length === 0, cRejection?.split("\n")[1] ?? "no rejection"));

  // D. an apostrophe inside the single-quoted JSON breaks tokenization; the model gets the error back.
  const d = yield* runScripted("Hazme un esquema.", [
    call("f1", `materials view ${materialId} 1-2`),
    call("f2", `artifacts create '${JSON.stringify({ ...validProcess, title: "L'eau" })}'`),
    text("Lo corrijo.")
  ]);
  const dFailure = d.result.messages.find((message) => message.role === "tool-result" && message.isFailure);
  const dFailureText = dFailure?.role === "tool-result" ? String(dFailure.result).slice(0, 80) : "no failure";
  results.push(criterion("apostrophe-in-label-returns-tokenization-hint", dFailure !== undefined && d.artifacts.length === 0, dFailureText));

  return results;
}).pipe(Effect.provide(ScriptedMaterialRepository));

// --- Part 3: skill, labels and UI context ------------------------------------

const plumbingCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  const auto = makeAcademicTutorSkills({ autoDiagram: true }).find((skill) => skill.name === "teach-visually");
  const manual = makeAcademicTutorSkills({ autoDiagram: false }).find((skill) => skill.name === "teach-visually");
  results.push(
    criterion("skill-lists-when-not-to-draw", auto !== undefined && auto.content.includes("## When it does not") && auto.content.includes("Lists of dates") && auto.content.includes("DIAGRAM_INVALID"), "skill has the rubric and the repair rule"),
    criterion("skill-respects-auto-flag", auto !== undefined && manual !== undefined && auto.content.includes("On your own initiative") && !manual.content.includes("On your own initiative"), "auto flag toggles the initiative section"),
    criterion("skill-examples-have-no-single-quotes", auto !== undefined && !/'\{[^\n]*'[^\n]*'/.test(auto.content.split("Examples")[1]?.split("## If")[0] ?? "'x'x'"), "examples fit inside single quotes")
  );

  results.push(criterion("progress-label-diagram", progressLabelFor("cli", { input: `artifacts create '{"kind":"diagram","title":"x"}'` }) === "Dibujando un esquema", progressLabelFor("cli", { input: `artifacts create '{"kind":"diagram"}'` })));

  const diagram = makeArtifact(validProcess);
  const note = diagram.kind === "diagram" ? describeUiContext(diagram, { openNodeId: "condensacion" }) : "";
  results.push(criterion("ui-context-describes-node", note.includes("process diagram with 6 node(s)") && note.includes("Focused node condensacion") && note.includes("forma nubes") && note.includes("(pages 1)"), note.split("\n")[3] ?? ""));

  return results;
});

// --- Part 4: live model with the fixture PDF ---------------------------------

interface LiveCase {
  readonly id: string;
  readonly input: string;
  readonly materialsDir: string;
  /** Expected diagram type, or `null` when no diagram must be created. */
  readonly expectDiagram: "process" | "concept-map" | null;
  /** Concepts that must appear among the node labels (accent-insensitive). */
  readonly concepts: readonly string[];
  /** Pages every node may cite. */
  readonly pages: readonly number[];
  readonly cyclic?: boolean;
  /** Text the answer must contain when no diagram is drawn. */
  readonly answerMentions?: RegExp;
}

const liveCases: readonly LiveCase[] = [
  { id: "D1.asked-process", input: "Hazme un esquema de las fases del ciclo del agua, páginas 1-2.", materialsDir: "fixtures/materials", expectDiagram: "process", concepts: ["evaporacion", "condensacion", "precipitacion", "recoleccion"], pages: [1, 2], cyclic: true },
  { id: "D2.own-initiative", input: "Explícame las fases del ciclo del agua, páginas 1-2.", materialsDir: "fixtures/materials", expectDiagram: "process", concepts: ["evaporacion", "condensacion", "precipitacion", "recoleccion"], pages: [1, 2], cyclic: true },
  { id: "D2b.single-definition", input: "¿Qué dice la página 3 de mi material sobre los acuíferos?", materialsDir: "fixtures/materials", expectDiagram: null, concepts: [], pages: [3] },
  { id: "D3.dates-are-not-a-diagram", input: "Hazme un diagrama con las fechas de la página 3.", materialsDir: "fixtures/materials", expectDiagram: null, concepts: [], pages: [3], answerMentions: /nota|quiz|lista/i },
  { id: "D4.asked-concept-map", input: "Hazme un mapa de cómo se relacionan recolección, escorrentía, infiltración y acuífero (páginas 2-3).", materialsDir: "fixtures/materials", expectDiagram: "concept-map", concepts: ["escorrentia", "infiltracion", "acuifero"], pages: [2, 3] },
  { id: "D5.no-such-material", input: "Hazme un esquema de mis apuntes de álgebra.", materialsDir: "fixtures/materials-empty", expectDiagram: null, concepts: [], pages: [] }
];

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();

const runLive = (testCase: LiveCase) => Effect.gen(function* () {
  const materials = yield* MaterialRepository;
  const { repository, store } = yield* makeInMemoryArtifacts;
  const harness = makeAcademicTutorHarness(materials, repository, { autoDiagram: true });
  const result = yield* AgentSession.make(harness).run({ input: testCase.input, maxSteps: 8 }).pipe(Effect.provide(harness.layer));
  const artifacts = yield* Ref.get(store.ref);
  const diagram = artifacts.find((artifact) => artifact.kind === "diagram");
  const rendered = renderedPages(result.messages);
  const renderedAll = new Set([...rendered.values()].flatMap((pages) => [...pages]));
  const createCalls = result.messages.filter((message) => message.role === "tool-call" && /"kind"\s*:\s*"diagram"/.test(JSON.stringify(message.input))).length;
  const ungrounded = ungroundedCitations(result.output, rendered);
  const modelError = result.output.includes("I hit an internal model/tool-routing error") || result.output.startsWith("El tutor no ha podido") || result.output.startsWith("Se ha agotado") || result.output.startsWith("El proveedor");

  const checks: string[] = [];
  let passed = !modelError && ungrounded.length === 0;
  if (modelError) checks.push("MODEL ERROR");
  if (ungrounded.length > 0) checks.push(`ungrounded citations ${ungrounded.join(",")}`);

  if (testCase.expectDiagram === null) {
    if (diagram !== undefined) { passed = false; checks.push("a diagram was created"); }
    if (testCase.answerMentions !== undefined && !testCase.answerMentions.test(result.output)) { passed = false; checks.push("answer does not offer an alternative"); }
    if (testCase.materialsDir.endsWith("empty") && renderedAll.size > 0) { passed = false; checks.push("rendered pages without material"); }
  } else if (diagram === undefined || diagram.kind !== "diagram") {
    passed = false;
    checks.push("no diagram created");
  } else {
    const labels = diagram.nodes.map((node) => plain(node.label));
    const missing = testCase.concepts.filter((concept) => !labels.some((label) => label.includes(concept)));
    const outside = diagram.nodes.flatMap((node) => node.pages).filter((page) => !testCase.pages.includes(page));
    const unread = (diagram.source?.pages ?? []).filter((page) => !renderedAll.has(page));
    if (diagram.diagramType !== testCase.expectDiagram) { passed = false; checks.push(`type ${diagram.diagramType}`); }
    if (missing.length > 0) { passed = false; checks.push(`missing concepts ${missing.join(",")}`); }
    if (outside.length > 0) { passed = false; checks.push(`pages outside ${outside.join(",")}`); }
    if (unread.length > 0) { passed = false; checks.push(`source pages not rendered ${unread.join(",")}`); }
    if (testCase.cyclic === true && diagram.cyclic !== true) { passed = false; checks.push("not cyclic"); }
    if (createCalls > 2) { passed = false; checks.push(`${createCalls} create attempts`); }
    if (/"nodes"/.test(result.output)) { passed = false; checks.push("JSON leaked into the answer"); }
    checks.push(`nodes ${diagram.nodes.length}, edges ${diagram.edges.length}, attempts ${createCalls}`);
  }

  return criterion(
    testCase.id,
    passed,
    `${checks.join("; ")} :: cited [${citedPages(result.output).join(",")}] rendered [${[...renderedAll].join(",")}] :: ${result.output.slice(0, 160).replaceAll("\n", " ")}`
  );
}).pipe(
  Effect.provide(Layer.mergeAll(
    GeminiModel,
    FileMaterialRepository.layer(testCase.materialsDir).pipe(
      Layer.provide(PopplerPdfService.layer),
      Layer.provide(NodeServices.layer)
    )
  ))
);

const selectedLiveCases = () => {
  const filter = process.env.DIAGRAM_CASES;
  if (filter === undefined || filter.trim().length === 0) return liveCases;
  const wanted = filter.split(",").map((id) => id.trim());
  return liveCases.filter((testCase) => wanted.some((id) => testCase.id.startsWith(id)));
};

const liveCasesEffect = Effect.gen(function* () {
  const results: CriterionResult[] = [];
  for (const testCase of selectedLiveCases()) {
    results.push(yield* runLive(testCase));
  }
  return results;
});

// --- Runner ------------------------------------------------------------------

class DiagramEvalFailed extends Data.TaggedError("DiagramEvalFailed")<{}> {}

export const diagramEval = Effect.gen(function* () {
  const live = process.env.DIAGRAM_LIVE === "1";
  const results = [
    ...(yield* validationCases),
    ...(yield* repairCases),
    ...(yield* plumbingCases),
    ...(live ? yield* liveCasesEffect : [])
  ];

  const lines = [`academic-tutor.diagram (validation, repair loop, plumbing${live ? ", live" : "; set DIAGRAM_LIVE=1 for live cases"})`];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new DiagramEvalFailed();
  }
  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(diagramEval);
}
