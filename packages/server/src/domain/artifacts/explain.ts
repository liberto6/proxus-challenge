import {
  explainLimits,
  type Artifact,
  type ArtifactView,
  type CreateExplainArtifactInput,
  type DictationSample,
  type ExplainAnswer,
  type ExplainArtifact,
  type ExplainKeyPoint,
  type KeyPointCorrection,
  type KeyPointMatch,
  type KeyPointStatus
} from "@proxus/shared";

/**
 * Explanation objective: the tutor fixes the key points a student should be
 * able to explain, each with a hidden reference and the ideas that must
 * appear; the student explains in their own words and the grader checks
 * every point against the transcript.
 *
 * Everything here is deterministic and free of I/O: validation of what the
 * model sends (with issues and hints, all at once, so it can repair the JSON in
 * one round trip), the term-coverage grader, the public projection that keeps
 * the solutions on the server, and the sample transcripts of the prototype's
 * simulated dictation.
 */

// --- Validation ---------------------------------------------------------------

export interface ExplainIssue {
  readonly code: ExplainIssueCode;
  readonly message: string;
}

export type ExplainIssueCode =
  | "source-required"
  | "prompt-length"
  | "key-point-count"
  | "duplicate-key-point-id"
  | "label-length"
  | "expected-length"
  | "label-is-expected"
  | "must-mention-count"
  | "must-mention-term"
  | "must-mention-repeated"
  | "contradictions"
  | "point-no-pages"
  | "point-page-outside-source"
  | "page-out-of-range"
  | "page-not-rendered"
  | "outline-like";

export interface ExplainValidationContext {
  /** Pages of the source material; when known, cited pages must be within 1..pageCount. */
  readonly pageCount?: number | undefined;
  /** Pages of the source material rendered in this conversation; when known, cited pages must be among them. */
  readonly renderedPages?: ReadonlySet<number> | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lower-case ASCII slug used for key point ids: "Qué es la evaporación" -> "que-es-la-evaporacion". */
const slugId = (value: string): string => value
  .trim()
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40);

const asPages = (pages: unknown): unknown => {
  if (typeof pages === "number") return [pages];
  if (typeof pages === "string" && /^\d+$/.test(pages.trim())) return [Number(pages)];
  if (Array.isArray(pages)) {
    return [...new Set(pages.map((page) => typeof page === "string" && /^\d+$/.test(page.trim()) ? Number(page) : page))];
  }
  return pages;
};

const asStringList = (value: unknown): unknown => typeof value === "string" ? [value] : value;

/**
 * Fixes what can be fixed without losing information before decoding: ids
 * derived from labels, a single page or term instead of a list, trimmed text.
 * Anything else is left for the schema and `validateExplain` to report.
 */
export const normalizeExplainInput = (raw: unknown): unknown => {
  if (!isRecord(raw) || raw.kind !== "explain") return raw;
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints.map((point, index) => {
        if (!isRecord(point)) return point;
        const label = typeof point.label === "string" ? point.label.trim() : point.label;
        const id = typeof point.id === "string" && point.id.trim().length > 0
          ? point.id.trim()
          : typeof label === "string" && slugId(label).length > 0 ? slugId(label) : `p${index + 1}`;
        return {
          ...point,
          id,
          label,
          expected: typeof point.expected === "string" ? point.expected.trim() : point.expected,
          pages: asPages(point.pages),
          mustMention: asStringList(point.mustMention),
          ...(point.contradictions === undefined ? {} : { contradictions: asStringList(point.contradictions) })
        };
      })
    : raw.keyPoints;
  return {
    ...raw,
    prompt: typeof raw.prompt === "string" ? raw.prompt.trim() : raw.prompt,
    keyPoints,
    ...(isRecord(raw.source) ? { source: { ...raw.source, pages: asPages(raw.source.pages) } } : {})
  };
};

const withinLength = (value: string, limits: { readonly min: number; readonly max: number }) =>
  value.trim().length >= limits.min && value.trim().length <= limits.max;

/**
 * A label that reads like a section title rather than an idea to explain:
 * no verb-like word, no question, three words or fewer.
 */
