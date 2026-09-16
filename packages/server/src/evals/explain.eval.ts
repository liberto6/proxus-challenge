import { isMain } from "../lib/is-main.ts";
import { Console, Data, Effect, Schema } from "effect";
import { Artifact, ArtifactView, CreateArtifactInput, type CreateExplainArtifactInput, type ExplainArtifact } from "@proxus/shared";
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

// --- Runner --------------------------------------------------------------------------

class ExplainEvalFailed extends Data.TaggedError("ExplainEvalFailed")<{}> {}

export const explainEval = Effect.gen(function* () {
  const results = [
    ...(yield* validationCases),
    ...(yield* gradingCases),
    ...(yield* projectionCases)
  ];

  const lines = ["academic-tutor.explain (validation, grading, samples, projection)"];
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
