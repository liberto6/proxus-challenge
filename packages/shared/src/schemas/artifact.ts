import { Schema } from "effect";

/**
 * Single source of truth for study artifacts (notes, quizzes, tests), their
 * attempts and corrections. The server domain imports these schemas and adds
 * only behaviour (validation, grading); the web renders them.
 *
 * To add an artifact kind: add its schema to `ArtifactByKind` and its create
 * input to `CreateArtifactInputByKind`; the unions, the kind literals and the
 * API contracts derive from those maps.
 */

// --- Questions ----------------------------------------------------------------

export const QuestionOption = Schema.Struct({
  id: Schema.String,
  text: Schema.String
});
export type QuestionOption = typeof QuestionOption.Type;

export const MultipleChoiceQuestion = Schema.Struct({
  type: Schema.Literal("multiple-choice"),
  id: Schema.String,
  prompt: Schema.String,
  options: Schema.Array(QuestionOption),
  correctOptionId: Schema.String,
  explanation: Schema.String
});
export type MultipleChoiceQuestion = typeof MultipleChoiceQuestion.Type;

export const TrueFalseQuestion = Schema.Struct({
  type: Schema.Literal("true-false"),
  id: Schema.String,
  prompt: Schema.String,
  correctAnswer: Schema.Boolean,
  explanation: Schema.String
});
export type TrueFalseQuestion = typeof TrueFalseQuestion.Type;

export const ShortAnswerQuestion = Schema.Struct({
  type: Schema.Literal("short-answer"),
  id: Schema.String,
  prompt: Schema.String,
  expectedAnswer: Schema.String,
  maxScore: Schema.Number
});
export type ShortAnswerQuestion = typeof ShortAnswerQuestion.Type;

export const QuizQuestion = Schema.Union([
  MultipleChoiceQuestion,
  TrueFalseQuestion
]);
export type QuizQuestion = typeof QuizQuestion.Type;

export const TestQuestion = Schema.Union([
  MultipleChoiceQuestion,
  TrueFalseQuestion,
  ShortAnswerQuestion
]);
export type TestQuestion = typeof TestQuestion.Type;

// --- Provenance ---------------------------------------------------------------

/** Where an artifact comes from: the material and the pages it was built on. */
export const ArtifactSource = Schema.Struct({
  materialId: Schema.String,
  pages: Schema.Array(Schema.Number)
});
export type ArtifactSource = typeof ArtifactSource.Type;

// Common to every artifact. `source` and `createdAt` are optional so artifacts
// stored before they existed still decode.
const artifactBase = {
  id: Schema.String,
  title: Schema.String,
  source: Schema.optional(ArtifactSource),
  createdAt: Schema.optional(Schema.String),
  /** Folder of the conversation that created it; absent means General. */
  folderId: Schema.optional(Schema.String)
};

// --- Diagrams -------------------------------------------------------------------

/**
 * Size limits of a diagram. The domain validator enforces them and the tutor's
 * skill quotes them; keeping them here means both read the same numbers.
 */
export const diagramLimits = {
  nodes: { min: 3, max: 16 },
  edges: { max: 32 },
  label: { min: 2, max: 40 },
  sublabel: { min: 8, max: 60 },
  description: { min: 20, max: 240 },
  summary: { min: 20, max: 300 },
  edgeLabel: { min: 2, max: 30 },
  pagesPerNode: { min: 1, max: 6 },
  groups: { max: 6, members: { min: 2, max: 8 } },
  cards: { max: 3, title: { max: 40 }, items: { min: 2, max: 5 }, item: { max: 120 } },
  views: { max: 4, focus: { min: 2, max: 8 } }
} as const;

/**
 * What a node is, which decides its shape in the drawing:
 * `step` (a phase of a process), `concept`, `agent` (who or what acts),
 * `condition` (what decides a branch), `quantity`, `formula` (carries the
 * expression), `definition`, `example`.
 */
