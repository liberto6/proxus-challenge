import { Data, Effect, Schema } from "effect";
import * as AgentCli from "../harness/index.ts";
import { renderedPagesOf } from "../harness/grounding.ts";
import type { MaterialRepository } from "../../materials/material.ts";
import { normalizeDiagramInput, renderDiagramIssues, validateDiagram } from "../../artifacts/diagram.ts";
import {
  Artifact,
  ArtifactAttempt,
  ArtifactNotFound,
  ArtifactRepositoryStorageError,
  ArtifactRepositorySerializationError,
  ArtifactTypeMismatch,
  AttemptNotFound,
  CreateArtifactInput,
  QuestionNotFound,
  AnswerTypeMismatch,
  SubmitAttemptInput,
  artifactKinds,
  type ArtifactRepository
} from "../../artifacts/artifact.ts";

const UnknownFromJson = Schema.fromJsonString(Schema.Unknown);
const SubmitAttemptInputFromJson = Schema.fromJsonString(SubmitAttemptInput);

const renderArtifact = (artifact: Artifact) => JSON.stringify(artifact, null, 2);
const renderCreatedArtifact = (artifact: Artifact) => JSON.stringify({
  created: true,
  id: artifact.id,
  kind: artifact.kind,
  title: artifact.title,
  ...createdArtifactSize(artifact),
  note: "The student can open it from the panel. Do not repeat its content in the chat."
}, null, 2);

const createdArtifactSize = (artifact: Artifact) => {
  switch (artifact.kind) {
    case "note":
      return {};
    case "quiz":
    case "test":
      return { questionCount: artifact.questions.length };
    case "diagram":
      return { diagramType: artifact.diagramType, nodeCount: artifact.nodes.length, edgeCount: artifact.edges.length };
  }
};
const renderAttempt = (attempt: ArtifactAttempt) => JSON.stringify(attempt, null, 2);

const renderArtifactError = (error: ArtifactNotFound | AttemptNotFound | ArtifactTypeMismatch | QuestionNotFound | AnswerTypeMismatch | ArtifactRepositoryStorageError | ArtifactRepositorySerializationError) => {
  switch (error._tag) {
    case "ArtifactNotFound":
      return `Artifact not found: ${error.artifactId}`;
    case "AttemptNotFound":
      return `Attempt not found: ${error.attemptId}`;
    case "ArtifactTypeMismatch":
      return `Artifact ${error.artifactId} has kind ${error.actual}; expected ${error.expected}`;
    case "QuestionNotFound":
      return `Question not found: ${error.questionId}`;
    case "AnswerTypeMismatch":
      return `Answer type mismatch for question ${error.questionId}: expected ${error.expected}, got ${error.actual}`;
    case "ArtifactRepositoryStorageError":
      return `Artifact repository storage error: ${String(error.reason)}`;
    case "ArtifactRepositorySerializationError":
      return renderSerializationError(error.reason);
  }
};

