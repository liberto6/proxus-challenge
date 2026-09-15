import { useAtomRefresh } from "@effect/atom-react";
import type { AgentMessage } from "@proxus/shared";
import { useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { describeToolMessage } from "../domain/tutor/activity.ts";
import { applyInvalidations, invalidationsForToolCall } from "../domain/tutor/invalidation.ts";
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

export function Chat() {
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<readonly string[]>([]);
  const [error, setError] = useState<TurnError | undefined>();
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const abortController = useRef<AbortController | undefined>(undefined);

  const submit = async (nextInput: string, history: readonly AgentMessage[] = messages) => {
    const trimmed = nextInput.trim();
    if (trimmed.length === 0 || isSending) {
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
      for await (const event of streamTutorMessage({ input: trimmed, messages: historyBefore, maxSteps: 8 }, controller.signal)) {
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
          <p className="mb-1 font-bold text-sky-400 text-xs uppercase tracking-widest">Sesión en memoria</p>
          <h1 className="m-0 font-bold text-3xl text-slate-100">Tutor académico</h1>
        </div>
        <button
          className="rounded-full border border-slate-700 px-4 py-2 text-slate-200 hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={() => { setMessages([]); setError(undefined); }}
          disabled={messages.length === 0 || isSending}
        >
          Limpiar chat
        </button>
      </header>

      <section className="flex flex-col gap-3 overflow-y-auto p-6" aria-live="polite">
        {messages.length === 0 && !isSending
          ? (
              <div className="m-auto w-full max-w-3xl text-center">
                <h2 className="m-0 text-balance font-bold text-4xl text-slate-100 leading-tight md:text-6xl">
                  Pregunta sobre tus materiales, notas, quizzes o tests.
                </h2>
                <p className="mt-4 text-slate-400">La conversación vive solo en la memoria del navegador. Al recargar se pierde.</p>
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
          : messages.map((message, index) => <MessageBubble key={index} message={message} />)}

        {isSending && (
          <div className="flex max-w-3xl items-center gap-3 self-start rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-slate-300 text-sm" role="status">
            <span className="inline-block size-2 animate-pulse rounded-full bg-sky-400" aria-hidden="true" />
            <span>{progress.at(-1) ?? "El tutor está pensando…"}</span>
          </div>
        )}
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
          disabled={isSending}
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
                disabled={input.trim().length === 0}
              >
                Enviar
              </button>
            )}
      </form>
    </main>
  );
}

function MessageBubble({ message }: { readonly message: AgentMessage }) {
  if (message.role === "tool-call" || message.role === "tool-result") {
    const failed = message.role === "tool-result" && message.isFailure;
    return (
      <details className={`w-full max-w-3xl self-start rounded-xl border px-3 py-2 text-sm ${failed ? "border-amber-900 text-amber-200" : "border-slate-800 text-slate-400"}`}>
        <summary className="cursor-pointer">
          <span aria-hidden="true">{message.role === "tool-call" ? "→ " : "← "}</span>
          {describeToolMessage(message)}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
          {JSON.stringify(message.role === "tool-call" ? message.input : message.result, null, 2)}
        </pre>
      </details>
    );
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
