import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  ArtifactView as Artifact,
  ArtifactAttempt,
  QuestionCorrection,
  QuizQuestion,
  SubmitAttemptInput,
  TestQuestion
} from "@proxus/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactQuery, submitArtifactAttemptAction } from "../domain/artifacts/atoms.ts";
import { pluralize } from "../lib/format.ts";
import { DiagramViewer, type PageSource } from "./DiagramViewer.tsx";
import { ExplainWorkspace } from "./ExplainWorkspace.tsx";
import { Icon, KindIcon, kindLabel } from "./icons.tsx";
import { ArtifactProvenance, PagePreview, ScoreSummary, TutoringHook, deservesTutoring, useMaterialAvailable, type TutoringOffer } from "./workspace-parts.tsx";

export type { TutoringOffer } from "./workspace-parts.tsx";

type Answers = Record<string, string>;

/** What the question sent to the tutor is about: a diagram node, or a quiz question / explanation key point. */
export interface AskTutorContext {
  readonly nodeId?: string;
  readonly questionId?: string;
}

interface ArtifactWorkspaceProps {
  readonly artifactId: string;
  readonly onClose: () => void;
  /** Sends a question about the open artifact (and optionally one of its parts) to the tutor chat. */
  readonly onAskTutor: (text: string, context?: AskTutorContext) => void;
  /** Tutoring of the folder's subject, when it names one; offered under a weak result. */
  readonly tutoring?: TutoringOffer | undefined;
}

export function ArtifactWorkspace({ artifactId, onClose, onAskTutor, tutoring }: ArtifactWorkspaceProps) {
  const artifact = useAtomValue(artifactQuery(artifactId));
  const refresh = useAtomRefresh(artifactQuery(artifactId));

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-lila-soft" aria-label="Panel de práctica">
      {AsyncResult.matchWithError(artifact, {
        onInitial: () => (
          <>
            <WorkspaceHeader title="Cargando…" onClose={onClose} />
            <div className="p-5 font-semibold text-ink-muted" aria-busy="true">Cargando el artefacto…</div>
          </>
        ),
        onError: (cause) => <WorkspaceError message={String(cause)} onClose={onClose} onRetry={refresh} />,
        onDefect: (cause) => <WorkspaceError message={String(cause)} onClose={onClose} onRetry={refresh} />,
        onSuccess: ({ value }) => (
          <>
            <WorkspaceHeader title={value.title} kind={value.kind} onClose={onClose} />
            {value.kind === "note"
              ? <NoteViewer key={value.id} artifact={value} />
              : value.kind === "diagram"
                ? <DiagramPanel key={value.id} artifact={value} onAskTutor={onAskTutor} />
                : value.kind === "explain"
                  ? <ExplainWorkspace key={value.id} artifact={value} onAskTutor={onAskTutor} tutoring={tutoring} />
                  : <ExerciseSolver key={value.id} artifact={value} onAskTutor={onAskTutor} tutoring={tutoring} />}
          </>
        )
      })}
    </section>
  );
}

function WorkspaceHeader({ title, kind, onClose }: { readonly title: string; readonly kind?: Artifact["kind"]; readonly onClose: () => void }) {
  return (
    <header className="flex h-[60px] items-center gap-2.5 border-ink border-b-2 bg-paper pr-3 pl-4">
      {kind !== undefined && <KindIcon kind={kind} size={30} />}
      <h2 className="min-w-0 flex-1 truncate font-display font-semibold text-base" title={title}>{title}</h2>
      <button className="icon-btn text-ink" type="button" onClick={onClose} aria-label="Cerrar panel de práctica">
        <Icon name="close" size={16} strokeWidth={2.2} />
      </button>
    </header>
  );
}

function WorkspaceError({ message, onClose, onRetry }: { readonly message: string; readonly onClose: () => void; readonly onRetry: () => void }) {
  return (
    <>
      <WorkspaceHeader title="No se pudo abrir" onClose={onClose} />
      <div className="p-5">
        <div className="flex flex-col gap-2 rounded-md border-2 border-rosa bg-rosa-soft p-3 text-rosa-ink text-sm" role="alert">
          <span className="font-semibold break-words">{message}</span>
          <button className="btn btn-secondary btn-sm self-start" type="button" onClick={onRetry}>Reintentar</button>
        </div>
      </div>
    </>
  );
}

