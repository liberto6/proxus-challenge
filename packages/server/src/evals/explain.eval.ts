import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Layer, Ref, Schema } from "effect";
import { LanguageModel, Response } from "effect/unstable/ai";
import { Artifact, ArtifactView, CreateArtifactInput, type CreateExplainArtifactInput, type ExplainArtifact, type GradedExplainAttempt } from "@proxus/shared";
import { AgentHarness, AgentSession } from "../domain/agents/harness/index.ts";
import { academicTutorSystemPrompt } from "../domain/agents/academic-tutor.ts";
import { makeArtifactCommands } from "../domain/agents/academic-tutor/artifact-commands.ts";
import { makeMaterialCommands } from "../domain/agents/academic-tutor/material-commands.ts";
import { assessExplanationsExample, makeAcademicTutorSkills } from "../domain/agents/academic-tutor/skills/index.ts";
import { describeUiContext } from "../domain/agents/academic-tutor/ui-context.ts";
import { ArtifactNotFound, makeArtifact, type Artifact as ArtifactType, type ArtifactRepository as ArtifactRepositoryType } from "../domain/artifacts/artifact.ts";
import { MaterialNotFound, MaterialRepository, type MaterialPageImages, type PdfMaterial } from "../domain/materials/material.ts";
import {
  buildDictationSamples,
  findTerm,
  gradeExplain,
  normalizeExplainInput,
  stem,
  toArtifactView,
  tokenize,
  validateExplain,
  type ExplainIssueCode
} from "../domain/artifacts/explain.ts";

