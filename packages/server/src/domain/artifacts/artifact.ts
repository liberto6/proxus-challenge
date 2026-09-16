import { Context, Data, Effect, Number as EffectNumber } from "effect";
import {
  type Artifact,
  type ArtifactAttempt,
  type ArtifactKind,
  type AutoQuestionCorrection,
  type CreateArtifactInput,
  type GradedQuizAttempt,
  type GradedTestAttempt,
  type ListArtifactsInput,
  type QuestionCorrection,
  type QuizAnswer,
  type QuizArtifact,
  type QuizQuestion,
  type SubmitAttemptInput,
  type TestAnswer,
  type TestArtifact,
  type TestQuestion,
  type UngradedQuizAttempt,
  type UngradedTestAttempt
} from "@proxus/shared";

/**
 * Artifact domain: ports, errors and behaviour (creation, grading).
 *
 * The schemas live in `@proxus/shared` (single source for server and web);
 * they are re-exported here so domain code and its callers keep one import.
 */
export {
  Artifact,
  ArtifactAttempt,
  ArtifactByKind,
  ArtifactKind,
  ArtifactSource,
  ArtifactSummary,
  AutoQuestionCorrection,
  CreateArtifactInput,
  CreateArtifactInputByKind,
  CreateNoteArtifactInput,
  CreateQuizArtifactInput,
  CreateTestArtifactInput,
  GradedQuizAttempt,
  GradedTestAttempt,
  ListArtifactsInput,
  MultipleChoiceAnswer,
  MultipleChoiceCorrection,
  MultipleChoiceQuestion,
  NoteArtifact,
  QuestionCorrection,
  QuestionOption,
  QuizAnswer,
  QuizArtifact,
  QuizQuestion,
  ShortAnswerAnswer,
  ShortAnswerCorrection,
  ShortAnswerQuestion,
  SubmitAttemptInput,
  SubmitQuizAttemptInput,
  SubmitTestAttemptInput,
  TestAnswer,
  TestArtifact,
  TestQuestion,
  TrueFalseAnswer,
  TrueFalseCorrection,
  TrueFalseQuestion,
  UngradedQuizAttempt,
  UngradedTestAttempt,
  artifactKinds,
  isArtifactKind
} from "@proxus/shared";

export class ArtifactNotFound extends Data.TaggedError("ArtifactNotFound")<{
  readonly artifactId: string;
}> {}

export class AttemptNotFound extends Data.TaggedError("AttemptNotFound")<{
  readonly attemptId: string;
}> {}

export class ArtifactTypeMismatch extends Data.TaggedError("ArtifactTypeMismatch")<{
  readonly artifactId: string;
  readonly expected: "quiz" | "test";
  readonly actual: ArtifactKind;
}> {}

export class QuestionNotFound extends Data.TaggedError("QuestionNotFound")<{
  readonly questionId: string;
}> {}

export class AnswerTypeMismatch extends Data.TaggedError("AnswerTypeMismatch")<{
  readonly questionId: string;
  readonly expected: string;
  readonly actual: string;
}> {}

export class ArtifactRepositoryStorageError extends Data.TaggedError("ArtifactRepositoryStorageError")<{
  readonly reason: unknown;
}> {}

export class ArtifactRepositorySerializationError extends Data.TaggedError("ArtifactRepositorySerializationError")<{
  readonly reason: unknown;
}> {}

export type ArtifactRepositoryError =
  | ArtifactNotFound
  | AttemptNotFound
  | ArtifactTypeMismatch
  | QuestionNotFound
  | AnswerTypeMismatch
  | ArtifactRepositoryStorageError
  | ArtifactRepositorySerializationError;

export interface ArtifactRepository {
  readonly createArtifact: (input: CreateArtifactInput) => Effect.Effect<Artifact, ArtifactRepositoryError>;
  readonly saveArtifact: (artifact: Artifact) => Effect.Effect<void, ArtifactRepositoryError>;
  readonly getArtifact: (id: string) => Effect.Effect<Artifact, ArtifactRepositoryError>;
  readonly listArtifacts: (input?: ListArtifactsInput) => Effect.Effect<readonly Artifact[], ArtifactRepositoryError>;
  readonly submitAttempt: (input: SubmitAttemptInput) => Effect.Effect<ArtifactAttempt, ArtifactRepositoryError>;
  readonly saveAttempt: (attempt: ArtifactAttempt) => Effect.Effect<void, ArtifactRepositoryError>;
  readonly getAttempt: (id: string) => Effect.Effect<ArtifactAttempt, ArtifactRepositoryError>;
  readonly listAttempts: (artifactId?: string) => Effect.Effect<readonly ArtifactAttempt[], ArtifactRepositoryError>;
  readonly gradeAttempt: (attemptId: string) => Effect.Effect<ArtifactAttempt, ArtifactRepositoryError>;
}

export const ArtifactRepository = Context.Service<ArtifactRepository>(
  "@proxus/server/artifacts/ArtifactRepository"
);

export const makeArtifact = (input: CreateArtifactInput): Artifact => {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  switch (input.kind) {
    case "note":
      return { ...input, id, createdAt };
    case "quiz":
      return { ...input, id, createdAt };
    case "test":
      return { ...input, id, createdAt };
  }
};

export const makeUngradedAttempt = (input: SubmitAttemptInput): ArtifactAttempt => {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  switch (input.artifactKind) {
    case "quiz":
      return { ...input, id, status: "ungraded", createdAt };
    case "test":
      return { ...input, id, status: "ungraded", createdAt };
  }
};

