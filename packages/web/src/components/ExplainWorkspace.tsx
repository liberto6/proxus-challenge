import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  ArtifactAttempt,
  DictationSampleQuality,
  ExplainArtifactView,
  ExplainInputMode,
  GradedExplainAttempt,
  KeyPointCorrection,
  KeyPointStatus
} from "@proxus/shared";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect, useMemo, useRef, useState } from "react";
import { artifactAttemptsQuery, dictationSamplesQuery, submitArtifactAttemptAction } from "../domain/artifacts/atoms.ts";
import { countWords, segmentTranscript } from "../domain/explain/highlight.ts";
import { configuredDictationSource, speechRecognitionSupported, type Dictation } from "../domain/explain/dictation.ts";
import { useSimulatedDictation } from "../domain/explain/simulated-dictation.ts";
import { useSpeechDictation } from "../domain/explain/speech-dictation.ts";
import { formatPages, pluralize } from "../lib/format.ts";
import type { AskTutorContext } from "./ArtifactWorkspace.tsx";
import { Icon, kindLabel } from "./icons.tsx";
import { ArtifactProvenance, PagePreview, ScoreSummary, TutoringHook, deservesTutoring, formatScore, useMaterialAvailable, type TutoringOffer } from "./workspace-parts.tsx";

/**
 * The explanation objective: the student explains the topic in their own words
 * (simulated dictation or text) and gets a correction per key point. Before
 * explaining they see only the titles of the points; after grading, the
 * status of each one, the words that activated it and, when it was not
 * covered, the reference.
 */

const minTranscriptLength = 20;

const qualityLabel: Record<DictationSampleQuality, string> = { good: "buena", partial: "a medias", weak: "floja" };

const statusLabel: Record<KeyPointStatus, string> = { covered: "Cubierto", partial: "A medias", missing: "Falta", wrong: "Incorrecto" };
const statusBadge: Record<KeyPointStatus, string> = { covered: "badge-success sticker", partial: "badge-sun", missing: "badge-neutral", wrong: "badge-danger sticker" };
const statusMark: Record<KeyPointStatus, string> = { covered: "mark-covered", partial: "mark-partial", missing: "", wrong: "mark-wrong" };

const isGradedExplain = (attempt: ArtifactAttempt): attempt is GradedExplainAttempt =>
  attempt.artifactKind === "explain" && attempt.status === "graded";

/**
 * Both sources are always mounted (hooks cannot be conditional); the panel
 * talks to the configured one. `browser` needs a browser that recognises
 * speech; otherwise the microphone explains why and the textarea remains.
 */
const useDictation = (onTranscript: (transcript: string) => void): { readonly source: "browser" | "simulated"; readonly dictation: Dictation } => {
  const simulated = useSimulatedDictation(onTranscript);
  const speech = useSpeechDictation(onTranscript);
  const source = configuredDictationSource();
  return { source, dictation: source === "browser" ? speech : simulated };
};

