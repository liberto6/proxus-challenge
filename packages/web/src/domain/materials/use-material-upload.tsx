import { useAtomRefresh } from "@effect/atom-react";
import { useRef, useState, type ReactNode } from "react";
import { materialsQuery } from "./atoms.ts";
import { UploadCancelled, uploadMaterial } from "./upload.ts";

export interface UploadInProgress {
  readonly fileName: string;
  readonly size: number;
  /** 0..1 */
  readonly progress: number;
}

export interface MaterialUploader {
  readonly upload: UploadInProgress | undefined;
  readonly error: string | undefined;
  readonly clearError: () => void;
  /** Opens the file picker. */
  readonly openPicker: () => void;
  /** Uploads a file chosen by drag and drop or from the picker. */
  readonly start: (file: File | undefined) => Promise<void>;
  readonly cancel: () => void;
  /** Hidden file input; render it once anywhere in the tree. */
  readonly input: ReactNode;
}

/**
 * One upload at a time, shared by the sidebar and the empty state so both can
 * trigger it and show its progress.
 */
export const useMaterialUpload = (): MaterialUploader => {
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const [upload, setUpload] = useState<UploadInProgress | undefined>();
  const [error, setError] = useState<string | undefined>();

  const start = async (file: File | undefined) => {
    if (file === undefined || controller.current !== undefined) return;
    const abort = new AbortController();
    controller.current = abort;
    setError(undefined);
    setUpload({ fileName: file.name, size: file.size, progress: 0 });
    try {
      await uploadMaterial(file, {
        signal: abort.signal,
        onProgress: (progress) => setUpload((current) => current === undefined ? current : { ...current, progress })
      });
      refreshMaterials();
    } catch (cause) {
      if (!(cause instanceof UploadCancelled)) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      controller.current = undefined;
      setUpload(undefined);
      if (inputRef.current !== null) inputRef.current.value = "";
    }
  };

  return {
    upload,
    error,
    clearError: () => setError(undefined),
    openPicker: () => inputRef.current?.click(),
    start,
    cancel: () => controller.current?.abort(),
    input: (
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="application/pdf,.pdf"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => void start(event.currentTarget.files?.[0])}
      />
    )
  };
};