/**
 * Deterministic eval (no API calls) of the explanation objective.
 *
 * Part 1: validation and normalization of what the model sends.
 * Part 2: the term-coverage grader over fixed transcripts (good, partial,
 *         wrong, weak), including stemming, accents, synonyms and the character
 *         ranges used for highlighting.
 * Part 3: the sample transcripts of the simulated dictation and the public
 *         projection that keeps the solutions on the server.
 * Part 4: the tutor with a scripted model: creates after rendering, is rejected
 *         when the labels are section titles or the pages were not read, repairs.
 * Part 5: skill text and the UI context note (hidden references, latest attempt).
 *
 *   pnpm --filter @proxus/server run eval:tutor:explain
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

// --- Fixture: the water cycle ---------------------------------------------------

const validInput: CreateExplainArtifactInput = {
  kind: "explain",
  title: "Explica el ciclo del agua",
  source: { materialId: "ciclo-del-agua", pages: [1, 2, 3] },
  prompt: "Explica con tus palabras cómo funciona el ciclo del agua, de principio a fin.",
  keyPoints: [
    {
      id: "evaporacion",
      label: "Qué es la evaporación y qué la provoca",
      expected: "El calor del sol calienta el agua de mares, ríos y lagos y la convierte en vapor de agua que sube a la atmósfera.",
      mustMention: ["sol|calor", "vapor"],
      pages: [1]
    },
    {
      id: "condensacion",
      label: "Qué le pasa al vapor en altura",
      expected: "Al subir, el vapor se enfría y se condensa en pequeñas gotas que forman las nubes.",
      mustMention: ["se enfría|enfriar|frío", "nubes"],
      contradictions: ["se calienta en altura"],
      pages: [2]
    },
    {
      id: "precipitacion",
      label: "Cómo vuelve el agua a la superficie",
      expected: "Cuando las gotas pesan demasiado caen en forma de lluvia, nieve o granizo: es la precipitación.",
      mustMention: ["lluvia|precipitación"],
      pages: [2, 3]
    },
    {
      id: "ciclo",
      label: "Por qué es un ciclo",
      expected: "El agua recogida vuelve a mares y ríos y el proceso empieza de nuevo, sin principio ni fin.",
      mustMention: ["vuelve|regresa|empieza de nuevo"],
      pages: [3]
    }
  ]
};

const artifact: ExplainArtifact = { ...validInput, id: "explain-1", createdAt: "2026-01-01T00:00:00.000Z" };

const rendered = new Set([1, 2, 3]);
const context = { pageCount: 3, renderedPages: rendered };

const codes = (input: CreateExplainArtifactInput, ctx = context) => validateExplain(input, ctx).map((issue) => issue.code);
const has = (list: readonly ExplainIssueCode[], code: ExplainIssueCode) => list.includes(code);

const withPoints = (edit: (points: CreateExplainArtifactInput["keyPoints"]) => CreateExplainArtifactInput["keyPoints"]): CreateExplainArtifactInput =>
  ({ ...validInput, keyPoints: edit(validInput.keyPoints) });

// --- Part 1: validation and normalization ---------------------------------------

const validationCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  const valid = codes(validInput);
  results.push(criterion("valid-objective-passes", valid.length === 0, `issues: ${valid.join(",") || "none"}`));

  const noSource = codes({ ...validInput, source: undefined });
  results.push(criterion("source-required", has(noSource, "source-required"), noSource.join(",")));

  const unread = codes(validInput, { pageCount: 3, renderedPages: new Set([1, 2]) });
  results.push(criterion("page-not-rendered", has(unread, "page-not-rendered") && !has(unread, "page-out-of-range"), unread.join(",")));

  const outside = codes(withPoints((points) => points.map((point, index) => index === 0 ? { ...point, pages: [4] } : point)), { pageCount: 4, renderedPages: new Set([1, 2, 3, 4]) });
  results.push(criterion("page-outside-source", has(outside, "point-page-outside-source"), outside.join(",")));

  const labelIsExpected = codes(withPoints((points) => points.map((point, index) => index === 0 ? { ...point, expected: point.label } : point)));
  results.push(criterion("label-is-expected", has(labelIsExpected, "label-is-expected"), labelIsExpected.join(",")));

  const noTerms = codes(withPoints((points) => points.map((point, index) => index === 1 ? { ...point, mustMention: [] } : point)));
  results.push(criterion("must-mention-count", has(noTerms, "must-mention-count"), noTerms.join(",")));

  const repeated = codes(withPoints((points) => points.map((point, index) => index === 2 ? { ...point, mustMention: ["vapor"] } : point)));
  results.push(criterion("must-mention-repeated", has(repeated, "must-mention-repeated"), repeated.join(",")));

  const headings = codes(withPoints((points) => points.map((point, index) => ({ ...point, label: ["Evaporación", "Condensación", "Precipitación", "Recolección"][index]! }))));
  results.push(criterion("outline-like-labels", has(headings, "outline-like"), headings.join(",")));

  const tooMany = codes(withPoints((points) => [...points, ...points.map((point) => ({ ...point, id: `${point.id}-2`, mustMention: point.mustMention.map((term) => `${term}-2`) }))]));
  results.push(criterion("key-point-count", has(tooMany, "key-point-count"), tooMany.join(",")));

  const noPages = codes(withPoints((points) => points.map((point, index) => index === 3 ? { ...point, pages: [] } : point)));
  results.push(criterion("point-no-pages", has(noPages, "point-no-pages"), noPages.join(",")));

  // Normalization: ids from labels, single page and single term as lists.
  const raw = {
    kind: "explain",
    title: "Explica el ciclo del agua",
    source: { materialId: "ciclo-del-agua", pages: "1-3" },
    prompt: validInput.prompt,
    keyPoints: validInput.keyPoints.map((point) => ({ label: point.label, expected: point.expected, mustMention: point.mustMention[0], pages: point.pages[0] }))
  };
  const normalized = normalizeExplainInput({ ...raw, source: { materialId: "ciclo-del-agua", pages: [1, 2, 3] } });
  const decoded = Schema.decodeUnknownExit(CreateArtifactInput)(normalized);
  const ids = decoded._tag === "Success" && decoded.value.kind === "explain" ? decoded.value.keyPoints.map((point) => point.id) : [];
  results.push(criterion(
    "normalization-derives-ids-and-lists",
    decoded._tag === "Success" && ids[0] === "que-es-la-evaporacion-y-que-la-provoca" && decoded.value.kind === "explain" && Array.isArray(decoded.value.keyPoints[0]?.pages) && decoded.value.keyPoints[0]?.mustMention.length === 1,
    decoded._tag === "Success" ? `ids: ${ids.join(",")}` : String(decoded.cause)
  ));

  return results;
});

// --- Part 2: grading ---------------------------------------------------------------

const transcripts = {
  good: "A ver. El sol calienta el agua del mar y de los ríos y la convierte en vapor. Ese vapor sube, se enfría y forma las nubes. Cuando las gotas pesan mucho caen como precipitaciones, y el agua vuelve al mar, así que empieza otra vez.",
  partial: "Bueno, el agua se convierte en vapor y sube. Luego arriba se forman las nubes y ya está, no me acuerdo de más.",
  wrong: "El sol convierte el agua en vapor. El vapor sube y se calienta en altura y forma las nubes. Después llueve y el agua vuelve al mar.",
  weak: "Es un tema de la naturaleza que hemos visto en clase y tiene varias partes que se relacionan."
} as const;

const statusOf = (transcript: string) => {
  const grade = gradeExplain(artifact, { transcript, inputMode: "text" });
  return { grade, statuses: grade.corrections.map((correction) => correction.status).join(",") };
};

const gradingCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  const good = statusOf(transcripts.good);
  results.push(criterion("good-covers-every-point", good.grade.score === 4 && good.statuses === "covered,covered,covered,covered", `${good.statuses} score ${good.grade.score}/${good.grade.maxScore}`));
  results.push(criterion("covered-points-hide-expected", good.grade.corrections.every((correction) => correction.expected === undefined), "no expected in covered corrections"));

  const partial = statusOf(transcripts.partial);
  results.push(criterion("partial-mixes-statuses", partial.statuses === "partial,partial,missing,missing" && partial.grade.score === 1, `${partial.statuses} score ${partial.grade.score}`));
  results.push(criterion("uncovered-points-reveal-expected", partial.grade.corrections.slice(1).every((correction) => typeof correction.expected === "string"), "expected revealed"));
  results.push(criterion("partial-feedback-names-missing-idea", /falta «nubes»|falta «se enfría»/.test(partial.grade.corrections[1]!.feedback), partial.grade.corrections[1]!.feedback));

  const wrong = statusOf(transcripts.wrong);
  results.push(criterion("contradiction-marks-wrong", wrong.grade.corrections[1]!.status === "wrong" && wrong.grade.corrections[1]!.matches[0]?.term === "se calienta en altura", `${wrong.statuses}; ${wrong.grade.corrections[1]!.feedback}`));

  const weak = statusOf(transcripts.weak);
  results.push(criterion("weak-scores-zero", weak.grade.score === 0 && weak.statuses === "missing,missing,missing,missing", weak.statuses));

  // Highlight ranges point at the original text, accents and plurals included.
  const ranges = good.grade.corrections.flatMap((correction) => correction.matches.map((match) => transcripts.good.slice(match.start, match.end)));
  results.push(criterion(
    "matches-point-at-original-text",
    ranges.includes("sol") && ranges.includes("se enfría") && ranges.includes("precipitaciones") && ranges.includes("vuelve"),
    ranges.join(" | ")
  ));

  const sentence = "Las precipitaciones y las nubes; ¡el Sol!";
  const tokens = tokenize(sentence);
  const sol = findTerm(tokens, "sol");
  results.push(criterion("stemming-and-accents", stem("precipitaciones") === "precipitacion" && stem("fases") === "fase" && stem("mes") === "mes" && findTerm(tokens, "precipitación") !== undefined && sol !== undefined && sentence.slice(sol.start, sol.end) === "Sol", `tokens: ${tokens.map((token) => token.stem).join(",")}`));
  results.push(criterion("multi-word-term", findTerm(tokenize("y el proceso empieza de nuevo"), "vuelve|empieza de nuevo")?.term === "empieza de nuevo", "synonym with several words"));

  return results;
});

// --- Part 3: samples and projection ------------------------------------------------

const projectionCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  const samples = buildDictationSamples(artifact);
  const scores = Object.fromEntries(samples.map((sample) => [sample.quality, gradeExplain(artifact, { transcript: sample.transcript, inputMode: "voice" }).score]));
  results.push(criterion("sample-good-covers-all", scores.good === 4, `good ${scores.good}`));
  results.push(criterion("sample-partial-covers-some", scores.partial !== undefined && scores.partial >= 1 && scores.partial <= 3, `partial ${scores.partial}`));
  results.push(criterion("sample-weak-covers-none", scores.weak === 0, `weak ${scores.weak}`));

  // The weak sample avoids required ideas that happen to be everyday words.
  const everyday: ExplainArtifact = { ...artifact, keyPoints: artifact.keyPoints.map((point, index) => index === 0 ? { ...point, mustMention: ["orden|partes"] } : point) };
  const weakEveryday = buildDictationSamples(everyday).find((sample) => sample.quality === "weak")!;
  results.push(criterion("sample-weak-avoids-everyday-terms", gradeExplain(everyday, { transcript: weakEveryday.transcript, inputMode: "voice" }).score === 0, weakEveryday.transcript.slice(0, 60)));

  const view = toArtifactView(artifact);
  const json = JSON.stringify(view);
  const leaked = ["expected", "mustMention", "contradictions"].filter((key) => json.includes(`"${key}"`));
  results.push(criterion("view-hides-solutions", leaked.length === 0 && view.kind === "explain" && view.keyPoints.length === 4, leaked.length === 0 ? "no hidden keys in the view" : `leaked: ${leaked.join(",")}`));
  results.push(criterion("view-decodes-with-contract", Schema.decodeUnknownExit(ArtifactView)(JSON.parse(json))._tag === "Success", "ArtifactView"));
  results.push(criterion("stored-artifact-decodes", Schema.decodeUnknownExit(Artifact)(JSON.parse(JSON.stringify(artifact)))._tag === "Success", "Artifact"));
  results.push(criterion("other-kinds-pass-through", toArtifactView({ kind: "note", id: "n", title: "n", markdown: "x" }).kind === "note", "note unchanged"));

  return results;
});

// --- Part 4: the tutor creates, gets rejected and repairs (scripted model) ---------

const materialId = "ciclo-del-agua";

const fixtureMaterial: PdfMaterial = {
  id: materialId,
  title: "El ciclo del agua",
  fileName: "ciclo-del-agua.pdf",
  pageCount: 3,
  uploadedAt: "2026-01-01T00:00:00.000Z"
};

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

const makeInMemoryArtifacts = Effect.gen(function* () {
  const ref = yield* Ref.make<readonly ArtifactType[]>([]);
  const repository: ArtifactRepositoryType = {
    createArtifact: (input) => Effect.gen(function* () {
      const created = makeArtifact(input);
      yield* Ref.update(ref, (all) => [...all, created]);
      return created;
    }),
    saveArtifact: (item) => Ref.update(ref, (all) => [...all.filter((other) => other.id !== item.id), item]),
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
  return { repository, ref };
});

type Step = ReadonlyArray<Response.PartEncoded>;

const text = (content: string): Step => [Response.makePart("text", { text: content })];
const call = (id: string, input: string): Step => [
  Response.makePart("tool-call", { id, name: "cli", params: { input }, providerExecuted: false })
];
const create = (id: string, input: unknown): Step => call(id, `artifacts create '${JSON.stringify(input)}'`);

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
  const { repository, ref } = yield* makeInMemoryArtifacts;
  const harness = AgentHarness.make({
    name: academicTutorSystemPrompt,
    skills: makeAcademicTutorSkills({ autoDiagram: true, autoExplain: false }),
    commands: [makeMaterialCommands(materials), makeArtifactCommands(repository, materials)]
  });
  const calls = yield* Ref.make(0);
  const result = yield* AgentSession.make(harness).run({ input, maxSteps: 8 }).pipe(
    Effect.provide(Layer.mergeAll(harness.layer, scriptedModel(steps, calls)))
  );
  return { result, artifacts: yield* Ref.get(ref), modelCalls: yield* Ref.get(calls) };
});

const toolResults = (messages: ReadonlyArray<{ role: string; result?: unknown }>) =>
  messages.filter((message) => message.role === "tool-result").map((message) => typeof message.result === "string" ? message.result : JSON.stringify(message.result));

/** The skill's example with the fixture material, as the model would send it. */
const exampleInput = { ...assessExplanationsExample, source: { materialId, pages: [1, 2, 3] } };

