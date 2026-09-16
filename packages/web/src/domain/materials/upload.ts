import { Schema } from "effect";
import { PdfMaterial } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

const decodeMaterial = Schema.decodeUnknownSync(PdfMaterial);

export const maxUploadBytes = 20 * 1024 * 1024;

/** Uploads one PDF. Throws with a message meant for the user. */
export const uploadMaterial = async (file: File, title?: string): Promise<PdfMaterial> => {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Solo se admiten ficheros PDF.");
  }
  if (file.size > maxUploadBytes) {
    throw new Error("El PDF supera los 20 MB permitidos.");
  }

  const form = new FormData();
  form.append("file", file, file.name);
  if (title !== undefined && title.trim().length > 0) {
    form.append("title", title.trim());
  }

  const response = await fetch(`${apiClientConfig.apiUrl}/api/materials`, { method: "POST", body: form });
  if (response.status === 400) {
    throw new Error("El servidor no ha podido leer el fichero como PDF.");
  }
  if (response.status === 413) {
    throw new Error("El PDF supera el tamaño permitido.");
  }
  if (response.status === 404) {
    throw new Error("El servidor no expone la ruta de subida. Si acabas de actualizar el código, reinicia el servidor.");
  }
  if (!response.ok) {
    throw new Error(`No se pudo subir el material (${response.status}).`);
  }
  return decodeMaterial(await response.json());
};

export const deleteMaterial = async (id: string): Promise<void> => {
  const response = await fetch(`${apiClientConfig.apiUrl}/api/materials/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) {
    throw new Error("El servidor no encuentra ese material ni la ruta de borrado. Si acabas de actualizar el código, reinicia el servidor.");
  }
  if (!response.ok) {
    throw new Error(`No se pudo borrar el material (${response.status}).`);
  }
};