export const DiagramNodeKind = Schema.Union([
  Schema.Literal("step"),
  Schema.Literal("concept"),
  Schema.Literal("agent"),
  Schema.Literal("condition"),
  Schema.Literal("quantity"),
  Schema.Literal("formula"),
  Schema.Literal("definition"),
  Schema.Literal("example")
]);
export type DiagramNodeKind = typeof DiagramNodeKind.Type;

/**
 * A concept in the diagram, anchored to the material pages that explain it.
 * `sublabel`, `kind`, `formula` and `phase` arrived with the second version and
 * stay optional so earlier diagrams still decode; the validator requires what
 * each type needs when a new diagram is created.
 */
export const DiagramNode = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  pages: Schema.Array(Schema.Number),
  /** One line shown inside the box: what the concept is. */
  sublabel: Schema.optional(Schema.String),
  kind: Schema.optional(DiagramNodeKind),
  /** The expression of a `formula` node, as text. */
  formula: Schema.optional(Schema.String),
  /** Timeline: the phase (period, stage) the step belongs to. */
  phase: Schema.optional(Schema.String)
});
export type DiagramNode = typeof DiagramNode.Type;

/** Nodes that belong together; drawn as an outlined box with a title. */
export const DiagramGroup = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  nodeIds: Schema.Array(Schema.String)
});
export type DiagramGroup = typeof DiagramGroup.Type;

/** Text that does not fit in boxes (definitions, dates, key points), shown under the drawing. */
export const DiagramCard = Schema.Struct({
  title: Schema.String,
  items: Schema.Array(Schema.String),
  pages: Schema.Array(Schema.Number)
});
export type DiagramCard = typeof DiagramCard.Type;

/** A guided view: a subset of nodes worth looking at together. */
export const DiagramView = Schema.Struct({
  label: Schema.String,
  focus: Schema.Array(Schema.String),
  note: Schema.optional(Schema.String)
});
export type DiagramView = typeof DiagramView.Type;

/** A relation between two nodes. The label is the proposition ("aporta vapor"). */
export const DiagramEdge = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  label: Schema.optional(Schema.String)
});
export type DiagramEdge = typeof DiagramEdge.Type;

/**
 * - `process`: ordered steps (`mainPath`) plus side relations in `edges`;
 *   an edge between two consecutive steps is the labelled transition (its
 *   cause); `cyclic` closes the last step back to the first.
 * - `concept-map`: a central concept (`rootId`) and labelled relations.
 * - `timeline`: ordered steps on an axis, each in a phase of `phases`.
 */
export const DiagramType = Schema.Union([
  Schema.Literal("process"),
  Schema.Literal("concept-map"),
  Schema.Literal("timeline")
]);
export type DiagramType = typeof DiagramType.Type;

// The model describes semantics only: no positions, sizes or colours. The web
// computes the geometry from the graph.
const diagramFields = {
  diagramType: DiagramType,
  summary: Schema.String,
  nodes: Schema.Array(DiagramNode),
  edges: Schema.Array(DiagramEdge),
  mainPath: Schema.optional(Schema.Array(Schema.String)),
  cyclic: Schema.optional(Schema.Boolean),
  rootId: Schema.optional(Schema.String),
  /** Timeline: phases in order; every step names one of them. */
  phases: Schema.optional(Schema.Array(Schema.String)),
  groups: Schema.optional(Schema.Array(DiagramGroup)),
  cards: Schema.optional(Schema.Array(DiagramCard)),
  views: Schema.optional(Schema.Array(DiagramView))
};

// --- Explanations ---------------------------------------------------------------

/**
 * Size limits of an explanation objective. The domain validator enforces them
 * and the tutor's skill quotes them.
 */
export const explainLimits = {
  keyPoints: { min: 3, max: 6 },
  prompt: { min: 20, max: 240 },
  label: { min: 8, max: 90 },
  expected: { min: 20, max: 320 },
  mustMention: { min: 1, max: 3, term: { max: 40 } },
  contradictions: { max: 3, term: { max: 80 } },
  pagesPerPoint: { min: 1, max: 4 },
  transcript: { min: 20, max: 4000 }
} as const;

