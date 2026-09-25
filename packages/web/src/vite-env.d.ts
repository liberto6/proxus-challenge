/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `simulated` uses the prototype's sample texts; anything else (the default) uses the speech recognition the browser ships. */
  readonly VITE_EXPLAIN_DICTATION?: string;
}
