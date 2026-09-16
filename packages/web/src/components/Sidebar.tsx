import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { ArtifactSummary, PdfMaterial } from "@proxus/shared";
import { useState, type DragEvent } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { deleteMaterial } from "../domain/materials/upload.ts";
import type { MaterialUploader } from "../domain/materials/use-material-upload.tsx";
import { formatBytes, formatPages, pluralize, relativeDay } from "../lib/format.ts";
import { Icon, KindIcon, kindLabel, Mascot } from "./icons.tsx";

interface SidebarProps {
  readonly uploader: MaterialUploader;
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}

export function Sidebar({ uploader, selectedArtifactId, onSelectArtifact }: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-ink border-r-2 bg-paper">
      <Brand />
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pt-3 pb-4">
        <MaterialsSection uploader={uploader} />
        <PracticeList selectedArtifactId={selectedArtifactId} onSelectArtifact={onSelectArtifact} />
      </div>
    </aside>
  );
}

export function Brand({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${compact ? "" : "px-4 pt-4 pb-3"}`}>
      <Mascot size={compact ? 30 : 40} />
      <div>
        <div className={`font-display font-semibold leading-tight ${compact ? "text-base" : "text-lg"}`}>Proxus Tutor</div>
        {!compact && <div className="font-semibold text-ink-subtle text-xs">Tu tutor de bolsillo</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children, color }: { readonly children: string; readonly color: string }) {
  return (
    <h2 className="flex items-center gap-2 font-display font-semibold text-[15px]">
      <span className={`section-mark ${color}`} aria-hidden="true" />
      {children}
    </h2>
  );
}

// --- Materiales --------------------------------------------------------------------

export function MaterialsSection({ uploader, hideTitle = false }: { readonly uploader: MaterialUploader; readonly hideTitle?: boolean }) {
  const materials = useAtomValue(materialsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);

  const onDelete = async (id: string) => {
    setConfirmDelete(undefined);
    setDeleteError(undefined);
    try {
      await deleteMaterial(id);
      refreshMaterials();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void uploader.start(event.dataTransfer.files[0]);
    }
  };

  const error = uploader.error ?? deleteError;
  const clearError = () => {
    uploader.clearError();
    setDeleteError(undefined);
  };

  return (
    <section>
      <div className={`mb-2.5 flex items-center gap-3 ${hideTitle ? "justify-end" : "justify-between"}`}>
        {!hideTitle && <SectionTitle color="bg-coral">Materiales</SectionTitle>}
        <button className="btn btn-secondary btn-sm" type="button" onClick={uploader.openPicker} disabled={uploader.upload !== undefined}>
          <Icon name="upload" size={16} strokeWidth={2.2} /> Subir PDF
        </button>
      </div>
      {uploader.input}

      <div className="flex flex-col gap-2.5">
        {uploader.upload !== undefined && <UploadCard upload={uploader.upload} onCancel={uploader.cancel} />}

        {error !== undefined && (
          <div className="flex items-start gap-2 rounded-md border-2 border-rosa bg-rosa-soft p-3 text-rosa-ink text-sm" role="alert">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1 font-semibold">{error}</span>
            <button className="icon-btn -my-1.5 -mr-1.5 size-7 text-rosa-ink" type="button" onClick={clearError} aria-label="Cerrar aviso">
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        {AsyncResult.matchWithError(materials, {
          onInitial: () => <Skeleton rows={2} />,
          onError: (cause) => <LoadError message={String(cause)} onRetry={refreshMaterials} />,
          onDefect: (cause) => <LoadError message={String(cause)} onRetry={refreshMaterials} />,
          onSuccess: ({ value }) => (
            <>
              {value.materials.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  confirming={confirmDelete === material.id}
                  onAskDelete={() => setConfirmDelete(material.id)}
                  onCancelDelete={() => setConfirmDelete(undefined)}
                  onConfirmDelete={() => void onDelete(material.id)}
                />
              ))}
              <button
                className={`dropzone ${value.materials.length === 0 ? "dropzone-primary" : ""} ${dragging ? "dropzone-active" : ""}`}
                type="button"
                onClick={uploader.openPicker}
                disabled={uploader.upload !== undefined}
                {...dropHandlers}
              >
                <Icon name="upload" size={20} strokeWidth={2.2} className={value.materials.length === 0 ? "text-coral" : ""} />
                {value.materials.length === 0
                  ? (
                      <>
                        <strong className="font-extrabold text-ink text-sm">Arrastra un PDF aquí</strong>
                        <span>o pulsa «Subir PDF». Apuntes, temas, diapositivas.</span>
                      </>
                    )
                  : <span>Arrastra otro PDF aquí</span>}
              </button>
            </>
          )
        })}
      </div>
    </section>
  );
}

function MaterialRow({ material, confirming, onAskDelete, onCancelDelete, onConfirmDelete }: {
  readonly material: PdfMaterial;
  readonly confirming: boolean;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}) {
  const uploaded = relativeDay(material.uploadedAt);
  return (
    <div className={`card-flat flex items-center gap-2.5 p-3 ${confirming ? "border-rosa bg-rosa-soft" : ""}`}>
      <KindIcon kind="pdf" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 font-extrabold text-sm leading-tight" title={material.title}>{material.title}</div>
        <div className="mt-0.5 font-semibold text-ink-muted text-sm">
          {pluralize(material.pageCount, "página", "páginas")}{uploaded !== undefined ? ` · subido ${uploaded}` : ""}
        </div>
      </div>
      {confirming
        ? (
            <div className="flex shrink-0 gap-1.5">
              <button className="btn btn-danger btn-sm" type="button" onClick={onConfirmDelete}>Borrar</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={onCancelDelete}>No</button>
            </div>
          )
        : (
            <button className="icon-btn shrink-0" type="button" onClick={onAskDelete} aria-label={`Borrar ${material.title}`} title="Borrar material">
              <Icon name="trash" size={16} />
            </button>
          )}
    </div>
  );
}

function UploadCard({ upload, onCancel }: { readonly upload: { fileName: string; size: number; progress: number }; readonly onCancel: () => void }) {
  const percent = Math.round(upload.progress * 100);
  return (
    <div className="card-flat flex flex-col gap-2.5 p-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <KindIcon kind="pdf" className="opacity-60" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-extrabold text-sm leading-tight" title={upload.fileName}>{upload.fileName}</div>
          <div className="mt-0.5 font-semibold text-ink-muted text-sm">Subiendo · {formatBytes(upload.size)} · {percent} %</div>
        </div>
        <button className="icon-btn shrink-0" type="button" onClick={onCancel} aria-label="Cancelar subida">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="progress" aria-hidden="true"><div style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

// --- Práctica ----------------------------------------------------------------------

export function PracticeList({ selectedArtifactId, onSelectArtifact }: {
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}) {
  const artifacts = useAtomValue(artifactsQuery);
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const materials = useAtomValue(materialsQuery);
  const materialTitles = AsyncResult.isSuccess(materials)
    ? new Map(materials.value.materials.map((material) => [material.id, material.title]))
    : new Map<string, string>();

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <SectionTitle color="bg-lila">Práctica</SectionTitle>
      </div>
      <div className="flex flex-col gap-2.5">
        {AsyncResult.matchWithError(artifacts, {
          onInitial: () => <Skeleton rows={2} />,
          onError: (cause) => <LoadError message={String(cause)} onRetry={refreshArtifacts} />,
          onDefect: (cause) => <LoadError message={String(cause)} onRetry={refreshArtifacts} />,
          onSuccess: ({ value }) => value.artifacts.length === 0
            ? (
                <p className="rounded-md border-2 border-line border-dashed p-3.5 text-center font-semibold text-ink-subtle text-sm">
                  Los esquemas, notas, quizzes y tests que cree el tutor aparecerán aquí.
                </p>
              )
            : value.artifacts.map((artifact) => (
                <ArtifactRow
                  key={artifact.id}
                  artifact={artifact}
                  materialTitle={artifact.source === undefined ? undefined : materialTitles.get(artifact.source.materialId)}
                  selected={selectedArtifactId === artifact.id}
                  onSelect={() => onSelectArtifact(artifact.id)}
                />
              ))
        })}
      </div>
    </section>
  );
}

/** "Quiz · Ciclo del agua · pág. 1-2", with whatever parts are known. */
export const describeArtifactSummary = (artifact: ArtifactSummary, materialTitle: string | undefined): string => {
  const parts: string[] = [kindLabel[artifact.kind]];
  if (artifact.source !== undefined) {
    if (materialTitle !== undefined) parts.push(materialTitle);
    const pages = formatPages(artifact.source.pages);
    if (pages !== undefined) parts.push(pages);
  } else {
    const created = relativeDay(artifact.createdAt);
    if (created !== undefined) parts.push(`creado ${created}`);
  }
  return parts.join(" · ");
};

function ArtifactRow({ artifact, materialTitle, selected, onSelect }: {
  readonly artifact: ArtifactSummary;
  readonly materialTitle: string | undefined;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 p-3 text-left transition ${selected ? "card bg-sun-soft" : "card-flat hover:border-ink"}`}
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <KindIcon kind={artifact.kind} />
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-sm leading-tight">{artifact.title}</div>
        <div className="mt-0.5 font-semibold text-ink-muted text-sm">{describeArtifactSummary(artifact, materialTitle)}</div>
      </div>
      <Icon name="chevron" size={16} className="shrink-0 text-ink" />
    </button>
  );
}

// --- Estados compartidos --------------------------------------------------------------

function Skeleton({ rows }: { readonly rows: number }) {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="card-flat flex items-center gap-2.5 p-3">
          <div className="size-[34px] shrink-0 animate-pulse rounded-sm bg-surface-3" />
          <div className="flex-1">
            <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-3" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-rosa bg-rosa-soft p-3 text-rosa-ink text-sm" role="alert">
      <span className="font-semibold break-words">No se pudo cargar: {message}</span>
      <button className="btn btn-secondary btn-sm self-start" type="button" onClick={onRetry}>Reintentar</button>
    </div>
  );
}
