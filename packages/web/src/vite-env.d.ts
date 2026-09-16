/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `browser` uses the speech recognition the browser ships; anything else keeps the simulated dictation. */
  readonly VITE_EXPLAIN_DICTATION?: string;
}
