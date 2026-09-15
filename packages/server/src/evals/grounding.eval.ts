import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Layer, Ref } from "effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LanguageModel, Response } from "effect/unstable/ai";
import { AgentHarness, AgentSession } from "../domain/agents/harness/index.ts";
import { citedPages, renderedPages, ungroundedCitations } from "../domain/agents/harness/grounding.ts";
import { academicTutorSystemPrompt } from "../domain/agents/academic-tutor.ts";
import { makeMaterialCommands } from "../domain/agents/academic-tutor/material-commands.ts";
import { AcademicTutorSkills } from "../domain/agents/academic-tutor/skills/index.ts";
import { MaterialNotFound, MaterialRepository, type MaterialPageImages, type PdfMaterial } from "../domain/materials/material.ts";
import { GeminiModel } from "../infra/agents/gemini-language-model.ts";
import { FileMaterialRepository } from "../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../infra/materials/poppler-pdf-service.ts";

/**
 * Grounding eval: the tutor only cites material pages it has rendered.
 *
 * Part 1 (always, no API): the guard in the harness, driven by scripted models.
 * Part 2 (`GROUNDING_LIVE=1`, needs GOOGLE_GENERATIVE_AI_API_KEY and Poppler):
 * 6 prompts against the real model with the fixture PDF in `fixtures/materials`.
 *
 *   pnpm --filter @proxus/server run eval:tutor:grounding
 *   GROUNDING_LIVE=1 pnpm --filter @proxus/server run eval:tutor:grounding
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

const disclaimerMarker = "> Aviso: esta respuesta cita las páginas";
const modelErrorMarker = "I hit an internal model/tool-routing error";

// --- Part 1: scripted models -------------------------------------------------

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const fixtureMaterial: PdfMaterial = {
  id: "ciclo-del-agua",
  title: "El ciclo del agua",
  fileName: "ciclo-del-agua.pdf",
  pageCount: 3,
  uploadedAt: "2026-01-01T00:00:00.000Z"
};

const ScriptedMaterialRepository = Layer.succeed(MaterialRepository, {
  list: () => Effect.succeed([fixtureMaterial]),
  get: (id) => id === fixtureMaterial.id
    ? Effect.succeed(fixtureMaterial)
    : Effect.fail(new MaterialNotFound({ materialId: id })),
  renderPages: (materialId, pages) => materialId === fixtureMaterial.id
    ? Effect.succeed<MaterialPageImages>({
        type: "material-page-images",
        material: fixtureMaterial,
        pages: pages.map((page) => ({ page, mediaType: "image/png", data: `data:image/png;base64,${onePixelPng}` }))
      })
    : Effect.fail(new MaterialNotFound({ materialId })),
  save: () => Effect.die("material repository save is not used by this eval"),
  remove: () => Effect.die("material repository remove is not used by this eval")
});

const makeHarness = (materialRepository: MaterialRepository) => AgentHarness.make({
  name: academicTutorSystemPrompt,
  skills: AcademicTutorSkills,
  commands: [makeMaterialCommands(materialRepository)]
});

type Step = (options: LanguageModel.ProviderOptions) => ReadonlyArray<Response.PartEncoded>;

const text = (content: string): Step => () => [Response.makePart("text", { text: content })];
const call = (id: string, input: string): Step => () => [
  Response.makePart("tool-call", { id, name: "cli", params: { input }, providerExecuted: false })
];

const scriptedModel = (steps: readonly Step[], received: Ref.Ref<readonly LanguageModel.ProviderOptions[]>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      generateText: (options) => Effect.gen(function* () {
        const index = (yield* Ref.get(received)).length;
        yield* Ref.update(received, (all) => [...all, options]);
        const step = steps[index] ?? steps[steps.length - 1];
        return step === undefined ? [] : [...step(options)];
      }),
      streamText: () => { throw new Error("not used"); }
    })
  );

const systemTexts = (options: LanguageModel.ProviderOptions | undefined) =>
  (options?.prompt.content ?? [])
    .filter((message) => message.role === "system")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");

const runScripted = (input: string, steps: readonly Step[]) => Effect.gen(function* () {
  const received = yield* Ref.make<readonly LanguageModel.ProviderOptions[]>([]);
  const materialRepository = yield* MaterialRepository;
  const harness = makeHarness(materialRepository);
  const result = yield* AgentSession.make(harness).run({ input, maxSteps: 6 }).pipe(
    Effect.provide(Layer.mergeAll(harness.layer, scriptedModel(steps, received)))
  );
  const prompts = yield* Ref.get(received);
  return { result, prompts };
});

const guardCases = Effect.gen(function* () {
  const results: CriterionResult[] = [];

  // A. Draft cites an unrendered page -> reminder -> model renders -> grounded answer.
  const a = yield* runScripted("¿Qué dice la página 2?", [
    text("Según la página 2, el vapor se condensa en nubes."),
    call("call_a", "materials view ciclo-del-agua 2"),
    text("En la página 2 se explica la precipitación y la recolección.")
  ]);
  const aRendered = renderedPages(a.result.messages);
  results.push(
    criterion("A.retry-happened", a.prompts.length === 3, `model calls: ${a.prompts.length}`),
    criterion("A.reminder-injected-as-system", systemTexts(a.prompts[1]).includes("GROUNDING CHECK FAILED"), "second prompt carries the grounding reminder"),
    criterion("A.draft-not-in-history", !a.result.messages.some((message) => message.role === "assistant" && message.content.includes("vapor se condensa")), "ungrounded draft was discarded"),
    criterion("A.page-rendered", aRendered.get("ciclo-del-agua")?.has(2) === true, "page 2 rendered through materials view"),
    criterion("A.final-grounded", !a.result.output.includes(disclaimerMarker) && ungroundedCitations(a.result.output, aRendered).length === 0, `output: ${a.result.output}`)
  );

  // B. Model keeps citing an unrendered page -> answer flagged, only one retry.
  const b = yield* runScripted("¿Qué dice la página 3?", [
    text("La página 3 define acuífero."),
    text("La página 3 define acuífero y escorrentía.")
  ]);
  results.push(
    criterion("B.single-retry", b.prompts.length === 2, `model calls: ${b.prompts.length}`),
    criterion("B.answer-flagged", b.result.output.includes(disclaimerMarker) && b.result.output.includes("páginas 3"), "disclaimer names page 3")
  );

  // C. No page citation -> no retry.
  const c = yield* runScripted("¿Qué es el ciclo del agua?", [
    text("Es el movimiento continuo del agua en la Tierra.")
  ]);
  results.push(
    criterion("C.no-retry-without-citation", c.prompts.length === 1 && !c.result.output.includes(disclaimerMarker), `model calls: ${c.prompts.length}`)
  );

  // D. Citation parser.
  const parsed = citedPages("Ver página 2, págs. 4-6 y 9; page 12 and pages 1 to 2. El año 1674 no es página.");
  results.push(
    criterion("D.citation-parser", JSON.stringify(parsed) === JSON.stringify([2, 4, 5, 6, 9, 12, 1]), `parsed: ${parsed.join(",")}`)
  );

  return results;
}).pipe(Effect.provide(ScriptedMaterialRepository));

// --- Part 2: live model with the fixture PDF --------------------------------

interface LiveCase {
  readonly id: string;
  readonly input: string;
  readonly materialsDir: string;
  readonly expectsNoCitation: boolean;
}

const liveCases: readonly LiveCase[] = [
  { id: "L1.phases-pages-1-2", input: "Explícame las fases del ciclo del agua usando mi material, páginas 1-2, y cita las páginas.", materialsDir: "fixtures/materials", expectsNoCitation: false },
  { id: "L2.page-3-acuiferos", input: "¿Qué dice la página 3 de mi material sobre los acuíferos?", materialsDir: "fixtures/materials", expectsNoCitation: false },
  { id: "L3.dates-and-page", input: "¿Qué fechas menciona mi material y en qué página aparecen?", materialsDir: "fixtures/materials", expectsNoCitation: false },
  { id: "L4.no-such-material", input: "Explícame la página 2 de mis apuntes de álgebra.", materialsDir: "fixtures/materials-empty", expectsNoCitation: true },
  { id: "L5.summarize-nothing", input: "Resume mis apuntes citando las páginas.", materialsDir: "fixtures/materials-empty", expectsNoCitation: true },
  { id: "L6.general-question", input: "¿Qué es la fotosíntesis?", materialsDir: "fixtures/materials-empty", expectsNoCitation: true }
];

const runLive = (testCase: LiveCase) => Effect.gen(function* () {
  const materialRepository = yield* MaterialRepository;
  const harness = makeHarness(materialRepository);
  const result = yield* AgentSession.make(harness).run({ input: testCase.input, maxSteps: 8 }).pipe(
    Effect.provide(harness.layer)
  );

  const rendered = renderedPages(result.messages);
  const renderedList = [...rendered.values()].flatMap((pages) => [...pages]);
  const cited = citedPages(result.output);
  const ungrounded = ungroundedCitations(result.output, rendered);
  const flagged = result.output.includes(disclaimerMarker);
  const modelError = result.output.includes(modelErrorMarker);
  const listedMaterials = result.messages.some((message) =>
    message.role === "tool-call" && message.name === "cli"
    && typeof (message.input as { input?: unknown }).input === "string"
    && /^\s*materials\s+list/.test((message.input as { input: string }).input)
  );

  // Material cases: the tutor read the material and every cited page was rendered.
  // No-material cases: the tutor checked the materials and nothing was rendered or flagged
  // (the refusal text itself cannot be judged automatically).
  // A no-material refusal may echo the page the user asked for ("page 2 of your notes"),
  // so only the flag matters there; material cases must be fully grounded.
  const passed = !modelError && !flagged && (
    testCase.expectsNoCitation
      ? listedMaterials && renderedList.length === 0
      : ungrounded.length === 0 && renderedList.length > 0
  );

  return criterion(
    testCase.id,
    passed,
    modelError
      ? `MODEL ERROR :: ${result.output.replaceAll("\n", " ").slice(0, 700)}`
      : `cited [${cited.join(",")}] rendered [${renderedList.join(",")}] listed=${listedMaterials}${flagged ? " FLAGGED" : ""} :: ${result.output.slice(0, 160).replaceAll("\n", " ")}`
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
  const filter = process.env.GROUNDING_CASES;
  if (filter === undefined || filter.trim().length === 0) {
    return liveCases;
  }
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

class GroundingEvalFailed extends Data.TaggedError("GroundingEvalFailed")<{}> {}

export const groundingEval = Effect.gen(function* () {
  const live = process.env.GROUNDING_LIVE === "1";
  const results = [
    ...(yield* guardCases),
    ...(live ? yield* liveCasesEffect : [])
  ];

  const lines = [`academic-tutor.grounding${live ? " (guard + live)" : " (guard only; set GROUNDING_LIVE=1 for live cases)"}`];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new GroundingEvalFailed();
  }

  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(groundingEval);
}
