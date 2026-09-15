import { Context, Effect, Option } from "effect";
import type { AgentMessage } from "./message.ts";

/**
 * Events produced while a session turn runs. They mirror the shared
 * `AgentEvent` contract minus `done`, which the transport appends.
 */
export type SessionEvent =
  | { readonly type: "message"; readonly message: AgentMessage }
  | { readonly type: "progress"; readonly label: string }
  | { readonly type: "error"; readonly message: string; readonly retryable: boolean };

export interface AgentEventSink {
  readonly emit: (event: SessionEvent) => Effect.Effect<void>;
}

/**
 * Sink through which tool handlers report progress. The session provides it
 * while the model runs tools; when absent (CLI, evals) progress is dropped.
 */
export const AgentEventSink = Context.Service<AgentEventSink>("@proxus/server/agents/harness/AgentEventSink");

export const emitProgress = (label: string): Effect.Effect<void> =>
  Effect.serviceOption(AgentEventSink).pipe(
    Effect.flatMap((sink) => Option.isSome(sink) ? sink.value.emit({ type: "progress", label }) : Effect.void)
  );

/** Human-readable label for a tool call, shown to the student while it runs. */
export const progressLabelFor = (tool: string, input: unknown): string => {
  if (tool === "load_skill") {
    const name = typeof input === "object" && input !== null ? (input as { name?: unknown }).name : undefined;
    return `Preparando: ${typeof name === "string" ? name.replaceAll("-", " ") : "instrucciones"}`;
  }

  const command = typeof input === "object" && input !== null && typeof (input as { input?: unknown }).input === "string"
    ? (input as { input: string }).input.trim()
    : "";

  const view = /^materials\s+view\s+(\S+)\s+(\S+)/.exec(command);
  if (view !== null) {
    return `Leyendo páginas ${view[2]} de ${view[1]}`;
  }
  if (/^materials\s+list/.test(command)) {
    return "Consultando tus materiales";
  }
  if (/^artifacts\s+create\b/.test(command)) {
    const kind = /"kind"\s*:\s*"(note|quiz|test)"/.exec(command)?.[1];
    return kind === "note" ? "Escribiendo una nota" : kind === "test" ? "Preparando un test" : "Preparando un quiz";
  }
  if (/^artifacts\s+(submit|grade)\b/.test(command)) {
    return "Corrigiendo tus respuestas";
  }
  if (/^artifacts\s+(list|show|attempts)\b/.test(command)) {
    return "Revisando tus artefactos";
  }
  return command.length > 0 ? `Ejecutando: ${command.slice(0, 60)}` : `Usando ${tool}`;
};