export function ExplainWorkspace({ artifact, onAskTutor, tutoring }: {
  readonly artifact: ExplainArtifactView;
  readonly onAskTutor: (text: string, context?: AskTutorContext) => void;
  readonly tutoring?: TutoringOffer | undefined;
}) {
  const [transcript, setTranscript] = useState("");
  const [inputMode, setInputMode] = useState<ExplainInputMode>("text");
  const [quality, setQuality] = useState<DictationSampleQuality>("good");
  const [attempt, setAttempt] = useState<GradedExplainAttempt | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ readonly page: number; readonly keyPointId: string } | undefined>();
  const submitAttempt = useAtomSet(submitArtifactAttemptAction, { mode: "promise" });
  const samples = useAtomValue(dictationSamplesQuery(artifact.id));
  const attempts = useAtomValue(artifactAttemptsQuery(artifact.id));
  const scroller = useRef<HTMLDivElement>(null);
  const { source, dictation } = useDictation(setTranscript);
  const simulated = source === "simulated";
  const micAvailable = simulated || speechRecognitionSupported();

  const materialId = artifact.source?.materialId;
  const materialAvailable = useMaterialAvailable(materialId);
  const recording = dictation.status === "recording";
  const words = countWords(transcript);
  const canSubmit = !recording && !isSubmitting && transcript.trim().length >= minTranscriptLength;

  // The most recent graded attempt before this one, for "Antes: 2/4".
  const previous = useMemo(() => {
    if (!AsyncResult.isSuccess(attempts)) return undefined;
    return attempts.value.attempts
      .filter(isGradedExplain)
      .filter((item) => item.id !== attempt?.id)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .at(0);
  }, [attempts, attempt?.id]);

  useEffect(() => {
    if (attempt !== null) scroller.current?.scrollTo({ top: 0 });
  }, [attempt]);

  const record = () => {
    if (recording) {
      dictation.stop();
      return;
    }
    setError(undefined);
    if (!simulated) {
      setInputMode("voice");
      dictation.start();
      return;
    }
    const sample = AsyncResult.isSuccess(samples) ? samples.value.samples.find((item) => item.quality === quality) : undefined;
    if (sample === undefined) return;
    setInputMode("voice");
    dictation.start(sample.transcript);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(undefined);
    try {
      const result = await submitAttempt({ artifactKind: "explain", artifactId: artifact.id, answer: { transcript: transcript.trim(), inputMode } });
      if (isGradedExplain(result)) setAttempt(result);
      else setError("La corrección no ha devuelto un resultado válido.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const reset = () => {
    dictation.stop();
    setTranscript("");
    setInputMode("text");
    setAttempt(null);
    setError(undefined);
    setPreview(undefined);
    scroller.current?.scrollTo({ top: 0 });
  };

  const correctionOf = (keyPointId: string): KeyPointCorrection | undefined =>
    attempt?.corrections.find((correction) => correction.keyPointId === keyPointId);
  const uncovered = artifact.keyPoints.filter((point) => {
    const correction = correctionOf(point.id);
    return correction !== undefined && correction.status !== "covered";
  });
  const indexOf = (keyPointId: string) => artifact.keyPoints.findIndex((point) => point.id === keyPointId) + 1;

  const askAboutPoint = (keyPointId: string) => {
    const point = artifact.keyPoints.find((candidate) => candidate.id === keyPointId);
    const correction = correctionOf(keyPointId);
    if (point === undefined) return;
    const text = correction === undefined || correction.status === "covered"
      ? `Explícame el punto ${indexOf(keyPointId)} («${point.label}») de «${artifact.title}»`
      : `¿Por qué el punto ${indexOf(keyPointId)} («${point.label}») está ${statusLabel[correction.status].toLocaleLowerCase()}? ¿Cómo debería explicarlo?`;
    onAskTutor(text, { questionId: keyPointId });
  };

  const askAboutMissing = () => {
    const numbers = uncovered.map((point) => indexOf(point.id));
    onAskTutor(
      numbers.length === 1
        ? `Explícame lo que me falta en el punto ${numbers[0]} de «${artifact.title}»`
        : `Explícame lo que me falta en los puntos ${numbers.slice(0, -1).join(", ")} y ${numbers.at(-1)} de «${artifact.title}»`,
      uncovered.length === 1 ? { questionId: uncovered[0]!.id } : undefined
    );
  };

  const advice = attempt === null
    ? ""
    : uncovered.length === 0
      ? "Lo has explicado entero. Pídeme otro tema o repítelo sin mirar los puntos."
      : uncovered.length === 1
        ? `Te falta afinar el punto ${indexOf(uncovered[0]!.id)}. Pregúntame por él.`
        : `Te faltan ${uncovered.length} puntos. Abajo tienes qué esperaba en cada uno.`;

  return (
    <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div ref={scroller} className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        {attempt !== null && (
          <ScoreSummary
            score={attempt.score}
            maxScore={attempt.maxScore}
            advice={advice}
            previous={previous?.score}
            onRetry={reset}
          />
        )}
        {attempt !== null && tutoring !== undefined && deservesTutoring(attempt.score, attempt.maxScore) && <TutoringHook offer={tutoring} topic={artifact.title} />}

        <div className="flex flex-wrap items-center gap-2 font-bold text-ink-muted text-sm">
          <span className="badge badge-lila">{kindLabel.explain}</span>
          <ArtifactProvenance artifact={artifact} />
          <span>· {pluralize(artifact.keyPoints.length, "punto clave", "puntos clave")}</span>
        </div>

        <section className="card flex flex-col gap-3 p-4" aria-label="Puntos clave">
          <h3 className="font-display font-semibold text-xl leading-tight">{artifact.prompt}</h3>
          <p className="font-semibold text-ink-muted text-sm">
            {attempt === null ? "Asegúrate de tocar estos puntos:" : "Cómo ha ido cada punto:"}
          </p>
          <ol className="flex flex-col gap-2.5">
            {artifact.keyPoints.map((point, index) => (
              <KeyPointRow
                key={point.id}
                index={index + 1}
                label={point.label}
                pages={point.pages}
                correction={correctionOf(point.id)}
                previewOpen={preview?.keyPointId === point.id ? preview.page : undefined}
                onOpenPage={materialAvailable
                  ? (page) => setPreview((current) => current?.keyPointId === point.id && current.page === page ? undefined : { page, keyPointId: point.id })
                  : undefined}
                onAsk={() => askAboutPoint(point.id)}
              />
            ))}
          </ol>
          {preview !== undefined && materialId !== undefined && (
            <PagePreview
              materialId={materialId}
              page={preview.page}
              label={artifact.keyPoints.find((point) => point.id === preview.keyPointId)?.label ?? ""}
              onClose={() => setPreview(undefined)}
              onAsk={() => onAskTutor(`¿Qué dice la página ${preview.page} sobre «${artifact.keyPoints.find((point) => point.id === preview.keyPointId)?.label ?? ""}»?`, { questionId: preview.keyPointId })}
            />
          )}
        </section>

        <section className="card flex flex-col gap-3 p-4" aria-label="Tu explicación">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-semibold text-lg leading-tight">Tu explicación</h3>
            {recording && (
              <span className="flex items-center gap-2 font-bold text-rosa-ink text-sm" aria-live="polite">
                <span className="wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                {simulated ? "Grabando" : "Escuchando"} · {formatSeconds(dictation.seconds)}
              </span>
            )}
            {!recording && dictation.status === "stopped" && attempt === null && (
              <span className="font-semibold text-ink-subtle text-xs">{simulated ? "Dictado simulado" : "Dictado"} · {formatSeconds(dictation.seconds)} · puedes corregir el texto</span>
            )}
          </div>

          {attempt === null
            ? (
                <textarea
                  className="min-h-36 w-full rounded-sm border-2 border-line bg-paper p-3 font-semibold leading-relaxed outline-none focus:border-ink disabled:opacity-70"
                  value={transcript}
                  readOnly={recording}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    setTranscript(event.currentTarget.value);
                    if (dictation.status === "idle") setInputMode("text");
                  }}
                  placeholder="Pulsa el micro y explícalo como se lo contarías a un compañero. También puedes escribirlo aquí."
                  aria-label="Tu explicación"
                />
              )
            : (
                <p className="rounded-sm border-2 border-line bg-surface-2 p-3 font-semibold leading-relaxed">
                  {segmentTranscript(attempt.answer.transcript, attempt.corrections).map((segment, index) =>
                    segment.status === undefined
                      ? <span key={index}>{segment.text}</span>
                      : (
                          <mark
                            key={index}
                            className={statusMark[segment.status]}
                            title={`Punto ${indexOf(segment.keyPointId ?? "")}: ${statusLabel[segment.status]}`}
                          >
                            {segment.text}
                          </mark>
                        )
                  )}
                </p>
              )}

          {attempt === null && dictation.status === "failed" && dictation.reason !== undefined && (
            <p className="rounded-md border-2 border-rosa bg-rosa-soft p-2.5 font-semibold text-rosa-ink text-sm" role="alert">{dictation.reason}</p>
          )}
          {attempt === null && (
            <p className="font-semibold text-ink-subtle text-xs">
              {simulated
                ? "Prototipo: el micro dicta un texto de muestra en lugar de reconocer tu voz. Elige la calidad de la muestra para ver cómo corrige."
                : micAvailable
                  ? "El reconocimiento de voz lo hace tu navegador (en Chrome y Edge, el audio pasa por el servicio de Google). No se guarda ningún audio, solo el texto."
                  : "Este navegador no reconoce voz (Chrome, Edge o Safari sí). Escribe tu explicación."}
            </p>
          )}
        </section>

        {error !== undefined && (
          <p className="rounded-md border-2 border-rosa bg-rosa-soft p-3 font-semibold text-rosa-ink text-sm" role="alert">{error}</p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-ink border-t-2 bg-paper px-5 py-3">
        {attempt === null
          ? (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <span className="font-bold text-ink-muted text-sm">
                    {words === 0 ? "Sin explicación todavía" : transcript.trim().length < minTranscriptLength ? "Un poco más…" : pluralize(words, "palabra", "palabras")}
                  </span>
                  {simulated && (
                    <div className="segmented" role="radiogroup" aria-label="Calidad de la muestra dictada">
                      {(["good", "partial", "weak"] as const).map((item) => (
                        <button
                          key={item}
                          type="button"
                          role="radio"
                          aria-checked={quality === item}
                          className={quality === item ? "segmented-on" : ""}
                          disabled={recording}
                          onClick={() => setQuality(item)}
                        >
                          {qualityLabel[item]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                  <button
                    className={`btn ${recording ? "btn-danger" : "btn-secondary"} max-sm:flex-1`}
                    type="button"
                    disabled={isSubmitting || !micAvailable || (simulated && !recording && !AsyncResult.isSuccess(samples))}
                    onClick={record}
                    aria-pressed={recording}
                    title={micAvailable ? undefined : "Este navegador no reconoce voz"}
                  >
                    <Icon name={recording ? "stop" : "mic"} size={16} /> {recording ? "Parar" : "Grabar"}
                  </button>
                  <button className="btn btn-primary max-sm:flex-1" type="button" disabled={!canSubmit} onClick={() => void submit()}>
                    {isSubmitting ? <><Icon name="spinner" size={16} /> Corrigiendo…</> : "Corregir"}
                  </button>
                </div>
              </>
            )
          : (
              <>
                <span className="font-bold text-ink-muted text-sm">
                  Corregido hace un momento · {formatScore(attempt.score)}/{attempt.maxScore}
                </span>
                <div className="flex flex-wrap gap-2">
                  {uncovered.length > 0 && (
                    <button className="btn btn-secondary btn-sm" type="button" onClick={askAboutMissing}>
                      <Icon name="spark" size={14} /> {uncovered.length === 1 ? `Explícame el punto ${indexOf(uncovered[0]!.id)}` : "Explícame lo que me falta"}
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

/** One key point: its title before grading; its status, feedback, reference and actions after. */
function KeyPointRow({ index, label, pages, correction, previewOpen, onOpenPage, onAsk }: {
  readonly index: number;
  readonly label: string;
  readonly pages: ReadonlyArray<number>;
  readonly correction: KeyPointCorrection | undefined;
  readonly previewOpen: number | undefined;
  readonly onOpenPage: ((page: number) => void) | undefined;
  readonly onAsk: () => void;
}) {
  const pagesText = formatPages(pages);
  return (
    <li className={`flex flex-col gap-1.5 rounded-md border-2 p-3 ${correction === undefined ? "border-line" : correction.status === "covered" ? "border-mint bg-mint-soft/40" : correction.status === "partial" ? "border-sun bg-sun-soft/40" : correction.status === "wrong" ? "border-rosa bg-rosa-soft/40" : "border-line bg-surface-3/60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper font-extrabold text-xs" aria-hidden="true">{index}</span>
          <div className="min-w-0">
            <p className="font-extrabold text-[15px] leading-snug">{label}</p>
            {pagesText !== undefined && (
              <p className="mt-0.5 flex flex-wrap items-center gap-1 font-semibold text-ink-subtle text-xs">
                {onOpenPage === undefined
                  ? pagesText
                  : pages.map((page) => (
                      <button
                        key={page}
                        type="button"
                        className={`rounded-sm border px-1.5 py-0.5 ${previewOpen === page ? "border-ink bg-sun-soft text-ink" : "border-line hover:border-ink"}`}
                        onClick={() => onOpenPage(page)}
                        aria-pressed={previewOpen === page}
                      >
                        pág. {page}
                      </button>
                    ))}
              </p>
            )}
          </div>
        </div>
        {correction !== undefined && <span className={`badge ${statusBadge[correction.status]} shrink-0`}>{statusLabel[correction.status]}</span>}
      </div>

      {correction !== undefined && (
        <div className="flex flex-col gap-1.5 border-line border-t-2 border-dashed pt-2 font-semibold text-sm">
          <p className="text-ink-muted">{correction.feedback}</p>
          {correction.expected !== undefined && (
            <p><strong className="text-ink">Lo esperado: </strong><span className="text-ink-muted">{correction.expected}</span></p>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <button className="btn btn-secondary btn-sm" type="button" onClick={onAsk}>
              <Icon name="spark" size={14} /> Preguntar
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
