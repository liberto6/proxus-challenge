import { Schema } from "effect";
import { PdfMaterial } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

const decodeMaterial = Schema.decodeUnknownSync(PdfMaterial);

export const maxUploadBytes = 20 * 1024 * 1024;

export interface UploadOptions {
  /** Fraction 0..1 of the file sent so far. */
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** Thrown when the upload was cancelled through `signal`. */
export class UploadCancelled extends Error {
  constructor() {
    super("Subida cancelada.");
    this.name = "UploadCancelled";
  }
}

const describeStatus = (status: number): string => {
  if (status === 400) return "El servidor no ha podido leer el fichero como PDF.";
  if (status === 413) return "El PDF supera el tamaño permitido.";
  if (status === 404) return "El servidor no expone la ruta de subida. Si acabas de actualizar el código, reinicia el servidor.";
  return `No se pudo subir el material (${status}).`;
};

/**
 * Uploads one PDF with progress and cancellation. Uses `XMLHttpRequest`
 * because `fetch` does not report upload progress. Same endpoint and payload
 * as before. Throws with a message meant for the user.
 */
export const uploadMaterial = (file: File, options: UploadOptions = {}, title?: string, folderId?: string): Promise<PdfMaterial> => {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return Promise.reject(new Error("Solo se admiten ficheros PDF."));
  }
  if (file.size > maxUploadBytes) {
    return Promise.reject(new Error("El PDF supera los 20 MB permitidos."));
  }

  const form = new FormData();
  form.append("file", file, file.name);
  if (title !== undefined && title.trim().length > 0) {
    form.append("title", title.trim());
  }
  if (folderId !== undefined) {
    form.append("folderId", folderId);
  }

  return new Promise<PdfMaterial>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${apiClientConfig.apiUrl}/api/materials`);
    request.responseType = "text";

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onProgress?.(event.total === 0 ? 1 : event.loaded / event.total);
      }
    };
    request.onerror = () => reject(new Error("No se pudo conectar con el servidor para subir el PDF."));
    request.onabort = () => reject(new UploadCancelled());
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(describeStatus(request.status)));
        return;
      }
      try {
        resolve(decodeMaterial(JSON.parse(request.responseText)));
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    };

    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        reject(new UploadCancelled());
        return;
      }
      options.signal.addEventListener("abort", () => request.abort(), { once: true });
    }

    request.send(form);
  });
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