const looksLikeHeading = (label: string): boolean => {
  const words = label.trim().split(/\s+/);
  if (/\?/.test(label)) return false;
  if (words.length > 3) return false;
  return !/\b(que|qué|cómo|como|por qué|porque|cuándo|cuando|dónde|donde|cuál|cual|es|son|ocurre|pasa|provoca|explica|significa|hace|sirve)\b/i.test(label);
};

export const validateExplain = (
  input: CreateExplainArtifactInput,
  context: ExplainValidationContext = {}
): readonly ExplainIssue[] => {
  const issues: ExplainIssue[] = [];
  const push = (code: ExplainIssueCode, message: string) => issues.push({ code, message });
  const limits = explainLimits;

  if (input.source === undefined || input.source.pages.length === 0) {
    push("source-required", "An explanation objective needs `source` with the material id and the pages you rendered; the key points are anchored to them.");
  }

  if (!withinLength(input.prompt, limits.prompt)) {
    push("prompt-length", `\`prompt\` must have ${limits.prompt.min}-${limits.prompt.max} characters: one sentence asking the student to explain the topic in their own words.`);
  }

  const points = input.keyPoints;
  if (points.length < limits.keyPoints.min || points.length > limits.keyPoints.max) {
    push("key-point-count", `Use ${limits.keyPoints.min}-${limits.keyPoints.max} key points (got ${points.length}). Each one is an idea the student must explain, not a section of the document.`);
  }

  const seen = new Set<string>();
  const usedTerms = new Map<string, string>();
  let headingLike = 0;
  const sourcePages = new Set(input.source?.pages ?? []);

  for (const point of points) {
    const where = `key point "${point.id}"`;
    if (seen.has(point.id)) {
      push("duplicate-key-point-id", `Duplicate key point id "${point.id}". Ids must be unique.`);
    }
    seen.add(point.id);

    if (!withinLength(point.label, limits.label)) {
      push("label-length", `${where}: \`label\` must have ${limits.label.min}-${limits.label.max} characters (a short idea or question, e.g. "Qué provoca la evaporación").`);
    }
    if (!withinLength(point.expected, limits.expected)) {
      push("expected-length", `${where}: \`expected\` must have ${limits.expected.min}-${limits.expected.max} characters: one to three sentences taken from the rendered pages.`);
    }
    if (normalizeForCompare(point.label) === normalizeForCompare(point.expected)) {
      push("label-is-expected", `${where}: \`expected\` repeats the label. Write the explanation the student should give, not the title of the point.`);
    }
    if (looksLikeHeading(point.label)) {
      headingLike += 1;
    }

    const terms = point.mustMention.map((term) => term.trim()).filter((term) => term.length > 0);
    if (terms.length < limits.mustMention.min || terms.length > limits.mustMention.max) {
      push("must-mention-count", `${where}: \`mustMention\` needs ${limits.mustMention.min}-${limits.mustMention.max} required ideas (got ${terms.length}). Use "a|b" to accept synonyms.`);
    }
    for (const term of terms) {
      const alternatives = term.split("|").map((alternative) => alternative.trim()).filter((alternative) => alternative.length > 0);
      if (alternatives.length === 0 || term.length > limits.mustMention.term.max) {
        push("must-mention-term", `${where}: the required idea "${term}" is empty or longer than ${limits.mustMention.term.max} characters. Use a word or a short phrase.`);
        continue;
      }
      for (const alternative of alternatives) {
        const key = normalizeForCompare(alternative);
        const owner = usedTerms.get(key);
        if (owner !== undefined && owner !== point.id) {
          push("must-mention-repeated", `${where}: the required idea "${alternative}" already belongs to key point "${owner}". Each point must check something different.`);
        } else {
          usedTerms.set(key, point.id);
        }
      }
    }

    const contradictions = point.contradictions ?? [];
    if (contradictions.length > limits.contradictions.max || contradictions.some((phrase) => phrase.trim().length === 0 || phrase.length > limits.contradictions.term.max)) {
      push("contradictions", `${where}: \`contradictions\` accepts up to ${limits.contradictions.max} short phrases (≤ ${limits.contradictions.term.max} characters) that reveal a wrong idea.`);
    }

    if (point.pages.length < limits.pagesPerPoint.min || point.pages.length > limits.pagesPerPoint.max) {
      push("point-no-pages", `${where}: cite ${limits.pagesPerPoint.min}-${limits.pagesPerPoint.max} pages of the material that explain this point.`);
    }
    for (const page of point.pages) {
      if (!Number.isInteger(page) || page < 1) {
        push("page-out-of-range", `${where}: page ${page} is not a valid page number.`);
      } else if (context.pageCount !== undefined && page > context.pageCount) {
        push("page-out-of-range", `${where}: page ${page} does not exist; the material has ${context.pageCount} page(s).`);
      } else if (input.source !== undefined && !sourcePages.has(page)) {
        push("point-page-outside-source", `${where}: page ${page} is not in \`source.pages\` [${[...sourcePages].join(", ")}]. Add it to the source or cite one of those pages.`);
      } else if (context.renderedPages !== undefined && !context.renderedPages.has(page)) {
        push("page-not-rendered", `${where}: page ${page} was not rendered in this conversation. Run \`materials view\` on it before anchoring a point to it.`);
      }
    }
  }

  if (points.length > 0 && headingLike * 2 >= points.length) {
    push("outline-like", `${headingLike} of ${points.length} labels read like section titles ("Evaporación", "Fase 2"). Write each key point as the idea to explain ("Qué provoca la evaporación", "Por qué el vapor se condensa").`);
  }

  return issues;
};