// What the student sees of a key point before explaining: its title and the
// pages that explain it.
const explainKeyPointViewFields = {
  id: Schema.String,
  label: Schema.String,
  pages: Schema.Array(Schema.Number)
};

export const ExplainKeyPointView = Schema.Struct(explainKeyPointViewFields);
export type ExplainKeyPointView = typeof ExplainKeyPointView.Type;

/**
 * A key point with the hidden solution the grader compares against. It is
 * stored and shown to the tutor, never sent to the web before grading.
 * `mustMention` terms may list synonyms separated by `|` ("condensación|se condensa").
 * `contradictions` are phrases that reveal a wrong idea ("se evapora por el frío").
 */
export const ExplainKeyPoint = Schema.Struct({
  ...explainKeyPointViewFields,
  expected: Schema.String,
  mustMention: Schema.Array(Schema.String),
  contradictions: Schema.optional(Schema.Array(Schema.String))
});
export type ExplainKeyPoint = typeof ExplainKeyPoint.Type;

const explainFields = {
  /** What the student is asked to explain, in their own words. */
  prompt: Schema.String,
  keyPoints: Schema.Array(ExplainKeyPoint)
};

// --- Artifacts, by kind (the registry) ------------------------------------------

export const NoteArtifact = Schema.Struct({
  kind: Schema.Literal("note"),
  ...artifactBase,
  markdown: Schema.String
});
export type NoteArtifact = typeof NoteArtifact.Type;

export const QuizArtifact = Schema.Struct({
  kind: Schema.Literal("quiz"),
  ...artifactBase,
  questions: Schema.Array(QuizQuestion)
});
export type QuizArtifact = typeof QuizArtifact.Type;

export const TestArtifact = Schema.Struct({
  kind: Schema.Literal("test"),
  ...artifactBase,
  questions: Schema.Array(TestQuestion)
});
export type TestArtifact = typeof TestArtifact.Type;

export const DiagramArtifact = Schema.Struct({
  kind: Schema.Literal("diagram"),
  ...artifactBase,
  ...diagramFields
});
export type DiagramArtifact = typeof DiagramArtifact.Type;

export const ExplainArtifact = Schema.Struct({
  kind: Schema.Literal("explain"),
  ...artifactBase,
  ...explainFields
});
export type ExplainArtifact = typeof ExplainArtifact.Type;

/** The explanation objective as the web receives it: key points without their solution. */
export const ExplainArtifactView = Schema.Struct({
  kind: Schema.Literal("explain"),
  ...artifactBase,
  prompt: Schema.String,
  keyPoints: Schema.Array(ExplainKeyPointView)
});
export type ExplainArtifactView = typeof ExplainArtifactView.Type;

export const ArtifactByKind = {
  note: NoteArtifact,
  quiz: QuizArtifact,
  test: TestArtifact,
  diagram: DiagramArtifact,
  explain: ExplainArtifact
} as const;

export const artifactKinds = ["note", "quiz", "test", "diagram", "explain"] as const satisfies ReadonlyArray<keyof typeof ArtifactByKind>;
export type ArtifactKind = (typeof artifactKinds)[number];

export const ArtifactKind = Schema.Union([
  Schema.Literal("note"),
  Schema.Literal("quiz"),
  Schema.Literal("test"),
  Schema.Literal("diagram"),
  Schema.Literal("explain")
]);

export const Artifact = Schema.Union([
  ArtifactByKind.note,
  ArtifactByKind.quiz,
  ArtifactByKind.test,
  ArtifactByKind.diagram,
  ArtifactByKind.explain
]);
export type Artifact = typeof Artifact.Type;

/**
 * What `GET /artifacts/:id` returns: every artifact as stored, except the
 * explanation objective, whose solutions stay on the server.
 */
export const ArtifactView = Schema.Union([
  ArtifactByKind.note,
  ArtifactByKind.quiz,
  ArtifactByKind.test,
  ArtifactByKind.diagram,
  ExplainArtifactView
]);
export type ArtifactView = typeof ArtifactView.Type;

export const isArtifactKind = (value: unknown): value is ArtifactKind =>
  typeof value === "string" && (artifactKinds as ReadonlyArray<string>).includes(value);