const agentCases = Effect.gen(function* () {
  const results: CriterionResult[] = [];

  // A. view -> invalid create (labels that are section titles) -> valid create -> answer.
  const headings = { ...exampleInput, keyPoints: exampleInput.keyPoints.map((point, index) => ({ ...point, label: ["Evaporación", "Condensación", "Precipitación", "Recolección"][index]! })) };
  const a = yield* runScripted("Quiero explicarte yo el ciclo del agua y que me corrijas.", [
    call("c1", `materials view ${materialId} 1-3`),
    create("c2", headings),
    create("c3", exampleInput),
    text("Listo: cuatro puntos clave sobre las páginas 1-3. Ábrelo desde el panel y explícamelo con el micro o por escrito.")
  ]);
  const aResults = toolResults(a.result.messages);
  const rejection = aResults.find((item) => item.startsWith("EXPLAIN_INVALID"));
  const createCalls = a.result.messages.filter((message) => message.role === "tool-call" && JSON.stringify(message.input).includes("artifacts create")).length;
  const created = a.artifacts[0];
  results.push(
    criterion("first-create-rejected-as-outline", rejection !== undefined && rejection.includes("[outline-like]"), rejection?.split("\n")[1] ?? "no rejection"),
    criterion("second-create-persisted", created?.kind === "explain" && created.keyPoints.length === 4 && a.artifacts.length === 1, `artifacts: ${a.artifacts.length}`),
    criterion("persisted-keeps-hidden-fields", created?.kind === "explain" && created.keyPoints.every((point) => point.expected.length > 0 && point.mustMention.length > 0), "expected and mustMention stored"),
    criterion("two-create-calls-only", createCalls === 2 && a.modelCalls === 4, `create calls: ${createCalls}, model calls: ${a.modelCalls}`),
    criterion("confirmation-has-key-point-count", aResults.some((item) => item.includes("\"keyPointCount\": 4") && item.includes("\"kind\": \"explain\"")), "confirmation carries keyPointCount"),
    criterion("no-reference-leaks-into-answer", !a.result.output.includes("expected") && !a.result.output.includes(exampleInput.keyPoints[0].expected), a.result.output.slice(0, 80))
  );

  // B. create without rendering the pages first -> rejected, nothing persisted.
  const b = yield* runScripted("Ponme a prueba explicando el ciclo del agua.", [
    create("d1", exampleInput),
    text("No he podido crearlo.")
  ]);
  const bRejection = toolResults(b.result.messages).find((item) => item.startsWith("EXPLAIN_INVALID"));
  results.push(criterion("create-without-view-rejected", bRejection !== undefined && bRejection.includes("[page-not-rendered]") && b.artifacts.length === 0, bRejection?.split("\n")[1] ?? "no rejection"));

  // C. unknown material -> rejected with a pointer to `materials list`.
  const c = yield* runScripted("Ponme a prueba.", [
    create("e1", { ...exampleInput, source: { materialId: "algebra", pages: [1, 2] } }),
    text("Listo.")
  ]);
  const cRejection = toolResults(c.result.messages).find((item) => item.startsWith("EXPLAIN_INVALID"));
  results.push(criterion("unknown-material-rejected", cRejection !== undefined && cRejection.includes("does not exist") && c.artifacts.length === 0, cRejection?.split("\n")[1] ?? "no rejection"));

  // D. the model sends a single page number and a single term: normalization accepts them.
  const loose = {
    ...exampleInput,
    keyPoints: exampleInput.keyPoints.map((point) => ({ id: point.id, label: point.label, expected: point.expected, mustMention: point.mustMention[0], pages: point.pages[0] }))
  };
  const d = yield* runScripted("Ponme a prueba.", [
    call("f1", `materials view ${materialId} 1-3`),
    create("f2", loose),
    text("Listo.")
  ]);
  results.push(criterion("normalized-input-persisted", d.artifacts.length === 1 && d.artifacts[0]?.kind === "explain", `artifacts: ${d.artifacts.length}`));

  return results;
}).pipe(Effect.provide(ScriptedMaterialRepository));

