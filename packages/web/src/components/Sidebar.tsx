import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { deleteMaterial, uploadMaterial } from "../domain/materials/upload.ts";

interface SidebarProps {
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}

export function Sidebar({ selectedArtifactId, onSelectArtifact }: SidebarProps) {
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | undefined>();
  const [materialError, setMaterialError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();

  const onFileChosen = async (file: File | undefined) => {
    if (file === undefined) return;
    setMaterialError(undefined);
    setUploading(file.name);
    try {
      await uploadMaterial(file);
      refreshMaterials();
    } catch (cause) {
      setMaterialError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(undefined);
      if (fileInput.current !== null) fileInput.current.value = "";
    }
  };

  const onDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(undefined);
    setMaterialError(undefined);
    try {
      await deleteMaterial(id);
      refreshMaterials();
    } catch (cause) {
      setMaterialError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <aside className="h-screen overflow-y-auto border-slate-800 border-r bg-slate-950 p-5 max-md:h-auto max-md:max-h-[45vh] max-md:border-r-0 max-md:border-b">
      <div className="mb-8 flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 font-extrabold text-white">
          P
        </div>
        <div>
          <strong className="block text-slate-100">Proxus Tutor</strong>
          <span className="block text-slate-400 text-sm">Tutor académico</span>
        </div>
      </div>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-slate-300 text-sm uppercase tracking-widest">Materiales</h2>
          <button
            className="rounded-full border border-slate-700 px-3 py-1 text-slate-200 text-sm hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading !== undefined}
          >
            {uploading === undefined ? "Subir PDF" : "Subiendo…"}
          </button>
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => void onFileChosen(event.currentTarget.files?.[0])}
          />
        </div>
        {uploading !== undefined && <p className="mb-2 text-slate-400 text-sm">Subiendo {uploading}…</p>}
        {materialError !== undefined && <p className="mb-2 text-red-200 text-sm" role="alert">{materialError}</p>}
        {AsyncResult.matchWithError(materials, {
          onInitial: () => <p className="text-slate-400">Cargando materiales…</p>,
          onError: (error) => <p className="text-red-200">{String(error)}</p>,
          onDefect: (defect) => <p className="text-red-200">{String(defect)}</p>,
          onSuccess: ({ value }) => value.materials.length === 0
            ? <p className="text-slate-400">Aún no hay PDFs. Sube uno para que el tutor pueda leerlo.</p>
            : (
                <details className="rounded-2xl border border-slate-800 bg-slate-900" open>
                  <summary className="cursor-pointer px-4 py-3 font-medium text-slate-100 marker:text-sky-400">
                    {value.materials.length} {value.materials.length === 1 ? "material" : "materiales"}
                  </summary>
                  <ul className="grid gap-2 border-slate-800 border-t p-3">
                    {value.materials.map((material) => (
                      <li className="flex items-start justify-between gap-2 rounded-xl bg-slate-950/70 p-3" key={material.id}>
                        <div className="min-w-0">
                          <strong className="block truncate text-slate-100">{material.title}</strong>
                          <span className="mt-1 block text-slate-400 text-sm">{material.pageCount} {material.pageCount === 1 ? "página" : "páginas"} · {material.id}</span>
                        </div>
                        <button
                          className={`shrink-0 rounded-full border px-2 py-1 text-xs ${confirmDelete === material.id ? "border-red-400 text-red-200" : "border-slate-700 text-slate-400 hover:border-red-400 hover:text-red-200"}`}
                          type="button"
                          onClick={() => void onDelete(material.id)}
                          onBlur={() => setConfirmDelete((current) => current === material.id ? undefined : current)}
                          title={confirmDelete === material.id ? "Pulsa otra vez para borrar" : "Borrar material"}
                        >
                          {confirmDelete === material.id ? "¿Borrar?" : "Borrar"}
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )
        })}
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-slate-300 text-sm uppercase tracking-widest">Artefactos</h2>
        </div>
        {AsyncResult.matchWithError(artifacts, {
          onInitial: () => <p className="text-slate-400">Cargando artefactos…</p>,
          onError: (error) => <p className="text-red-200">{String(error)}</p>,
          onDefect: (defect) => <p className="text-red-200">{String(defect)}</p>,
          onSuccess: ({ value }) => value.artifacts.length === 0
            ? <p className="text-slate-400">Aún no hay notas, quizzes ni tests.</p>
            : (
                <details className="rounded-2xl border border-slate-800 bg-slate-900" open>
                  <summary className="cursor-pointer px-4 py-3 font-medium text-slate-100 marker:text-sky-400">
                    {value.artifacts.length} {value.artifacts.length === 1 ? "artefacto" : "artefactos"}
                  </summary>
                  <ul className="grid gap-2 border-slate-800 border-t p-3">
                    {value.artifacts.map((artifact) => (
                      <li key={artifact.id}>
                        <button
                          className={`w-full rounded-xl p-3 text-left transition hover:border-sky-500 hover:bg-slate-950 ${
                            selectedArtifactId === artifact.id
                              ? "border border-sky-500 bg-sky-950/40"
                              : "border border-transparent bg-slate-950/70"
                          }`}
                          type="button"
                          onClick={() => onSelectArtifact(artifact.id)}
                        >
                          <strong className="block text-slate-100">{artifact.title}</strong>
                          <span className="mt-1 block text-slate-400 text-sm">{artifact.kind} · {artifact.id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )
        })}
      </section>
    </aside>
  );
}