export const gradeAttempt = (
  artifact: Artifact,
  attempt: ArtifactAttempt
): Effect.Effect<ArtifactAttempt, ArtifactTypeMismatch | QuestionNotFound | AnswerTypeMismatch> => {
  if (attempt.status === "graded") {
    return Effect.succeed(attempt);
  }

  switch (attempt.artifactKind) {
    case "quiz":
      if (artifact.kind !== "quiz") {
        return Effect.fail(new ArtifactTypeMismatch({ artifactId: artifact.id, expected: "quiz", actual: artifact.kind }));
      }
      return gradeQuizAttempt(artifact, attempt);
    case "test":
      if (artifact.kind !== "test") {
        return Effect.fail(new ArtifactTypeMismatch({ artifactId: artifact.id, expected: "test", actual: artifact.kind }));
      }
      return gradeTestAttempt(artifact, attempt);
  }
};

const gradeQuizAttempt = (
  artifact: QuizArtifact,
  attempt: UngradedQuizAttempt
): Effect.Effect<GradedQuizAttempt, QuestionNotFound | AnswerTypeMismatch> => Effect.gen(function* () {
  const corrections: AutoQuestionCorrection[] = [];

  for (const answer of attempt.answers) {
    const question = yield* findQuestion(artifact.questions, answer.questionId);
    corrections.push(yield* correctAutoQuestion(question, answer));
  }

  const { score, maxScore } = scoreAutoCorrections(corrections);
  return {
    ...attempt,
    status: "graded" as const,
    score,
    maxScore,
    summary: `${score}/${maxScore} correct`,
    corrections
  };
});

const gradeTestAttempt = (
  artifact: TestArtifact,
  attempt: UngradedTestAttempt
): Effect.Effect<GradedTestAttempt, QuestionNotFound | AnswerTypeMismatch> => Effect.gen(function* () {
  const corrections: QuestionCorrection[] = [];

  for (const answer of attempt.answers) {
    const question = yield* findQuestion(artifact.questions, answer.questionId);
    corrections.push(yield* correctQuestion(question, answer));
  }

  const { score, maxScore } = scoreQuestionCorrections(corrections);
  return {
    ...attempt,
    status: "graded" as const,
    score,
    maxScore,
    summary: `${score}/${maxScore} points`,
    corrections
  };
});

const findQuestion = <Q extends QuizQuestion | TestQuestion>(
  questions: readonly Q[],
  questionId: string
): Effect.Effect<Q, QuestionNotFound> => {
  const question = questions.find((candidate) => candidate.id === questionId);
  return question === undefined
    ? Effect.fail(new QuestionNotFound({ questionId }))
    : Effect.succeed(question);
};

const correctAutoQuestion = (
  question: QuizQuestion,
  answer: QuizAnswer
): Effect.Effect<AutoQuestionCorrection, AnswerTypeMismatch> => {
  switch (question.type) {
    case "multiple-choice":
      if (answer.questionType !== "multiple-choice") {
        return Effect.fail(new AnswerTypeMismatch({ questionId: question.id, expected: question.type, actual: answer.questionType }));
      }
      return Effect.succeed({
        questionType: "multiple-choice" as const,
        questionId: question.id,
        correct: answer.selectedOptionId === question.correctOptionId,
        selectedOptionId: answer.selectedOptionId,
        correctOptionId: question.correctOptionId,
        explanation: question.explanation
      });
    case "true-false":
      if (answer.questionType !== "true-false") {
        return Effect.fail(new AnswerTypeMismatch({ questionId: question.id, expected: question.type, actual: answer.questionType }));
      }
      return Effect.succeed({
        questionType: "true-false" as const,
        questionId: question.id,
        correct: answer.answer === question.correctAnswer,
        answer: answer.answer,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation
      });
  }
};

const correctQuestion = (
  question: TestQuestion,
  answer: TestAnswer
): Effect.Effect<QuestionCorrection, AnswerTypeMismatch> => {
  if (question.type === "short-answer") {
    if (answer.questionType !== "short-answer") {
      return Effect.fail(new AnswerTypeMismatch({ questionId: question.id, expected: question.type, actual: answer.questionType }));
    }

    const correct = normalizeAnswer(answer.answer) === normalizeAnswer(question.expectedAnswer);
    return Effect.succeed({
      questionType: "short-answer" as const,
      questionId: question.id,
      score: correct ? question.maxScore : 0,
      maxScore: question.maxScore,
      feedback: correct
        ? "Answer matches the expected answer."
        : `Expected: ${question.expectedAnswer}`
    });
  }

  return correctAutoQuestion(question, answer as QuizAnswer);
};

const normalizeAnswer = (answer: string) => answer.trim().toLocaleLowerCase();

export const scoreAutoCorrections = (corrections: readonly AutoQuestionCorrection[]) => ({
  score: EffectNumber.sumAll(corrections.map((correction) => correction.correct ? 1 : 0)),
  maxScore: corrections.length
});

export const scoreQuestionCorrections = (corrections: readonly QuestionCorrection[]) => {
  const score = EffectNumber.sumAll(corrections.map((correction) => {
    switch (correction.questionType) {
      case "multiple-choice":
      case "true-false":
        return correction.correct ? 1 : 0;
      case "short-answer":
        return correction.score;
    }
  }));

  const maxScore = EffectNumber.sumAll(corrections.map((correction) => {
    switch (correction.questionType) {
      case "multiple-choice":
      case "true-false":
        return 1;
      case "short-answer":
        return correction.maxScore;
    }
  }));

  return {
    score: EffectNumber.clamp(score, { minimum: 0, maximum: maxScore }),
    maxScore
  };
};
