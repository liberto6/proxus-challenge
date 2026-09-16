import { useAtomRefresh } from "@effect/atom-react";
import type { AgentMessage } from "@proxus/shared";
import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { describeToolMessage } from "../domain/tutor/activity.ts";
import { applyInvalidations, invalidationsForToolCall } from "../domain/tutor/invalidation.ts";
import { createSession, loadOrCreateSession } from "../domain/tutor/session.ts";
import { streamTutorMessage } from "../domain/tutor/stream.ts";

const starterPrompts = [
  "Lista mis materiales",
  "Crea un quiz corto a partir de mis materiales",
  "Explícame paso a paso el concepto más difícil de mis apuntes"
] as const;

interface TurnError {
  readonly message: string;
  /** Input to resend when the user clicks retry. */
  readonly input: string | undefined;
}

interface ChatProps {
  /** Artifact open in the workspace, sent to the tutor as context. */
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
}

export function Chat({ selectedArtifactId, onSelectArtifact }: ChatProps) {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sessionState, setSessionState] = useState<"loading" | "ready" | "failed">("loading");
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<readonly string[]>([]);
  const [error, setError] = useState<TurnError | undefined>();
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const abortController = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadOrCreateSession()
      .then((session) => {
        if (cancelled) return;
        setSessionId(session.id);
        setMessages(session.messages);
        setSessionState("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        setSessionState("failed");
        setError({ message: `No se pudo cargar la sesión: ${cause instanceof Error ? cause.message : String(cause)}`, input: undefined });
      });
    return () => { cancelled = true; };
  }, []);

  const startNewSession = async () => {
    if (isSending) return;
    setSessionState("loading");
    setError(undefined);
    try {
      const session = await createSession();
      setSessionId(session.id);
      setMessages([]);
      setSessionState("ready");
    } catch (cause) {
      setSessionState("failed");
      setError({ message: `No se pudo crear la sesión: ${cause instanceof Error ? cause.message : String(cause)}`, input: undefined });
    }
  };

  const submit = async (nextInput: string, history: readonly AgentMessage[] = messages) => {
    const trimmed = nextInput.trim();
    if (trimmed.length === 0 || isSending || sessionId === undefined) {
      return;
    }

    const controller = new AbortController();
    abortController.current = controller;
    setIsSending(true);
    setError(undefined);
    setProgress([]);
    pendingInvalidations.current = [];

    // The user message is shown immediately; the server echoes it as the first event.
    const historyBefore = history;
    let turnMessages: AgentMessage[] = [];
    let turnFailed: TurnError | undefined;

    try {
      const context = selectedArtifactId === null ? undefined : { openArtifactId: selectedArtifactId };
      for await (const event of streamTutorMessage({ sessionId, input: trimmed, maxSteps: 8, ...(context === undefined ? {} : { context }) }, controller.signal)) {
        switch (event.type) {
          case "message": {
            const message = event.message;
            turnMessages = [...turnMessages, message];
            setMessages([...historyBefore, ...turnMessages]);
            setProgress([]);

            if (message.role === "tool-call") {
              pendingInvalidations.current.push(invalidationsForToolCall(message));
            }
            if (message.role === "tool-result") {
              const keys = pendingInvalidations.current.shift() ?? [];
              if (!message.isFailure) {
                applyInvalidations(keys, { refreshArtifacts, refreshMaterials });
              }
            }
            break;
          }
          case "progress":
            setProgress((current) => [...current, event.label]);
            break;
          case "error":
            turnFailed = { message: event.message, input: event.retryable ? trimmed : undefined };
            break;
          case "done":
            break;
        }
      }

      if (turnFailed === undefined) {
        setInput("");
      } else {
        // Drop the failed turn so a retry does not duplicate the user message.
        setMessages(historyBefore);
        setError(turnFailed);
      }
    } catch (cause) {
      setMessages(historyBefore);
      if (controller.signal.aborted) {
        setError({ message: "Turno cancelado.", input: trimmed });
      } else {
        setError({
          message: `No se pudo hablar con el tutor: ${cause instanceof Error ? cause.message : String(cause)}`,
          input: trimmed
        });
      }
    } finally {
      abortController.current = undefined;
      setProgress([]);
      setIsSending(false);
    }
  };

  const cancel = () => abortController.current?.abort();

  return (
    <main className="grid h-screen max-h-screen min-w-0 grid-rows-[auto_1fr_auto_auto] bg-slate-950 max-md:h-auto max-md:max-h-none">
      <header className="flex items-center justify-between gap-4 border-slate-800 border-b px-6 py-5">
        <div>
          <p className="mb-1 font-bold text-sky-400 text-xs uppercase tracking-widest">
            {sessionState === "ready" && sessionId !== undefined ? `Sesión guardada · ${sessionId.slice(0, 8)}` : sessionState === "loading" ? "Cargando sesión…" : "Sin sesión"}
          </p>
          <h1 className="m-0 font-bold text-3xl text-slate-100">Tutor académico</h1>
        </div>
        <button
          className="rounded-full border border-slate-700 px-4 py-2 text-slate-200 hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => void startNewSession()}
          disabled={isSending || sessionState === "loading"}
        >
          Nueva sesión
        </button>
      </header>

      <section className="flex flex-col gap-3 overflow-y-auto p-6" aria-live="polite">
        {messages.length === 0 && !isSending
          ? (
              <div className="m-auto w-full max-w-3xl text-center">
                <h2 className="m-0 text-balance font-bold text-4xl text-slate-100 leading-tight md:text-6xl">
                  Pregunta sobre tus materiales, notas, quizzes o tests.
                </h2>
                <p className="mt-4 text-slate-400">La conversación se guarda en el servidor: puedes recargar o volver más tarde.</p>
                <div className="mt-6 grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                  {starterPrompts.map((prompt) => (
                    <button
                      className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-slate-200 hover:border-sky-400"
                      key={prompt}
                      type="button"
                      onClick={() => void submit(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )
          : groupMessages(messages).map((group, index) => group.kind === "activity"
              ? <ActivityGroup key={index} messages={group.messages} onSelectArtifact={onSelectArtifact} />
              : <MessageBubble key={index} message={group.message} />)}

        {isSending && <ProgressStatus label={progress.at(-1)} />}
      </section>

      {error === undefined ? null : (
        <div className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-900 bg-red-950/60 px-4 py-3 text-red-100" role="alert">
          <span className="min-w-0 flex-1 break-words text-sm">{error.message}</span>
          {error.input === undefined ? null : (
            <button
              className="rounded-full border border-red-400 px-4 py-1.5 text-red-100 text-sm hover:bg-red-900"
              type="button"
              onClick={() => void submit(error.input ?? "")}
              disabled={isSending}
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      <form
        className="grid grid-cols-[1fr_auto] gap-3 border-slate-800 border-t bg-slate-950/90 px-6 pt-4 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input);
        }}
      >
        <textarea
          className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-slate-100 outline-none focus:border-transparent focus:ring-2 focus:ring-sky-400"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit(input);
            }
          }}
          placeholder="Pregunta algo a tu tutor…"
          rows={3}
          disabled={isSending || sessionState !== "ready"}
        />
        {isSending
          ? (
              <button
                className="self-end rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-slate-100 hover:border-red-400"
                type="button"
                onClick={cancel}
              >
                Cancelar
              </button>
            )
          : (
              <button
                className="self-end rounded-full border border-slate-700 bg-slate-900 px-5 py-3 text-slate-100 hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                type="submit"
                disabled={input.trim().length === 0 || sessionState !== "ready"}
              >
                Enviar
              </button>
            )}
      </form>
    </main>
  );
}