export const ArtifactSummary = Schema.Struct({
  id: Schema.String,
  kind: ArtifactKind,
  title: Schema.String,
  source: Schema.optional(ArtifactSource),
  createdAt: Schema.optional(Schema.String),
  folderId: Schema.optional(Schema.String)
});
export type ArtifactSummary = typeof ArtifactSummary.Type;

export const ArtifactListResponse = Schema.Struct({
  artifacts: Schema.Array(ArtifactSummary)
});
export type ArtifactListResponse = typeof ArtifactListResponse.Type;

// --- Creation inputs (what the tutor sends through `artifacts create`) ---------

const createBase = {
  title: Schema.String,
  source: Schema.optional(ArtifactSource)
};

export const CreateNoteArtifactInput = Schema.Struct({
  kind: Schema.Literal("note"),
  ...createBase,
  markdown: Schema.String
});
export type CreateNoteArtifactInput = typeof CreateNoteArtifactInput.Type;

export const CreateQuizArtifactInput = Schema.Struct({
  kind: Schema.Literal("quiz"),
  ...createBase,
  questions: Schema.Array(QuizQuestion)
});
export type CreateQuizArtifactInput = typeof CreateQuizArtifactInput.Type;

export const CreateTestArtifactInput = Schema.Struct({
  kind: Schema.Literal("test"),
  ...createBase,
  questions: Schema.Array(TestQuestion)
});
export type CreateTestArtifactInput = typeof CreateTestArtifactInput.Type;

export const CreateDiagramArtifactInput = Schema.Struct({
  kind: Schema.Literal("diagram"),
  ...createBase,
  ...diagramFields
});
export type CreateDiagramArtifactInput = typeof CreateDiagramArtifactInput.Type;

export const CreateExplainArtifactInput = Schema.Struct({
  kind: Schema.Literal("explain"),
  ...createBase,
  ...explainFields
});
export type CreateExplainArtifactInput = typeof CreateExplainArtifactInput.Type;

export const CreateArtifactInputByKind = {
  note: CreateNoteArtifactInput,
  quiz: CreateQuizArtifactInput,
  test: CreateTestArtifactInput,
  diagram: CreateDiagramArtifactInput,
  explain: CreateExplainArtifactInput
} as const;

export const CreateArtifactInput = Schema.Union([
  CreateArtifactInputByKind.note,
  CreateArtifactInputByKind.quiz,
  CreateArtifactInputByKind.test,
  CreateArtifactInputByKind.diagram,
  CreateArtifactInputByKind.explain
]);
export type CreateArtifactInput = typeof CreateArtifactInput.Type;

export const ListArtifactsInput = Schema.Struct({
  kind: Schema.optional(ArtifactKind),
  folderId: Schema.optional(Schema.String)
});
export type ListArtifactsInput = typeof ListArtifactsInput.Type;

// --- Answers ----------------------------------------------------------------------

export const MultipleChoiceAnswer = Schema.Struct({
  questionType: Schema.Literal("multiple-choice"),
  questionId: Schema.String,
  selectedOptionId: Schema.String
});
export type MultipleChoiceAnswer = typeof MultipleChoiceAnswer.Type;

export const TrueFalseAnswer = Schema.Struct({
  questionType: Schema.Literal("true-false"),
  questionId: Schema.String,
  answer: Schema.Boolean
});
export type TrueFalseAnswer = typeof TrueFalseAnswer.Type;

export const ShortAnswerAnswer = Schema.Struct({
  questionType: Schema.Literal("short-answer"),
  questionId: Schema.String,
  answer: Schema.String
});
export type ShortAnswerAnswer = typeof ShortAnswerAnswer.Type;

export const QuizAnswer = Schema.Union([
  MultipleChoiceAnswer,
  TrueFalseAnswer
]);
export type QuizAnswer = typeof QuizAnswer.Type;

export const TestAnswer = Schema.Union([
  MultipleChoiceAnswer,
  TrueFalseAnswer,
  ShortAnswerAnswer
]);
export type TestAnswer = typeof TestAnswer.Type;

