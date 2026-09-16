import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ArtifactView as Artifact } from "@proxus/shared";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ReactNode } from "react";
import { materialPageKey, materialPageQuery, materialsQuery } from "../domain/materials/atoms.ts";
import { formatPages } from "../lib/format.ts";
import { Icon } from "./icons.tsx";

/**
 * Pieces shared by the practice panels: where an artifact comes from, a
 * rendered page of the material, and the score ring shown after grading.
 */

/** "Basado en Ciclo del agua · pág. 1-2", resolving the material title from the list. */
export function ArtifactProvenance({ artifact }: { readonly artifact: Artifact }) {
  const materials = useAtomValue(materialsQuery);
  if (artifact.source === undefined) {
    return null;
  }
  const title = AsyncResult.isSuccess(materials)
    ? materials.value.materials.find((material) => material.id === artifact.source?.materialId)?.title
    : undefined;
  const pages = formatPages(artifact.source.pages);
  return (
    <span>
      Basado en {title ?? artifact.source.materialId}{pages !== undefined ? ` · ${pages}` : ""}
    </span>
  );
}

/** Whether the material can still be previewed (it exists in the folder's list). */
export const useMaterialAvailable = (materialId: string | undefined): boolean => {
  const materials = useAtomValue(materialsQuery);
  return materialId !== undefined
    && (!AsyncResult.isSuccess(materials) || materials.value.materials.some((material) => material.id === materialId));
};

/** A rendered page of the material, opened from a page chip. */
export function PagePreview({ materialId, page, label, onClose, onAsk }: {
  readonly materialId: string;
  readonly page: number;
  readonly label: string;
  readonly onClose: () => void;
  readonly onAsk?: (() => void) | undefined;
}) {
  const result = useAtomValue(materialPageQuery(materialPageKey(materialId, page)));
  const refresh = useAtomRefresh(materialPageQuery(materialPageKey(materialId, page)));
  return (
    <section className="card flex flex-col gap-2.5 p-4" aria-label={`Página ${page} del material`} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-display font-semibold text-base leading-tight">Página {page} · {label}</h4>
        <div className="flex items-center gap-1.5">
          {onAsk !== undefined && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={onAsk}><Icon name="spark" size={14} /> Preguntar por esta página</button>
          )}
          <button className="icon-btn text-ink" type="button" onClick={onClose} aria-label="Cerrar la vista previa"><Icon name="close" size={14} strokeWidth={2.4} /></button>
        </div>
      </div>
      {AsyncResult.matchWithError(result, {
        onInitial: () => <div className="h-48 animate-pulse rounded-sm bg-surface-3" aria-busy="true" />,
        onError: (cause) => <PreviewError message={String(cause)} onRetry={refresh} />,
        onDefect: (cause) => <PreviewError message={String(cause)} onRetry={refresh} />,
        onSuccess: ({ value }) => (
          <img
            className="w-full rounded-sm border-2 border-line"
            src={value.data}
            alt={`Página ${value.page} de ${value.pageCount} del material`}
          />
        )
      })}
    </section>
  );
}

function PreviewError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-rosa bg-rosa-soft p-3 text-rosa-ink text-sm" role="alert">
      <span className="font-semibold break-words">No se pudo cargar la página: {message}</span>
      <button className="btn btn-secondary btn-sm self-start" type="button" onClick={onRetry}>Reintentar</button>
    </div>
  );
}

const scoreTone = (ratio: number): { text: string; ring: string; title: string } =>
  ratio >= 1
    ? { text: "text-mint-ink", ring: "#2fbf8a", title: "¡Perfecto!" }
    : ratio >= 0.7
      ? { text: "text-mint-ink", ring: "#2fbf8a", title: "¡Buen intento!" }
      : ratio >= 0.4
        ? { text: "text-sun-ink", ring: "#ffc94d", title: "Vas por buen camino" }
        : { text: "text-rosa-ink", ring: "#f04e6e", title: "Toca repasar" };

/** "2,5" for half points, "3" otherwise. */
export const formatScore = (score: number): string => Number.isInteger(score) ? String(score) : score.toFixed(1).replace(".", ",");

/** Tutoring between students for the folder's subject, offered under a weak result. */
export interface TutoringOffer {
  readonly subjectName: string;
  /** Opens the tutoring panel, filtered by the topic of the artifact. */
  readonly open: (topic?: string) => void;
}

/** A result under 50 % is where a human tutor is offered. */
export const deservesTutoring = (score: number, maxScore: number): boolean => maxScore > 0 && score / maxScore < 0.5;

/**
 * The hook: where the tutoring offer appears without being searched for.
 * Shown under the score when the attempt went badly and the folder names its subject.
 */
export function TutoringHook({ offer, topic }: { readonly offer: TutoringOffer; readonly topic: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 rounded-md border-2 border-ink bg-mint-soft px-3 py-2.5 font-bold text-[13px]" role="note">
      <span className="kind-icon bg-paper text-mint-ink" style={{ width: 30, height: 30 }}><Icon name="people" size={16} /></span>
      <span className="min-w-0 flex-1">
        ¿Prefieres que te lo explique alguien de tu grado?{" "}
        <button className="font-extrabold text-lila-ink underline" type="button" onClick={() => offer.open(topic)}>Ver tutores de {offer.subjectName} para este tema →</button>
      </span>
    </div>
  );
}

/** Score ring with a title by tone, an advice line and a retry button; confetti from 70 %. */
export function ScoreSummary({ score, maxScore, advice, previous, onRetry, actions }: {
  readonly score: number;
  readonly maxScore: number;
  readonly advice: string;
  /** Score of the previous attempt, shown as "Antes: 2/4". */
  readonly previous?: number | undefined;
  readonly onRetry: () => void;
  readonly actions?: ReactNode;
}) {
  const ratio = maxScore === 0 ? 0 : score / maxScore;
  const tone = scoreTone(ratio);
  const percent = Math.round(ratio * 100);

  return (
    <section className="card relative flex shrink-0 items-center gap-4 overflow-hidden p-4 shadow-hard-lg" role="status" aria-live="polite">
      {ratio >= 0.7 && (
        <>
          <span className="confetti" style={{ width: 8, height: 8, background: "#ff6b4a", top: 10, right: 60, transform: "rotate(20deg)" }} />
          <span className="confetti" style={{ width: 6, height: 10, background: "#ffc94d", top: 26, right: 34, transform: "rotate(-30deg)" }} />
          <span className="confetti" style={{ width: 7, height: 7, background: "#8b7cf6", bottom: 14, right: 80, transform: "rotate(45deg)" }} />
          <span className="confetti" style={{ width: 5, height: 9, background: "#2fbf8a", bottom: 22, right: 18, transform: "rotate(15deg)" }} />
        </>
      )}
      <div className="ring" style={{ background: `conic-gradient(${tone.ring} 0 ${percent}%, #f6eedf ${percent}% 100%)` }} aria-hidden="true">
        <div><span className={tone.text}>{formatScore(score)}</span><span className="text-ink-subtle text-[13px]">/{maxScore}</span></div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display font-semibold text-xl leading-tight">{tone.title}</p>
        <p className="font-semibold text-ink-muted text-sm">{advice}</p>
        {previous !== undefined && (
          <p className="mt-0.5 font-semibold text-ink-subtle text-xs">Antes: {formatScore(previous)}/{maxScore}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {actions}
        <button className="btn btn-secondary btn-sm" type="button" onClick={onRetry}>Repetir</button>
      </div>
    </section>
  );
}
