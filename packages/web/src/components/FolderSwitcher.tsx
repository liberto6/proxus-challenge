import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { generalFolderId, type Folder, type FolderSubject } from "@proxus/shared";
import { useEffect, useRef, useState } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { createFolderAction, deleteFolderAction, describeFolderError, foldersQuery, updateFolderAction } from "../domain/folders/atoms.ts";
import { catalog, degreesOf, describeSubject, subjectsOf } from "../domain/tutoring/catalog.ts";
import { Icon } from "./icons.tsx";

interface FolderSwitcherProps {
  readonly folderId: string;
  readonly onSelect: (folderId: string) => void;
  /** Called after a folder is deleted so the app can leave it. */
  readonly onDeleted: (folderId: string) => void;
}

type Editing = { readonly mode: "create" } | { readonly mode: "rename"; readonly folder: Folder } | undefined;

/** The three catalogue choices while editing; empty strings until chosen. */
interface SubjectDraft {
  readonly university: string;
  readonly degree: string;
  readonly name: string;
}

const emptyDraft: SubjectDraft = { university: "", degree: "", name: "" };

const draftOf = (subject: FolderSubject | undefined): SubjectDraft =>
  subject === undefined ? emptyDraft : { university: subject.university, degree: subject.degree, name: subject.name };

const subjectOf = (draft: SubjectDraft): FolderSubject | undefined => {
  if (draft.university === "" || draft.degree === "" || draft.name === "") return undefined;
  const year = subjectsOf(draft.university, draft.degree).find((subject) => subject.name === draft.name)?.year;
  return { university: draft.university, degree: draft.degree, name: draft.name, ...(year === undefined ? {} : { year }) };
};

/**
 * The folder the student is working in, with the small management around it:
 * create, rename, delete (only when empty; General never). A folder may name
 * its subject (university → degree → subject); the chip under the selector
 * shows it and the tutoring section uses it.
 */
