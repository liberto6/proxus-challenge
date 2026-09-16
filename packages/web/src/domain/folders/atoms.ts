import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ApiClient } from "../../api-client/client.ts";
import { apiRuntime } from "../../lib/runtime.ts";

/** Every folder, General first. */
export const foldersQuery = apiRuntime
  .atom(
    ApiClient.use((client) =>
      client.folders.list()
    ).pipe(Effect.withSpan("folders.list", { kind: "client" }))
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["folders"]));

/** Every conversation summary; the sidebar filters by folder on the client. */
export const sessionsQuery = apiRuntime
  .atom(
    ApiClient.use((client) =>
      client.tutor.listSessions({ query: {} })
    ).pipe(Effect.withSpan("tutor.listSessions", { kind: "client" }))
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["sessions"]));

export const createFolderAction = apiRuntime.fn(
  (title: string) =>
    ApiClient.use((client) => client.folders.create({ payload: { title } }))
      .pipe(Effect.withSpan("folders.create", { kind: "client" })),
  { reactivityKeys: ["folders"] }
);

export const renameFolderAction = apiRuntime.fn(
  (input: { readonly id: string; readonly title: string }) =>
    ApiClient.use((client) => client.folders.rename({ params: { id: input.id }, payload: { title: input.title } }))
      .pipe(Effect.withSpan("folders.rename", { kind: "client" })),
  { reactivityKeys: ["folders"] }
);

export const deleteFolderAction = apiRuntime.fn(
  (id: string) =>
    ApiClient.use((client) => client.folders.remove({ params: { id } }))
      .pipe(Effect.withSpan("folders.remove", { kind: "client" })),
  { reactivityKeys: ["folders"] }
);

/** What the student reads when a folder cannot be deleted, or the request failed. */
export const describeFolderError = (cause: unknown): string => {
  const error = cause as { _tag?: unknown; materials?: unknown; sessions?: unknown; artifacts?: unknown; title?: unknown; message?: unknown } | undefined;
  if (error?._tag === "FolderNotEmpty") {
    const parts: string[] = [];
    if (typeof error.materials === "number" && error.materials > 0) parts.push(`${error.materials} PDF`);
    if (typeof error.sessions === "number" && error.sessions > 0) parts.push(`${error.sessions} ${error.sessions === 1 ? "conversación" : "conversaciones"}`);
    if (typeof error.artifacts === "number" && error.artifacts > 0) parts.push(`${error.artifacts} ${error.artifacts === 1 ? "artefacto" : "artefactos"}`);
    return `Vacía la carpeta antes de eliminarla: contiene ${parts.join(", ")}.`;
  }
  if (error?._tag === "FolderTitleTaken") {
    return `Ya hay una carpeta llamada «${String(error.title)}».`;
  }
  if (error?._tag === "BadRequest") {
    return "El nombre no puede estar vacío ni superar 60 caracteres.";
  }
  if (error?._tag === "NotFound") {
    return "Esa carpeta ya no existe.";
  }
  const text = typeof error?.message === "string" ? error.message : String(cause);
  if (/FolderNotEmpty/.test(text)) return "La carpeta no está vacía.";
  if (/FolderTitleTaken/.test(text)) return "Ya existe una carpeta con ese nombre.";
  return text;
};