export const renderExplainIssues = (issues: readonly ExplainIssue[]): string => [
  `EXPLAIN_INVALID (${issues.length} problem${issues.length === 1 ? "" : "s"}). Fix all of them and call \`artifacts create\` again with the full JSON.`,
  ...issues.map((item, index) => `${index + 1}. [${item.code}] ${item.message}`)
].join("\n");

// --- Text normalization ---------------------------------------------------------

const normalizeForCompare = (value: string): string => value
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ]+/g, " ")
  .trim();

/** A word of the transcript with its position in the original text. */
interface Token {
  readonly stem: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Simple Spanish plural stripping so "precipitaciones" matches "precipitación"
 * and "fases" matches "fase". Not a stemmer: verb forms and gender are left to
 * the synonyms the tutor declares.
 */
export const stem = (word: string): string => {
  if (word.length <= 3) return word;
  if (word.endsWith("es") && /[nrldzj]$/.test(word.slice(0, -2)) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
};

/** Splits text into stemmed words keeping the character range of each one in the original string. */
export const tokenize = (text: string): readonly Token[] => {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+/gu;
  for (const match of text.matchAll(pattern)) {
    const word = normalizeForCompare(match[0]);
    if (word.length === 0) continue;
    tokens.push({ stem: stem(word), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
};

/** Finds a term (one or more words; alternatives separated by `|`) in the tokens; returns the first occurrence. */
export const findTerm = (tokens: readonly Token[], term: string): KeyPointMatch | undefined => {
  for (const alternative of term.split("|")) {
    const words = normalizeForCompare(alternative).split(" ").filter((word) => word.length > 0).map(stem);
    if (words.length === 0) continue;
    for (let index = 0; index + words.length <= tokens.length; index++) {
      if (words.every((word, offset) => tokens[index + offset]?.stem === word)) {
        const first = tokens[index]!;
        const last = tokens[index + words.length - 1]!;
        return { term: alternative.trim(), start: first.start, end: last.end };
      }
    }
  }
  return undefined;
};

// --- Grading -----------------------------------------------------------------------

/** How a key point scores: a covered point is worth 1, a partial one half. */
export const keyPointScore: Record<KeyPointStatus, number> = { covered: 1, partial: 0.5, missing: 0, wrong: 0 };

/** The idea as shown to the student: the first alternative of "a|b". */
const displayTerm = (term: string): string => term.split("|")[0]?.trim() ?? term;

const listTerms = (terms: readonly string[]): string => {
  const shown = terms.map((term) => `«${displayTerm(term)}»`);
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} y ${shown.at(-1)}`;
};

export const gradeKeyPoint = (point: ExplainKeyPoint, tokens: readonly Token[]): KeyPointCorrection => {
  const contradiction = (point.contradictions ?? [])
    .map((phrase) => findTerm(tokens, phrase))
    .find((match): match is KeyPointMatch => match !== undefined);

  const required = point.mustMention.map((term) => ({ term, match: findTerm(tokens, term) }));
  const found = required.filter((item) => item.match !== undefined);
  const missing = required.filter((item) => item.match === undefined).map((item) => item.term);
  const matches = found.map((item) => item.match!);

  const status: KeyPointStatus = contradiction !== undefined
    ? "wrong"
    : found.length === required.length
      ? "covered"
      : found.length > 0 ? "partial" : "missing";

  const feedback = status === "wrong"
    ? `Hay una idea equivocada: «${contradiction!.term}». Revisa la página ${point.pages.join(", ")}.`
    : status === "covered"
      ? `Has explicado ${listTerms(found.map((item) => item.term))}.`
      : status === "partial"
        ? `Mencionas ${listTerms(found.map((item) => item.term))}, pero falta ${listTerms(missing)}.`
        : `No aparece ${listTerms(missing)}. Es lo esencial de este punto.`;

  return {
    keyPointId: point.id,
    status,
    feedback,
    pages: point.pages,
    matches: status === "wrong" ? [contradiction!, ...matches] : matches,
    ...(status === "covered" ? {} : { expected: point.expected })
  };
};

export interface ExplainGrade {
  readonly score: number;
  readonly maxScore: number;
  readonly summary: string;
  readonly corrections: readonly KeyPointCorrection[];
}

/** Grades a transcript against every key point. Pure: same input, same result. */
export const gradeExplain = (artifact: ExplainArtifact, answer: ExplainAnswer): ExplainGrade => {
  const tokens = tokenize(answer.transcript);
  const corrections = artifact.keyPoints.map((point) => gradeKeyPoint(point, tokens));
  const score = corrections.reduce((total, correction) => total + keyPointScore[correction.status], 0);
  const maxScore = artifact.keyPoints.length;
  const covered = corrections.filter((correction) => correction.status === "covered").length;
  return {
    score,
    maxScore,
    summary: `${score}/${maxScore} puntos (${covered} cubiertos)`,
    corrections
  };
};

// --- Projection ------------------------------------------------------------------

/** The artifact as the web receives it: an explanation objective loses its solutions. */
export const toArtifactView = (artifact: Artifact): ArtifactView => {
  if (artifact.kind !== "explain") return artifact;
  return {
    ...artifact,
    keyPoints: artifact.keyPoints.map((point) => ({ id: point.id, label: point.label, pages: point.pages }))
  };
};

// --- Simulated dictation samples -------------------------------------------------

const connectors = ["Para empezar,", "Luego,", "Además,", "Después,", "Por otro lado,", "Por último,"] as const;

const lowerFirst = (text: string) => text.length === 0 ? text : text[0]!.toLocaleLowerCase() + text.slice(1);

const spoken = (points: readonly ExplainKeyPoint[]): string =>
  points.map((point, index) => `${connectors[index % connectors.length]} ${lowerFirst(point.expected.trim())}`).join(" ");

/**
 * Three transcripts for the prototype's simulated dictation, built from the
 * solutions so the demo works with any objective the tutor creates: one that
 * covers every point, one that covers about half, one with no required idea.
 */
export const buildDictationSamples = (artifact: ExplainArtifact): readonly DictationSample[] => {
  const points = artifact.keyPoints;
  const half = points.slice(0, Math.ceil(points.length / 2));
  // The weak sample must not hit a required idea by accident ("orden", "partes"):
  // if it does for this objective, a shorter sentence without them is used.
  const weak = [
    "Bueno, este tema lo hemos visto en clase. Tiene varias partes que van una detrás de otra y se relacionan entre sí, y hay que entenderlas en orden, pero ahora mismo no sabría explicarlo con detalle.",
    "Bueno, esto lo hemos visto en clase, pero ahora mismo no sabría explicarlo."
  ].find((transcript) => gradeExplain(artifact, { transcript, inputMode: "text" }).score === 0) ?? "Bueno, no sabría explicarlo.";
  return [
    { quality: "good", transcript: `A ver, te lo explico. ${spoken(points)}` },
    {
      quality: "partial",
      transcript: `A ver, te lo explico. ${spoken(half)} Y luego… no me acuerdo bien del resto, creo que sigue algo más pero no sabría contarlo.`
    },
    { quality: "weak", transcript: weak }
  ];
};