export function FolderSwitcher({ folderId, onSelect, onDeleted }: FolderSwitcherProps) {
  const folders = useAtomValue(foldersQuery);
  const createFolder = useAtomSet(createFolderAction, { mode: "promise" });
  const updateFolder = useAtomSet(updateFolderAction, { mode: "promise" });
  const deleteFolder = useAtomSet(deleteFolderAction, { mode: "promise" });
  const [editing, setEditing] = useState<Editing>();
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<SubjectDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const list = AsyncResult.isSuccess(folders) ? folders.value.folders : [];
  const current = list.find((folder) => folder.id === folderId);

  useEffect(() => {
    if (editing !== undefined) input.current?.focus();
  }, [editing]);

  const startCreate = () => {
    setTitle("");
    setDraft(emptyDraft);
    setError(undefined);
    setConfirmDelete(false);
    setEditing({ mode: "create" });
  };
  const startRename = () => {
    if (current === undefined) return;
    setTitle(current.title);
    setDraft(draftOf(current.subject));
    setError(undefined);
    setConfirmDelete(false);
    setEditing({ mode: "rename", folder: current });
  };
  const cancel = () => {
    setEditing(undefined);
    setError(undefined);
  };

  const save = async () => {
    if (editing === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    const subject = subjectOf(draft);
    try {
      if (editing.mode === "create") {
        const folder = await createFolder({ title, ...(subject === undefined ? {} : { subject }) });
        setEditing(undefined);
        onSelect(folder.id);
      } else {
        // Clearing the three selectors clears the stored subject.
        await updateFolder({ id: editing.folder.id, title, subject: subject ?? null });
        setEditing(undefined);
      }
    } catch (cause) {
      setError(describeFolderError(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (current === undefined || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await deleteFolder(current.id);
      setConfirmDelete(false);
      onDeleted(current.id);
    } catch (cause) {
      setConfirmDelete(false);
      setError(describeFolderError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-label="Carpeta">
      <div className="flex items-center gap-2">
        <span className="section-mark bg-sun" aria-hidden="true" />
        <label className="sr-only" htmlFor="folder-select">Carpeta</label>
        <select
          id="folder-select"
          className="min-w-0 flex-1 rounded-sm border-2 border-ink bg-paper px-2 py-1.5 font-display font-semibold text-[15px] outline-none focus:border-sun"
          value={folderId}
          disabled={!AsyncResult.isSuccess(folders) || editing !== undefined}
          onChange={(event) => onSelect(event.currentTarget.value)}
        >
          {list.length === 0 && <option value={folderId}>{folderId === generalFolderId ? "General" : "…"}</option>}
          {list.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}
        </select>
        <button className="icon-btn text-ink" type="button" onClick={startCreate} aria-label="Nueva carpeta" title="Nueva carpeta" disabled={editing !== undefined}>
          <Icon name="plus" size={16} strokeWidth={2.4} />
        </button>
        <button className="icon-btn text-ink" type="button" onClick={startRename} aria-label="Editar carpeta" title="Editar nombre y asignatura" disabled={editing !== undefined || current === undefined}>
          <Icon name="test" size={15} />
        </button>
        {folderId !== generalFolderId && (
          <button className="icon-btn text-rosa-ink" type="button" onClick={() => { setError(undefined); setConfirmDelete(true); }} aria-label="Eliminar carpeta" title="Eliminar carpeta (solo si está vacía)" disabled={editing !== undefined || confirmDelete}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>

      {editing === undefined && current?.subject !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5 pl-[18px]">
          <span className="badge badge-neutral" title={current.subject.name}>{describeSubject(current.subject)}</span>
          <span className="truncate font-semibold text-ink-muted text-xs">{current.subject.name}</span>
        </div>
      )}

      {editing !== undefined && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="flex items-center gap-2">
            <input
              ref={input}
              className="min-w-0 flex-1 rounded-sm border-2 border-line bg-paper px-2 py-1.5 font-semibold text-sm outline-none focus:border-ink"
              value={title}
              maxLength={60}
              placeholder={editing.mode === "create" ? "Nombre de la carpeta" : "Nuevo nombre"}
              aria-label={editing.mode === "create" ? "Nombre de la nueva carpeta" : "Nuevo nombre de la carpeta"}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}
            />
          </div>
          <SubjectPicker draft={draft} onChange={setDraft} />
          <div className="flex items-center gap-2">
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy || title.trim().length === 0}>
              {editing.mode === "create" ? "Crear" : "Guardar"}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={cancel} disabled={busy}>Cancelar</button>
          </div>
        </form>
      )}

      {confirmDelete && current !== undefined && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-rosa bg-rosa-soft px-3 py-2 font-semibold text-rosa-ink text-sm" role="alertdialog" aria-label="Confirmar eliminación de carpeta">
          <span className="min-w-0 flex-1">¿Eliminar «{current.title}»?</span>
          <button className="btn btn-danger btn-sm" type="button" onClick={() => void remove()} disabled={busy}>Eliminar</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmDelete(false)} disabled={busy}>No</button>
        </div>
      )}

      {error !== undefined && (
        <div className="flex items-start gap-2 rounded-md border-2 border-rosa bg-rosa-soft p-2.5 text-rosa-ink text-sm" role="alert">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 font-semibold">{error}</span>
          <button className="icon-btn -my-1 -mr-1 size-7 text-rosa-ink" type="button" onClick={() => setError(undefined)} aria-label="Cerrar aviso">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

/** Optional subject of the folder: three chained selects over the catalogue. */
function SubjectPicker({ draft, onChange }: { readonly draft: SubjectDraft; readonly onChange: (draft: SubjectDraft) => void }) {
  const selectClass = "min-w-0 flex-1 rounded-sm border-2 border-line bg-paper px-2 py-1.5 font-semibold text-sm outline-none focus:border-ink disabled:opacity-50";
  return (
    <fieldset className="flex flex-col gap-1.5 rounded-md border-2 border-line border-dashed p-2">
      <legend className="px-1 font-bold text-ink-muted text-xs">Asignatura (opcional)</legend>
      <select
        className={selectClass}
        value={draft.university}
        aria-label="Universidad"
        onChange={(event) => onChange({ university: event.currentTarget.value, degree: "", name: "" })}
      >
        <option value="">Universidad</option>
        {catalog.map((university) => <option key={university.name} value={university.name}>{university.name}</option>)}
      </select>
      <select
        className={selectClass}
        value={draft.degree}
        aria-label="Grado"
        disabled={draft.university === ""}
        onChange={(event) => onChange({ ...draft, degree: event.currentTarget.value, name: "" })}
      >
        <option value="">Grado</option>
        {degreesOf(draft.university).map((degree) => <option key={degree.name} value={degree.name}>{degree.name}</option>)}
      </select>
      <select
        className={selectClass}
        value={draft.name}
        aria-label="Asignatura"
        disabled={draft.degree === ""}
        onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
      >
        <option value="">Asignatura</option>
        {subjectsOf(draft.university, draft.degree).map((subject) => <option key={subject.name} value={subject.name}>{subject.name} · {subject.year}.º</option>)}
      </select>
      <p className="font-semibold text-ink-subtle text-xs">Con la asignatura, la carpeta encuentra tutores de tu grado. Sin ella, todo lo demás funciona igual.</p>
    </fieldset>
  );
}