// --- Corrections --------------------------------------------------------------------

export const MultipleChoiceCorrection = Schema.Struct({
  questionType: Schema.Literal("multiple-choice"),
  questionId: Schema.String,
  correct: Schema.Boolean,
  selectedOptionId: Schema.String,
  correctOptionId: Schema.String,
  explanation: Schema.String
});
export type MultipleChoiceCorrection = typeof MultipleChoiceCorrection.Type;

export const TrueFalseCorrection = Schema.Struct({
  questionType: Schema.Literal("true-false"),
  questionId: Schema.String,
  correct: Schema.Boolean,
  answer: Schema.Boolean,
  correctAnswer: Schema.Boolean,
  explanation: Schema.String
});
export type TrueFalseCorrection = typeof TrueFalseCorrection.Type;

export const ShortAnswerCorrection = Schema.Struct({
  questionType: Schema.Literal("short-answer"),
  questionId: Schema.String,
  score: Schema.Number,
  maxScore: Schema.Number,
  feedback: Schema.String
});
export type ShortAnswerCorrection = typeof ShortAnswerCorrection.Type;

export const AutoQuestionCorrection = Schema.Union([
  MultipleChoiceCorrection,
  TrueFalseCorrection
]);
export type AutoQuestionCorrection = typeof AutoQuestionCorrection.Type;

export const QuestionCorrection = Schema.Union([
  MultipleChoiceCorrection,
  TrueFalseCorrection,
  ShortAnswerCorrection
]);
export type QuestionCorrection = typeof QuestionCorrection.Type;

// --- Attempts -------------------------------------------------------------------------

const attemptBase = {
  id: Schema.String,
  artifactId: Schema.String,
  createdAt: Schema.optional(Schema.String)
};

export const UngradedQuizAttempt = Schema.Struct({
  artifactKind: Schema.Literal("quiz"),
  status: Schema.Literal("ungraded"),
  ...attemptBase,
  answers: Schema.Array(QuizAnswer)
});
export type UngradedQuizAttempt = typeof UngradedQuizAttempt.Type;

export const GradedQuizAttempt = Schema.Struct({
  artifactKind: Schema.Literal("quiz"),
  status: Schema.Literal("graded"),
  ...attemptBase,
  answers: Schema.Array(QuizAnswer),
  score: Schema.Number,
  maxScore: Schema.Number,
  summary: Schema.String,
  corrections: Schema.Array(AutoQuestionCorrection)
});
export type GradedQuizAttempt = typeof GradedQuizAttempt.Type;

export const UngradedTestAttempt = Schema.Struct({
  artifactKind: Schema.Literal("test"),
  status: Schema.Literal("ungraded"),
  ...attemptBase,
  answers: Schema.Array(TestAnswer)
});
export type UngradedTestAttempt = typeof UngradedTestAttempt.Type;

export const GradedTestAttempt = Schema.Struct({
  artifactKind: Schema.Literal("test"),
  status: Schema.Literal("graded"),
  ...attemptBase,
  answers: Schema.Array(TestAnswer),
  score: Schema.Number,
  maxScore: Schema.Number,
  summary: Schema.String,
  corrections: Schema.Array(QuestionCorrection)
});
export type GradedTestAttempt = typeof GradedTestAttempt.Type;

// --- Explanation attempts ------------------------------------------------------------

/** How the explanation was entered. `voice` is a transcript; no audio is stored. */
export const ExplainInputMode = Schema.Union([
  Schema.Literal("voice"),
  Schema.Literal("text")
]);
export type ExplainInputMode = typeof ExplainInputMode.Type;

export const ExplainAnswer = Schema.Struct({
  transcript: Schema.String,
  inputMode: ExplainInputMode
});
export type ExplainAnswer = typeof ExplainAnswer.Type;

/**
 * How well one key point was explained: `covered` (every required idea is
 * there), `partial` (some), `missing` (none) or `wrong` (a contradiction was
 * found, which outweighs anything else).
 */