function NoteViewer({ artifact }: { readonly artifact: Extract<Artifact, { readonly kind: "note" }> }) {
  return (
    <div className="min-h-0 overflow-y-auto p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2 font-bold text-ink-muted text-sm">
        <span className="badge badge-lila">{kindLabel.note}</span>
        <ArtifactProvenance artifact={artifact} />
      </div>
      <article className="card p-5">
        <h3 className="mb-3 font-display font-semibold text-xl leading-tight">{artifact.title}</h3>
        <div className="markdown">
          <Streamdown>{artifact.markdown}</Streamdown>
        </div>
      </article>
    </div>
  );
}

function DiagramPanel({ artifact, onAskTutor }: {
  readonly artifact: Extract<Artifact, { readonly kind: "diagram" }>;
  readonly onAskTutor: (text: string, context?: AskTutorContext) => void;
}) {
  const [preview, setPreview] = useState<{ readonly page: number; readonly source: PageSource } | undefined>();
  const [expanded, setExpanded] = useState(false);
  // A question for the tutor lives in the chat, so the full-screen view closes first.
  const ask = (text: string, context?: AskTutorContext) => {
    setExpanded(false);
    onAskTutor(text, context);
  };
  const materialId = artifact.source?.materialId;
  // Pages can be previewed while the source material still exists.
  const materialAvailable = useMaterialAvailable(materialId);
  const openPage = materialAvailable
    ? (page: number, source: PageSource) => setPreview((current) => current?.page === page && current.source.label === source.label ? undefined : { page, source })
    : undefined;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center gap-2 font-bold text-ink-muted text-sm">
        <span className="badge badge-lila">{kindLabel.diagram}</span>
        <ArtifactProvenance artifact={artifact} />
        <span>· {pluralize(artifact.nodes.length, "concepto", "conceptos")}</span>
      </div>
      <p className="font-semibold text-[15px] leading-snug">{artifact.summary}</p>
      <DiagramViewer
        artifact={artifact}
        onAskTutor={(text, nodeId) => ask(text, { nodeId })}
        onOpenPage={openPage}
        openPage={preview?.page}
        expanded={expanded}
        onExpandedChange={setExpanded}
        aside={preview !== undefined && materialId !== undefined
          ? (
              <PagePreview
                materialId={materialId}
                page={preview.page}
                label={preview.source.label}
                onClose={() => setPreview(undefined)}
                onAsk={() => ask(
                  `¿Qué dice la página ${preview.page} sobre «${preview.source.label}»?`,
                  preview.source.nodeId === undefined ? undefined : { nodeId: preview.source.nodeId }
                )}
              />
            )
          : undefined}
      />
    </div>
  );
}