const renderSerializationError = (reason: unknown) => {
  const message = String(reason);
  const multipleChoiceHint = message.includes("options")
    ? "\n\nFor multiple-choice questions, options must be objects, not strings: [{\"id\":\"a\",\"text\":\"Option A\"}]. The correctOptionId must match one option id."
    : "";

  return `Invalid artifact/attempt JSON: ${message}${multipleChoiceHint}\n\nUse artifacts create --help or artifacts submit --help for examples.`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const optionId = (text: string) => text
  .trim()
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "option";

const normalizeMultipleChoiceQuestion = (question: Record<string, unknown>) => {
  const options = Array.isArray(question.options)
    ? question.options.map((option) => typeof option === "string"
        ? { id: optionId(option), text: option }
        : option)
    : question.options;

  const correctOptionId = typeof question.correctOptionId === "string" && Array.isArray(options)
    ? options.find((option) => isRecord(option) && option.text === question.correctOptionId) !== undefined
      ? optionId(question.correctOptionId)
      : question.correctOptionId
    : question.correctOptionId;

  return {
    ...question,
    options,
    correctOptionId
  };
};

const normalizeQuestion = (question: unknown) =>
  isRecord(question) && question.type === "multiple-choice"
    ? normalizeMultipleChoiceQuestion(question)
    : question;

const normalizeCreateArtifactInput = (input: unknown) => {
  if (!isRecord(input) || !Array.isArray(input.questions)) {
    return normalizeDiagramInput(input);
  }

  return {
    ...input,
    questions: input.questions.map(normalizeQuestion)
  };
};

const decodeCreateArtifactInput = (json: string) =>
  Schema.decodeUnknownEffect(UnknownFromJson)(json).pipe(
    Effect.map(normalizeCreateArtifactInput),
    Effect.flatMap(Schema.decodeUnknownEffect(CreateArtifactInput)),
    Effect.mapError((reason) => new ArtifactRepositorySerializationError({ reason }))
  );

/** A diagram the model must fix before it is persisted; the text goes back to the model as the tool result. */
class DiagramRejected extends Data.TaggedError("DiagramRejected")<{
  readonly report: string;
}> {}

/**
 * Diagrams are checked against the material (page range) and the pages read in
 * this conversation, so a node can only cite what the tutor has actually seen.
 */
const checkDiagram = (input: CreateArtifactInput, materials: MaterialRepository): Effect.Effect<CreateArtifactInput, DiagramRejected> =>
  Effect.gen(function* () {
    if (input.kind !== "diagram") {
      return input;
    }

    const materialId = input.source?.materialId;
    const pageCount = materialId === undefined
      ? undefined
      : yield* materials.get(materialId).pipe(
          Effect.map((material) => material.pageCount),
          Effect.catch(() => Effect.succeed(undefined))
        );
    if (materialId !== undefined && pageCount === undefined) {
      return yield* new DiagramRejected({
        report: renderDiagramIssues([{
          code: "source-required",
          message: `Material "${materialId}" does not exist. Use the id from \`materials list\`.`
        }])
      });
    }

    const renderedPages = materialId === undefined ? undefined : yield* renderedPagesOf(materialId);
    const issues = validateDiagram(input, { pageCount, renderedPages });
    if (issues.length > 0) {
      return yield* new DiagramRejected({ report: renderDiagramIssues(issues) });
    }
    return input;
  });

const decodeSubmitAttemptInput = (json: string) =>
  Schema.decodeUnknownEffect(SubmitAttemptInputFromJson)(json).pipe(
    Effect.mapError((reason) => new ArtifactRepositorySerializationError({ reason }))
  );

export const makeArtifactCommands = (repository: ArtifactRepository, materials: MaterialRepository) => {
  const list = AgentCli.Command.withExamples([
    { command: "artifacts list", description: "List all saved artifacts" },
    { command: "artifacts list quiz", description: "List quiz artifacts only" },
    { command: "artifacts list diagram", description: "List diagram artifacts only" }
  ])(
    AgentCli.Command.withDescription("List saved artifacts")(
      AgentCli.Command.exec("list", {
        kind: AgentCli.Argument.optionalChoice("kind", artifactKinds).pipe(
          AgentCli.Argument.withDescription("Optional artifact kind filter")
        )
      }, ({ kind }) =>
        repository.listArtifacts(kind === undefined ? {} : { kind }).pipe(
          Effect.map((artifacts) => artifacts.length === 0
            ? "No artifacts found."
            : artifacts.map((artifact) => `- ${artifact.id}: ${artifact.title} (${artifact.kind})`).join("\n")
          ),
          Effect.catch((error) => Effect.succeed(renderArtifactError(error)))
        )
      )
    )
  );

  const show = AgentCli.Command.withExamples([
    { command: "artifacts show abc123", description: "Show an artifact as JSON" }
  ])(
    AgentCli.Command.withDescription("Show a saved artifact")(
      AgentCli.Command.exec("show", {
        artifactId: AgentCli.Argument.string("artifactId")
      }, ({ artifactId }) =>
        repository.getArtifact(artifactId).pipe(
          Effect.map(renderArtifact),
          Effect.catch((error) => Effect.succeed(renderArtifactError(error)))
        )
      )
    )
  );

  const create = AgentCli.Command.withExamples([
    {
      command: `artifacts create '{"kind":"note","title":"Derivatives summary","markdown":"# Derivatives\\n..."}'`,
      description: "Create a note artifact"
    },
    {
      command: `artifacts create '{"kind":"quiz","title":"Basics quiz","questions":[{"type":"true-false","id":"q1","prompt":"2+2=4","correctAnswer":true,"explanation":"Basic arithmetic."}]}'`,
      description: "Create a quiz artifact"
    }
  ])(
    AgentCli.Command.withDescription("Create a note, quiz, test, or diagram artifact from JSON")(
      AgentCli.Command.exec("create", {
        json: AgentCli.Argument.string("json").pipe(
          AgentCli.Argument.withDescription("CreateArtifactInput JSON")
        )
      }, ({ json }) =>
        decodeCreateArtifactInput(json).pipe(
          Effect.flatMap((input) => checkDiagram(input, materials)),
          Effect.flatMap((input) => repository.createArtifact(input)),
          // A compact confirmation: the model already knows the content it sent,
          // and echoing it back invites repeating it to the student.
          Effect.map(renderCreatedArtifact),
          Effect.catch((error) => Effect.succeed(error._tag === "DiagramRejected" ? error.report : renderArtifactError(error)))
        )
      )
    )
  );

  const submit = AgentCli.Command.withExamples([
    {
      command: `artifacts submit '{"artifactKind":"quiz","artifactId":"abc123","answers":[{"questionType":"true-false","questionId":"q1","answer":true}]}'`,
      description: "Submit answers for a quiz or test"
    }
  ])(
    AgentCli.Command.withDescription("Submit an ungraded attempt for a quiz or test")(
      AgentCli.Command.exec("submit", {
        json: AgentCli.Argument.string("json").pipe(
          AgentCli.Argument.withDescription("SubmitAttemptInput JSON")
        )
      }, ({ json }) =>
        decodeSubmitAttemptInput(json).pipe(
          Effect.andThen((input) => repository.submitAttempt(input)),
          Effect.map(renderAttempt),
          Effect.catch((error) => Effect.succeed(renderArtifactError(error)))
        )
      )
    )
  );

  const attempts = AgentCli.Command.withExamples([
    { command: "artifacts attempts", description: "List all attempts" },
    { command: "artifacts attempts abc123", description: "List attempts for one artifact" }
  ])(
    AgentCli.Command.withDescription("List artifact attempts")(
      AgentCli.Command.exec("attempts", {
        artifactId: AgentCli.Argument.optionalString("artifactId").pipe(
          AgentCli.Argument.withDescription("Optional artifact id filter")
        )
      }, ({ artifactId }) =>
        repository.listAttempts(artifactId).pipe(
          Effect.map((attempts) => attempts.length === 0
            ? "No attempts found."
            : attempts.map((attempt) => `- ${attempt.id}: ${attempt.artifactKind} ${attempt.status} for ${attempt.artifactId}`).join("\n")
          ),
          Effect.catch((error) => Effect.succeed(renderArtifactError(error)))
        )
      )
    )
  );

  const grade = AgentCli.Command.withExamples([
    { command: "artifacts grade attempt123", description: "Grade a quiz/test attempt and persist the graded attempt" }
  ])(
    AgentCli.Command.withDescription("Grade an ungraded quiz/test attempt")(
      AgentCli.Command.exec("grade", {
        attemptId: AgentCli.Argument.string("attemptId")
      }, ({ attemptId }) =>
        repository.gradeAttempt(attemptId).pipe(
          Effect.map(renderAttempt),
          Effect.catch((error) => Effect.succeed(renderArtifactError(error)))
        )
      )
    )
  );

  return AgentCli.Command.group("artifacts", [list, show, create, submit, attempts, grade] as const).pipe(
    AgentCli.Command.withDescription("Study artifacts: notes, quizzes, tests, diagrams, and attempts")
  );
};