// --- Part 5: skill and UI context ---------------------------------------------------

const plumbingCases = Effect.sync(() => {
  const results: CriterionResult[] = [];

  const auto = makeAcademicTutorSkills({ autoDiagram: true, autoExplain: true }).find((skill) => skill.name === "assess-explanations");
  const manual = makeAcademicTutorSkills({ autoDiagram: true }).find((skill) => skill.name === "assess-explanations");
  results.push(
    criterion("skill-has-rules-and-repair", auto !== undefined && auto.content.includes("EXPLAIN_INVALID") && auto.content.includes("Never reveal `expected`"), "skill has the hidden-reference rule and the repair rule"),
    criterion("skill-respects-auto-flag", auto !== undefined && manual !== undefined && auto.content.includes("On your own initiative") && manual.content.includes("## Offer it") && !manual.content.includes("On your own initiative"), "auto flag toggles the initiative section"),
    criterion("skill-example-is-valid", validateExplain({ ...exampleInput, kind: "explain" }, { pageCount: 3, renderedPages: new Set([1, 2, 3]) }).length === 0, validateExplain({ ...exampleInput, kind: "explain" }, { pageCount: 3, renderedPages: new Set([1, 2, 3]) }).map((issue) => issue.code).join(",") || "no issues"),
    criterion("skill-example-has-no-single-quotes", auto !== undefined && !/'\{[^\n]*'[^\n]*'/.test(auto.content.split("Example")[1]?.split("## If")[0] ?? "'x'x'"), "example fits inside single quotes")
  );

  const gradedAttempt: GradedExplainAttempt = {
    artifactKind: "explain",
    status: "graded",
    id: "attempt-1",
    artifactId: artifact.id,
    createdAt: "2026-01-02T00:00:00.000Z",
    answer: { transcript: transcripts.partial, inputMode: "voice" },
    ...gradeExplain(artifact, { transcript: transcripts.partial, inputMode: "voice" })
  };

  const before = describeUiContext(artifact, { openQuestionId: "condensacion" });
  results.push(
    criterion("context-before-attempt-hides-references", before.includes("no graded attempt yet") && before.includes("Not attempted yet") && !before.includes(artifact.keyPoints[1]!.expected), "no reference in the note"),
    criterion("context-lists-points-with-status", before.includes("condensacion: \"Qué le pasa al vapor en altura\" (pages 2) — not attempted"), "points listed")
  );

  const after = describeUiContext(artifact, { openQuestionId: "condensacion", latestAttempt: gradedAttempt });
  results.push(
    criterion("context-after-attempt-has-statuses", after.includes("Latest attempt: 1/4 (dictated)") && after.includes("condensacion: partial — Mencionas «nubes», pero falta «se enfría».") && after.includes("precipitacion: missing"), "statuses and feedback in the note"),
    criterion("context-focused-point-has-reference", after.includes("Focused key point condensacion") && after.includes(artifact.keyPoints[1]!.expected) && after.includes("Required ideas: se enfría|enfriar|frío; nubes"), "reference for the focused, attempted point"),
    criterion("context-mentions-this-point", after.includes("\"this point\""), "the note maps \"this point\" to the artifact")
  );

  return results;
});

// --- Runner --------------------------------------------------------------------------

class ExplainEvalFailed extends Data.TaggedError("ExplainEvalFailed")<{}> {}

export const explainEval = Effect.gen(function* () {
  const results = [
    ...(yield* validationCases),
    ...(yield* gradingCases),
    ...(yield* projectionCases),
    ...(yield* agentCases),
    ...(yield* plumbingCases)
  ];

  const lines = ["academic-tutor.explain (validation, grading, samples, projection, scripted agent, skill and UI context)"];
  for (const result of results) {
    lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
  }
  const passed = results.filter((result) => result.passed).length;
  lines.push(`${passed}/${results.length} criteria passed`);
  yield* Console.log(lines.join("\n"));

  if (passed !== results.length) {
    return yield* new ExplainEvalFailed();
  }
  return results;
});

if (isMain(import.meta.url)) {
  Effect.runPromise(explainEval);
}