function ExerciseSolver({ artifact, onAskTutor, tutoring }: {
  readonly artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }>;
  readonly onAskTutor: (text: string) => void;
  readonly tutoring: TutoringOffer | undefined;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [attempt, setAttempt] = useState<ArtifactAttempt | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitAttempt = useAtomSet(submitArtifactAttemptAction, { mode: "promise" });
  const scroller = useRef<HTMLDivElement>(null);
  const questionRefs = useRef(new Map<string, HTMLElement>());

  const unansweredQuestions = useMemo(
    () => artifact.questions.filter((question) => (answers[question.id] ?? "").trim().length === 0),
    [answers, artifact.questions]
  );
  const answered = artifact.questions.length - unansweredQuestions.length;
  const graded = attempt?.status === "graded" && attempt.artifactKind !== "explain" ? attempt : undefined;

  useEffect(() => {
    // Instant, not smooth: the result card is inserted at the same time and a
    // smooth scroll would be cancelled by the layout change.
    if (graded !== undefined) {
      scroller.current?.scrollTo({ top: 0 });
    }
  }, [graded]);

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const submit = async () => {
    if (isSubmitting) return;
    const first = unansweredQuestions[0];
    if (first !== undefined) {
      questionRefs.current.get(first.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    setIsSubmitting(true);
    setError(undefined);
    try {
      const result = await submitAttempt(buildSubmitInput(artifact, answers));
      setAttempt(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    setAnswers({});
    setAttempt(null);
    setError(undefined);
    scroller.current?.scrollTo({ top: 0 });
  };

  const failedIndexes = graded === undefined
    ? []
    : artifact.questions.flatMap((question, index) => {
        const correction = graded.corrections.find((item) => item.questionId === question.id);
        return correction !== undefined && !isCorrectionRight(correction) ? [index + 1] : [];
      });

  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div ref={scroller} className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {graded !== undefined && <AttemptSummary attempt={graded} failedIndexes={failedIndexes} onRetry={reset} />}
        {graded !== undefined && tutoring !== undefined && deservesTutoring(graded.score, graded.maxScore) && <TutoringHook offer={tutoring} topic={artifact.title} />}

        <div className="flex flex-wrap items-center gap-2 font-bold text-ink-muted text-sm">
          <span className="badge badge-lila">{kindLabel[artifact.kind]}</span>
          <ArtifactProvenance artifact={artifact} />
          {graded === undefined && <span>· {pluralize(artifact.questions.length, "pregunta", "preguntas")}</span>}
        </div>

        {artifact.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            ref={(node) => {
              if (node === null) questionRefs.current.delete(question.id);
              else questionRefs.current.set(question.id, node);
            }}
            index={index}
            total={artifact.questions.length}
            question={question}
            value={answers[question.id] ?? ""}
            correction={graded?.corrections.find((item) => item.questionId === question.id)}
            disabled={attempt !== null}
            onChange={(value) => setAnswer(question.id, value)}
          />
        ))}

        {error !== undefined && (
          <p className="rounded-md border-2 border-rosa bg-rosa-soft p-3 font-semibold text-rosa-ink text-sm" role="alert">{error}</p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-ink border-t-2 bg-paper px-5 py-3">
        {graded === undefined
          ? (
              <>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="font-bold text-ink-muted text-sm">
                    {answered === artifact.questions.length
                      ? "Todo respondido. ¡A corregir!"
                      : `${answered} de ${artifact.questions.length} respondidas`}
                  </span>
                  <div className="progress max-w-[220px]" aria-hidden="true">
                    <div style={{ width: `${artifact.questions.length === 0 ? 0 : (answered / artifact.questions.length) * 100}%` }} />
                  </div>
                </div>
                <button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={() => void submit()}>
                  {isSubmitting ? <><Icon name="spinner" size={16} /> Corrigiendo…</> : "Corregir"}
                </button>
              </>
            )
          : (
              <>
                <span className="font-bold text-ink-muted text-sm">Corregido hace un momento</span>
                <div className="flex flex-wrap gap-2">
                  {failedIndexes.length > 0 && (
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={() => onAskTutor(failedIndexes.length === 1
                        ? `Explícame la pregunta ${failedIndexes[0]} de «${artifact.title}»`
                        : `Explícame las preguntas ${listIndexes(failedIndexes)} de «${artifact.title}»`)}
                    >
                      <Icon name="spark" size={14} /> {failedIndexes.length === 1 ? `Explícame la pregunta ${failedIndexes[0]}` : "Explícame lo que he fallado"}
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" type="button" onClick={reset}>Repetir</button>
                </div>
              </>
            )}
      </footer>
    </div>
  );
}

const listIndexes = (indexes: ReadonlyArray<number>): string =>
  indexes.length <= 1 ? String(indexes[0] ?? "") : `${indexes.slice(0, -1).join(", ")} y ${indexes[indexes.length - 1]}`;

const isCorrectionRight = (correction: QuestionCorrection): boolean =>
  correction.questionType === "short-answer" ? correction.score >= correction.maxScore : correction.correct;

const questionTypeLabel: Record<QuizQuestion["type"] | TestQuestion["type"], string> = {
  "multiple-choice": "Opción múltiple",
  "true-false": "Verdadero o falso",
  "short-answer": "Respuesta corta"
};

function QuestionCard({ ref, index, total, question, value, correction, disabled, onChange }: {
  readonly ref: (node: HTMLElement | null) => void;
  readonly index: number;
  readonly total: number;
  readonly question: QuizQuestion | TestQuestion;
  readonly value: string;
  readonly correction: QuestionCorrection | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <section ref={ref} className="card flex flex-col gap-3 p-4" aria-label={`Pregunta ${index + 1} de ${total}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 font-extrabold text-lila-ink text-xs uppercase tracking-wider">
            Pregunta {index + 1} de {total} · {questionTypeLabel[question.type]}
          </p>
          <h3 className="font-extrabold text-[15px] leading-snug">{question.prompt}</h3>
        </div>
        {correction !== undefined && <CorrectionBadge correction={correction} />}
      </div>

      {question.type === "multiple-choice" && (
        <ChoiceList
          name={question.id}
          options={question.options.map((option) => ({ id: option.id, label: option.text }))}
          value={value}
          disabled={disabled}
          correctId={correction?.questionType === "multiple-choice" ? correction.correctOptionId : undefined}
          onChange={onChange}
        />
      )}
      {question.type === "true-false" && (
        <ChoiceList
          name={question.id}
          options={[{ id: "true", label: "Verdadero" }, { id: "false", label: "Falso" }]}
          value={value}
          disabled={disabled}
          correctId={correction?.questionType === "true-false" ? String(correction.correctAnswer) : undefined}
          onChange={onChange}
          columns
        />
      )}
      {question.type === "short-answer" && (
        <textarea
          className="min-h-28 w-full rounded-sm border-2 border-line bg-paper p-3 font-semibold outline-none focus:border-ink disabled:opacity-70"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Escribe tu respuesta…"
          aria-label={`Respuesta a la pregunta ${index + 1}`}
        />
      )}

      {correction !== undefined && <CorrectionDetails correction={correction} />}
    </section>
  );
}

/**
 * Radio-style options. After grading, the chosen and the correct ones are marked in place.
 * Clicking the selected option again clears the answer: a checked radio does not fire
 * `change`, so the toggle listens to `click`.
 */
function ChoiceList({ name, options, value, disabled, correctId, onChange, columns = false }: {
  readonly name: string;
  readonly options: ReadonlyArray<{ id: string; label: string }>;
  readonly value: string;
  readonly disabled: boolean;
  readonly correctId: string | undefined;
  readonly onChange: (value: string) => void;
  readonly columns?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${columns ? "grid-cols-2 max-sm:grid-cols-1" : ""}`} role="radiogroup">
      {options.map((option) => {
        const selected = value === option.id;
        const state = correctId === undefined
          ? (selected ? "option-selected" : "")
          : option.id === correctId
            ? "option-correct"
            : selected
              ? "option-wrong"
              : "";
        const tail = correctId === undefined
          ? undefined
          : selected
            ? "Tu respuesta"
            : option.id === correctId
              ? "Correcta"
              : undefined;
        return (
          <label
            key={option.id}
            className={`option ${state} ${disabled ? "option-disabled" : ""}`}
            title={selected && !disabled ? "Vuelve a pulsar para desmarcar" : undefined}
          >
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={option.id}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(option.id)}
              onClick={() => {
                if (selected && !disabled) onChange("");
              }}
            />
            <span className={`radio ${selected ? "radio-on" : ""}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">{option.label}</span>
            {tail !== undefined && (
              <span className={`ml-auto shrink-0 font-extrabold text-xs ${state === "option-wrong" ? "text-rosa-ink" : "text-mint-ink"}`}>{tail}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function AttemptSummary({ attempt, failedIndexes, onRetry }: {
  readonly attempt: Extract<ArtifactAttempt, { readonly status: "graded"; readonly artifactKind: "quiz" | "test" }>;
  readonly failedIndexes: ReadonlyArray<number>;
  readonly onRetry: () => void;
}) {
  const advice = failedIndexes.length === 0
    ? "Todo correcto. Si quieres, pídeme un test más difícil."
    : failedIndexes.length === 1
      ? `Has fallado la pregunta ${failedIndexes[0]}. Pídeme que te la explique.`
      : `Has fallado las preguntas ${listIndexes(failedIndexes)}. Pídeme que te las explique.`;

  return <ScoreSummary score={attempt.score} maxScore={attempt.maxScore} advice={advice} onRetry={onRetry} />;
}

function CorrectionBadge({ correction }: { readonly correction: QuestionCorrection }) {
  if (correction.questionType === "short-answer") {
    return <span className="badge badge-lila shrink-0">{correction.score}/{correction.maxScore}</span>;
  }
  return correction.correct
    ? <span className="badge badge-success sticker shrink-0"><Icon name="check" size={12} strokeWidth={3} /> Correcta</span>
    : <span className="badge badge-danger sticker shrink-0">Casi</span>;
}

function CorrectionDetails({ correction }: { readonly correction: QuestionCorrection }) {
  const text = correction.questionType === "short-answer" ? correction.feedback : correction.explanation;
  return (
    <p className="border-line border-t-2 border-dashed pt-2.5 font-semibold text-ink-muted text-sm">
      <strong className="text-ink">{correction.questionType === "short-answer" ? "Comentario: " : "Por qué: "}</strong>{text}
    </p>
  );
}

function buildSubmitInput(
  artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }>,
  answers: Answers
): SubmitAttemptInput {
  const builtAnswers = artifact.questions.map((question) => {
    const value = answers[question.id] ?? "";
    switch (question.type) {
      case "multiple-choice":
        return {
          questionType: "multiple-choice" as const,
          questionId: question.id,
          selectedOptionId: value
        };
      case "true-false":
        return {
          questionType: "true-false" as const,
          questionId: question.id,
          answer: value === "true"
        };
      case "short-answer":
        return {
          questionType: "short-answer" as const,
          questionId: question.id,
          answer: value
        };
    }
  });

  if (artifact.kind === "quiz") {
    return {
      artifactKind: "quiz",
      artifactId: artifact.id,
      answers: builtAnswers.filter((answer) => answer.questionType !== "short-answer")
    };
  }

  return {
    artifactKind: "test",
    artifactId: artifact.id,
    answers: builtAnswers
  };
}
