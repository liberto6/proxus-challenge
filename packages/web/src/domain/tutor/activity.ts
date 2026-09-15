import type { AgentMessage } from "@proxus/shared";

/**
 * Human-readable description of what the tutor did, for tool messages shown in
 * the chat timeline. Mirrors the progress labels the server streams while the
 * tool runs, but is computed from the persisted message so it survives reloads.
 */
export const describeToolMessage = (message: AgentMessage): string => {
  if (message.role === "tool-call") {
    return describeToolCall(message.name, message.input);
  }

  if (message.role === "tool-result") {
    return message.isFailure ? `Falló: ${message.name}` : describeToolResult(message.name, message.result);
  }

  return "";
};

const describeToolCall = (name: string, input: unknown): string => {
  if (name === "load_skill") {
    const skill = typeof input === "object" && input !== null ? (input as { name?: unknown }).name : undefined;
    return `Preparando: ${typeof skill === "string" ? skill.replaceAll("-", " ") : "instrucciones"}`;
  }

  const command = cliCommand(input);
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
  return command.length > 0 ? `Ejecutando: ${command.slice(0, 60)}` : `Usando ${name}`;
};

const describeToolResult = (name: string, result: unknown): string => {
  if (name === "load_skill") {
    return "Instrucciones cargadas";
  }

  if (typeof result === "object" && result !== null) {
    const typed = result as { type?: unknown; pages?: unknown; material?: { title?: unknown }; kind?: unknown; title?: unknown; status?: unknown };
    if (typed.type === "material-page-images" && Array.isArray(typed.pages)) {
      const pages = typed.pages.map((page: { page?: unknown }) => String(page.page)).join(", ");
      return `Páginas ${pages} leídas${typeof typed.material?.title === "string" ? ` de ${typed.material.title}` : ""}`;
    }
    if (typeof typed.kind === "string" && typeof typed.title === "string") {
      return `Creado: ${typed.title}`;
    }
    if (typed.status === "graded") {
      return "Intento corregido";
    }
  }

  if (typeof result === "string") {
    return result.length > 80 ? `${result.slice(0, 80)}…` : result;
  }

  return "Hecho";
};

const cliCommand = (input: unknown): string =>
  typeof input === "object" && input !== null && typeof (input as { input?: unknown }).input === "string"
    ? (input as { input: string }).input.trim()
    : "";
