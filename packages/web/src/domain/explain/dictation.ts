/**
 * What the explanation panel expects from a dictation source, whatever
 * produces the text: the browser's speech recognition or the prototype's
 * simulation. `start` opens a recording, `stop` closes it, the transcript
 * grows through the callback given to the hook.
 */

export type DictationStatus = "idle" | "recording" | "stopped" | "failed";

export interface Dictation {
  readonly status: DictationStatus;
  /** Seconds since the recording started; frozen when it stops. */
  readonly seconds: number;
  /** Why the last recording failed, for the student. */
  readonly reason?: string | undefined;
  /** Starts a recording. The simulated source needs the text it will dictate. */
  readonly start: (text?: string) => void;
  readonly stop: () => void;
}

export type DictationSource = "browser" | "simulated";

/**
 * `VITE_EXPLAIN_DICTATION` in the root `.env` chooses the source: by default
 * (or with `browser`) the speech recognition the browser ships; `simulated`
 * keeps the prototype's sample texts, for demos without a microphone.
 */
export const configuredDictationSource = (): DictationSource =>
  import.meta.env.VITE_EXPLAIN_DICTATION === "simulated" ? "simulated" : "browser";

/** Whether this browser can recognise speech (Chrome, Edge, Safari; not Firefox). */
export const speechRecognitionSupported = (): boolean =>
  typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