/** Current status while a turn runs. A "reintentando en N s" label counts down. */
function ProgressStatus({ label }: { readonly label: string | undefined }) {
  const [text, setText] = useState(label ?? "El tutor está pensando…");

  useEffect(() => {
    const match = label === undefined ? null : /reintentando en (\d+) s/.exec(label);
    if (label === undefined || match === null) {
      setText(label ?? "El tutor está pensando…");
      return;
    }

    let remaining = Number(match[1]);
    const render = () => setText(label.replace(/reintentando en \d+ s/, `reintentando en ${remaining} s`));
    render();
    const timer = window.setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      render();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [label]);

  return (
    <div className="flex max-w-3xl items-center gap-3 self-start rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-300 text-sm" role="status">
      <span className="inline-block size-2 animate-pulse rounded-full bg-sky-400" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

type MessageGroup =
  | { readonly kind: "message"; readonly message: AgentMessage }
  | { readonly kind: "activity"; readonly messages: readonly AgentMessage[] };

/** Consecutive tool calls and results collapse into one activity block per turn. */
function groupMessages(messages: readonly AgentMessage[]): readonly MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const message of messages) {
    const isTool = message.role === "tool-call" || message.role === "tool-result";
    const last = groups.at(-1);
    if (isTool && last?.kind === "activity") {
      groups[groups.length - 1] = { kind: "activity", messages: [...last.messages, message] };
    } else if (isTool) {
      groups.push({ kind: "activity", messages: [message] });
    } else {
      groups.push({ kind: "message", message });
    }
  }
  return groups;
}

/** Artifacts created during a turn, taken from `artifacts create` results. */
const createdArtifacts = (messages: readonly AgentMessage[]): ReadonlyArray<{ id: string; kind: string; title: string }> =>
  messages.flatMap((message) => {
    if (message.role !== "tool-result" || message.isFailure) return [];
    const result = typeof message.result === "string" ? safeJson(message.result) : message.result;
    const typed = result as { created?: unknown; id?: unknown; kind?: unknown; title?: unknown } | undefined;
    return typed?.created === true && typeof typed.id === "string" && typeof typed.kind === "string" && typeof typed.title === "string"
      ? [{ id: typed.id, kind: typed.kind, title: typed.title }]
      : [];
  });

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const kindLabel: Record<string, string> = { note: "la nota", quiz: "el quiz", test: "el test" };

function ActivityGroup({ messages, onSelectArtifact }: { readonly messages: readonly AgentMessage[]; readonly onSelectArtifact: (artifactId: string) => void }) {
  const steps = messages.filter((message) => message.role === "tool-call");
  const failed = messages.some((message) => message.role === "tool-result" && message.isFailure);
  const summary = steps.map(describeToolMessage).join(" · ");
  const created = createdArtifacts(messages);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2 self-start">
    {created.map((artifact) => (
      <button
        key={artifact.id}
        className="self-start rounded-full border border-sky-500 bg-sky-950/40 px-4 py-2 text-sky-100 text-sm hover:bg-sky-900/60"
        type="button"
        onClick={() => onSelectArtifact(artifact.id)}
      >
        Abrir {kindLabel[artifact.kind] ?? artifact.kind}: {artifact.title}
      </button>
    ))}
    <details className={`w-full rounded-xl border px-3 py-2 text-sm ${failed ? "border-amber-900 text-amber-200" : "border-slate-800 text-slate-500"}`}>
      <summary className="cursor-pointer">
        {steps.length} {steps.length === 1 ? "paso" : "pasos"} del tutor: {summary}
      </summary>
      <ol className="mt-2 flex list-none flex-col gap-1 p-0">
        {messages.map((message, index) => (
          <li key={index} className="text-slate-400">
            <span aria-hidden="true">{message.role === "tool-call" ? "→ " : "← "}</span>
            {describeToolMessage(message)}
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-slate-500">
              {JSON.stringify(message.role === "tool-call" ? message.input : message.role === "tool-result" ? message.result : null, null, 2)}
            </pre>
          </li>
        ))}
      </ol>
    </details>
    </div>
  );
}

function MessageBubble({ message }: { readonly message: AgentMessage }) {
  if (message.role === "tool-call" || message.role === "tool-result") {
    return null;
  }

  return (
    <article className={message.role === "user"
      ? "max-w-3xl self-end rounded-2xl border border-blue-700 bg-blue-950 p-4"
      : "max-w-3xl self-start rounded-2xl border border-slate-800 bg-slate-900 p-4"}
    >
      <span className="mb-2 block font-bold text-sky-400 text-xs uppercase tracking-wide">
        {message.role === "user" ? "Tú" : "Tutor"}
      </span>
      <div className="text-slate-100 leading-7">
        <Streamdown>{message.content}</Streamdown>
      </div>
    </article>
  );
}