export const KeyPointStatus = Schema.Union([
  Schema.Literal("covered"),
  Schema.Literal("partial"),
  Schema.Literal("missing"),
  Schema.Literal("wrong")
]);
export type KeyPointStatus = typeof KeyPointStatus.Type;

/** A required idea found in the transcript, as a character range of the original text. */
export const KeyPointMatch = Schema.Struct({
  term: Schema.String,
  start: Schema.Number,
  end: Schema.Number
});
export type KeyPointMatch = typeof KeyPointMatch.Type;

export const KeyPointCorrection = Schema.Struct({
  keyPointId: Schema.String,
  status: KeyPointStatus,
  feedback: Schema.String,
  pages: Schema.Array(Schema.Number),
  matches: Schema.Array(KeyPointMatch),
  /** The reference explanation, revealed only when the point was not covered. */
  expected: Schema.optional(Schema.String)
});
export type KeyPointCorrection = typeof KeyPointCorrection.Type;

export const UngradedExplainAttempt = Schema.Struct({
  artifactKind: Schema.Literal("explain"),
  status: Schema.Literal("ungraded"),
  ...attemptBase,
  answer: ExplainAnswer
});
export type UngradedExplainAttempt = typeof UngradedExplainAttempt.Type;

export const GradedExplainAttempt = Schema.Struct({
  artifactKind: Schema.Literal("explain"),
  status: Schema.Literal("graded"),
  ...attemptBase,
  answer: ExplainAnswer,
  score: Schema.Number,
  maxScore: Schema.Number,
  summary: Schema.String,
  corrections: Schema.Array(KeyPointCorrection)
});
export type GradedExplainAttempt = typeof GradedExplainAttempt.Type;

export const ArtifactAttempt = Schema.Union([
  UngradedQuizAttempt,
  GradedQuizAttempt,
  UngradedTestAttempt,
  GradedTestAttempt,
  UngradedExplainAttempt,
  GradedExplainAttempt
]);
export type ArtifactAttempt = typeof ArtifactAttempt.Type;

export const ArtifactAttemptListResponse = Schema.Struct({
  attempts: Schema.Array(ArtifactAttempt)
});
export type ArtifactAttemptListResponse = typeof ArtifactAttemptListResponse.Type;

/**
 * Sample transcripts for the simulated dictation of the prototype, built from
 * the objective's solutions: one that covers every point, one that covers
 * about half, one that names the topic without any required idea.
 */
export const DictationSampleQuality = Schema.Union([
  Schema.Literal("good"),
  Schema.Literal("partial"),
  Schema.Literal("weak")
]);
export type DictationSampleQuality = typeof DictationSampleQuality.Type;

export const DictationSample = Schema.Struct({
  quality: DictationSampleQuality,
  transcript: Schema.String
});
export type DictationSample = typeof DictationSample.Type;

export const DictationSamplesResponse = Schema.Struct({
  samples: Schema.Array(DictationSample)
});
export type DictationSamplesResponse = typeof DictationSamplesResponse.Type;

export const SubmitQuizAttemptInput = Schema.Struct({
  artifactKind: Schema.Literal("quiz"),
  artifactId: Schema.String,
  answers: Schema.Array(QuizAnswer)
});
export type SubmitQuizAttemptInput = typeof SubmitQuizAttemptInput.Type;

export const SubmitTestAttemptInput = Schema.Struct({
  artifactKind: Schema.Literal("test"),
  artifactId: Schema.String,
  answers: Schema.Array(TestAnswer)
});
export type SubmitTestAttemptInput = typeof SubmitTestAttemptInput.Type;

export const SubmitExplainAttemptInput = Schema.Struct({
  artifactKind: Schema.Literal("explain"),
  artifactId: Schema.String,
  answer: ExplainAnswer
});
export type SubmitExplainAttemptInput = typeof SubmitExplainAttemptInput.Type;

export const SubmitAttemptInput = Schema.Union([
  SubmitQuizAttemptInput,
  SubmitTestAttemptInput,
  SubmitExplainAttemptInput
]);
export type SubmitAttemptInput = typeof SubmitAttemptInput.Type;
