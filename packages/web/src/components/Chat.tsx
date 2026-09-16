import { useAtomRefresh } from "@effect/atom-react";
import { isArtifactKind, type AgentMessage, type AgentSession, type ArtifactKind } from "@proxus/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { describeCompletedStep, describeToolMessage } from "../domain/tutor/activity.ts";
import { applyInvalidations, invalidationsForToolCall } from "../domain/tutor/invalidation.ts";
import { sessionsQuery } from "../domain/folders/atoms.ts";
import { streamTutorMessage } from "../domain/tutor/stream.ts";
import { pluralize } from "../lib/format.ts";
import { Icon, KindIcon, kindLabel, Mascot } from "./icons.tsx";

const starterPrompts = [
  "Resume mis materiales en pocas líneas",
  "Crea un quiz corto a partir de mis materiales",
  "Hazme un esquema de mis apuntes"
] as const;

interface TurnError {
  readonly message: string;
  /** Input to resend when the user clicks retry. */
  readonly input: string | undefined;
}

/** Text the workspace wants to send; `nonce` changes on each request so the same text can be sent twice. */
export interface ChatPrefill {
  readonly text: string;
  readonly nonce: number;
  /** Diagram node the question is about; sent as UI context with the next turn. */
  readonly nodeId?: string;
}

/** The conversation the chat shows; the app owns it (folder, creation, switching). */
export interface ChatSession {
  readonly state: "loading" | "ready" | "failed";
  readonly session: AgentSession | undefined;
  readonly error: string | undefined;
  /** Loads the folder's conversation again after a failure. */
  readonly retry: () => void;
}

interface ChatProps {
  readonly chatSession: ChatSession;
  /** Artifact open in the workspace, sent to the tutor as context. */
  readonly selectedArtifactId: string | null;
  readonly onSelectArtifact: (artifactId: string) => void;
  /** Whether the student has uploaded at least one PDF; drives the empty state. */
  readonly hasMaterials: boolean;
  readonly onRequestUpload: () => void;
  readonly prefill?: ChatPrefill | undefined;
  /** Compact header for phones: brand on the left, extra controls on the right. */
  readonly mobile?: boolean;
  readonly headerExtra?: ReactNode;
}

export function Chat({ chatSession, selectedArtifactId, onSelectArtifact, hasMaterials, onRequestUpload, prefill, mobile = false, headerExtra }: ChatProps) {
  const sessionId = chatSession.session?.id;
  const sessionState = chatSession.state;
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<readonly string[]>([]);
  const [error, setError] = useState<TurnError | undefined>();
  const [focusedNodeId, setFocusedNodeId] = useState<string | undefined>();
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const refreshSessions = useAtomRefresh(sessionsQuery);
  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const abortController = useRef<AbortController | undefined>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  /** False once the student scrolls up to read; new content then stops pulling the view down. */
  const stickToBottom = useRef(true);
  const ready = sessionState === "ready";
  const showEmptyState = messages.length === 0 && !isSending && sessionState !== "failed";

  // A different conversation (new one, another folder, reopened from the list) replaces the thread.
  useEffect(() => {
    abortController.current?.abort();
    setMessages(chatSession.session?.messages ?? []);
    setError(chatSession.error === undefined ? undefined : { message: chatSession.error, input: undefined });
    setInput("");
    setProgress([]);
  }, [chatSession.session?.id, chatSession.error]);

  // Keep the latest message and the live progress in view while the student is
  // at the bottom. Content grows after render (markdown, fonts), so follow the
  // thread's size instead of scrolling once.
  useEffect(() => {
    const container = scroller.current;
    const content = thread.current;
    if (container === null || content === null) return;
    const scrollDown = () => {
      if (stickToBottom.current) container.scrollTop = container.scrollHeight;
    };
    const onScroll = () => {
      stickToBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    };
    const observer = new ResizeObserver(scrollDown);
    observer.observe(content);
    container.addEventListener("scroll", onScroll, { passive: true });
    scrollDown();
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
    };
    // `showEmptyState` re-attaches the observer when the thread replaces the empty state.
  }, [sessionState, showEmptyState]);

  useEffect(() => {
    // A new turn always starts pinned to the bottom.
    if (isSending) stickToBottom.current = true;
    const container = scroller.current;
    if (container !== null && stickToBottom.current) container.scrollTop = container.scrollHeight;
  }, [messages, progress, isSending]);

  // Text sent from the workspace ("Explícame la pregunta 2").
  useEffect(() => {
    if (prefill === undefined) return;
    setInput(prefill.text);
    setFocusedNodeId(prefill.nodeId);
    textarea.current?.focus();
  }, [prefill]);

  useEffect(() => {
    autoGrow(textarea.current);
  }, [input]);

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
      const context = selectedArtifactId === null
        ? undefined
        : { openArtifactId: selectedArtifactId, ...(focusedNodeId === undefined ? {} : { openNodeId: focusedNodeId }) };
      for await (const event of streamTutorMessage({ sessionId, input: trimmed, maxSteps: 8, ...(context === undefined ? {} : { context }) }, controller.signal)) {
        switch (event.type) {
          case "message": {
            const message = event.message;
            turnMessages = [...turnMessages, message];
            setMessages([...historyBefore, ...turnMessages]);
            // A finished step is shown by its activity line; only in-flight labels stay live.
            if (message.role !== "tool-call") setProgress([]);

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
        setFocusedNodeId(undefined);
        // The conversation list shows the first message and the last activity.
        refreshSessions();
      } else {
        // Drop the failed turn so a retry does not duplicate the user message.
        setMessages(historyBefore);
        setError(turnFailed);
      }
    } catch (cause) {
      setMessages(historyBefore);
      if (controller.signal.aborted) {
        setError({ message: "Has detenido al tutor.", input: trimmed });
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
      textarea.current?.focus();
    }
  };

  const cancel = () => abortController.current?.abort();

  return (
    <section className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas" aria-label="Conversación con el tutor">
      <header className={`flex h-[60px] items-center justify-between gap-3 border-ink border-b-2 bg-paper ${mobile ? "px-3" : "px-6"}`}>
        {mobile
          ? (
              <div className="flex items-center gap-2">
                <Mascot size={30} />
                <span className="font-display font-semibold text-base">Proxus Tutor</span>
              </div>
            )
          : <h1 className="font-display font-semibold text-lg">Conversación</h1>}
        <div className="flex items-center gap-2">
          <SessionStatus state={sessionState} compact={mobile} />
          {headerExtra}
        </div>
      </header>

      <div ref={scroller} className={`dots flex min-h-0 flex-col overflow-y-auto ${mobile ? "px-3.5 pt-4 pb-2" : "px-6 pt-6 pb-2"}`}>
        {showEmptyState
          ? (
              <EmptyState
                loading={sessionState === "loading"}
                hasMaterials={hasMaterials}
                onRequestUpload={onRequestUpload}
                onPrompt={(prompt) => void submit(prompt)}
              />
            )
          : (
              <div ref={thread} className={`mx-auto flex w-full max-w-[760px] flex-col ${mobile ? "gap-3.5" : "gap-[18px]"}`}>
                {groupMessages(messages).map((group, index) => group.kind === "activity"
                  ? <ActivityGroup key={index} messages={group.messages} onSelectArtifact={onSelectArtifact} mobile={mobile} />
                  : <MessageBubble key={index} message={group.message} mobile={mobile} />)}
                {isSending && <LiveProgress labels={progress} mobile={mobile} />}
              </div>
            )}
      </div>

      <div className={`flex flex-col gap-2 ${mobile ? "px-3 pt-2 pb-2.5" : "px-6 pt-3 pb-5"}`}>
        {error !== undefined && (
          <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center justify-between gap-3 rounded-md border-2 border-rosa bg-rosa-soft px-4 py-2.5 text-rosa-ink" role="alert">
            <span className="flex min-w-0 flex-1 items-start gap-2 font-semibold text-sm">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
              <span className="break-words">{error.message}</span>
            </span>
            {error.input !== undefined && (
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void submit(error.input ?? "")} disabled={isSending}>
                Reintentar
              </button>
            )}
            {sessionState === "failed" && (
              <button className="btn btn-secondary btn-sm" type="button" onClick={chatSession.retry}>
                Reintentar
              </button>
            )}
          </div>
        )}

        <form
          className="mx-auto w-full max-w-[760px]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(input);
          }}
        >
          <div className={`composer-box ${mobile ? "flex-row items-center gap-2 py-1.5 pr-1.5 pl-3.5 shadow-none" : ""}`}>
            <textarea
              ref={textarea}
              className="max-h-40 w-full resize-none bg-transparent font-semibold outline-none placeholder:text-ink-subtle disabled:opacity-70"
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(input);
                }
              }}
              placeholder={!ready
                ? (sessionState === "loading" ? "Cargando la conversación…" : "La conversación no está disponible")
                : !hasMaterials && messages.length === 0
                  ? "Sube un PDF para empezar a preguntar"
                  : "Pregunta algo a tu tutor…"}
              rows={1}
              disabled={!ready}
              aria-label="Mensaje para el tutor"
            />
            {mobile
              ? <SendButton isSending={isSending} disabled={!ready || (!isSending && input.trim().length === 0)} onCancel={cancel} />
              : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-bold text-ink-subtle text-xs">Intro para enviar · Mayús + Intro para saltar de línea</span>
                    <SendButton isSending={isSending} disabled={!ready || (!isSending && input.trim().length === 0)} onCancel={cancel} />
                  </div>
                )}
          </div>
        </form>
      </div>
    </section>
  );
}

const autoGrow = (element: HTMLTextAreaElement | null) => {
  if (element === null) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
};

function SendButton({ isSending, disabled, onCancel }: { readonly isSending: boolean; readonly disabled: boolean; readonly onCancel: () => void }) {
  return isSending
    ? (
        <button className="send-btn send-btn-stop" type="button" onClick={onCancel} aria-label="Detener al tutor" title="Detener">
          <Icon name="stop" size={16} />
        </button>
      )
    : (
        <button className="send-btn" type="submit" disabled={disabled} aria-label="Enviar" title="Enviar">
          <Icon name="send" size={16} strokeWidth={2.5} />
        </button>
      );
}

function SessionStatus({ state, compact }: { readonly state: "loading" | "ready" | "failed"; readonly compact: boolean }) {
  const [tone, icon, label] = state === "ready"
    ? ["text-mint-ink", "cloud" as const, "Guardada"]
    : state === "loading"
      ? ["text-ink-subtle", "spinner" as const, "Cargando…"]
      : ["text-rosa-ink", "alert" as const, "Sin guardar"];
  return (
    <span className={`flex items-center gap-1.5 font-extrabold text-sm ${tone}`} title={state === "ready" ? "La conversación se guarda en el servidor" : undefined}>
      <Icon name={icon} size={14} strokeWidth={2.2} />
      {!compact && label}
    </span>
  );
}

// --- Estado vacío ---------------------------------------------------------------------

function EmptyState({ loading, hasMaterials, onRequestUpload, onPrompt }: {
  readonly loading: boolean;
  readonly hasMaterials: boolean;
  readonly onRequestUpload: () => void;
  readonly onPrompt: (prompt: string) => void;
}) {
  if (!hasMaterials) {
    return (
      <div className="m-auto flex w-full max-w-[600px] flex-col items-center gap-3.5 py-6 text-center">
        <div className="relative">
          <Mascot size={88} />
          <span className="badge badge-sun sticker absolute -top-1.5 -right-14">¡Hola!</span>
        </div>
        <h2 className="font-display font-semibold text-[28px] leading-tight md:text-2xl">
          Sube tus apuntes y <span className="hl">empieza a estudiar</span> con tu tutor
        </h2>
        <p className="font-semibold text-ink-muted">
          Leo tus PDFs, te explico lo que no entiendes, te dibujo esquemas y te preparo quizzes y tests corregidos al momento.
        </p>
        <button className="btn btn-primary mt-1 h-11 text-[15px]" type="button" onClick={onRequestUpload}>
          <Icon name="upload" size={18} strokeWidth={2.2} /> Subir mi primer PDF
        </button>
        <div className="mt-2.5 grid w-full grid-cols-3 gap-3.5 max-md:grid-cols-1">
          <Step n={1} color="bg-coral-soft" title="Sube un PDF">Un tema, unos apuntes o unas diapositivas.</Step>
          <Step n={2} color="bg-sun-soft" title="Pregunta">«Explícame la página 3» o «resume el tema».</Step>
          <Step n={3} color="bg-mint-soft" title="Practica">Pide un quiz y corrígelo aquí mismo.</Step>
        </div>
      </div>
    );
  }

  return (
    <div className="m-auto flex w-full max-w-[640px] flex-col items-center gap-3.5 py-6 text-center">
      <Mascot size={72} />
      <h2 className="font-display font-semibold text-[26px] leading-tight">¿Qué estudiamos hoy?</h2>
      <p className="font-semibold text-ink-muted">Pregunta sobre tus materiales o pídeme un esquema, una nota, un quiz o un test.</p>
      <div className="mt-1 grid w-full grid-cols-3 gap-3 max-md:grid-cols-1">
        {starterPrompts.map((prompt) => (
          <button
            key={prompt}
            className="card-flat p-3.5 text-left font-bold text-sm transition hover:border-ink hover:bg-sun-soft disabled:opacity-50"
            type="button"
            disabled={loading}
            onClick={() => onPrompt(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Step({ n, color, title, children }: { readonly n: number; readonly color: string; readonly title: string; readonly children: string }) {
  return (
    <div className="step-card">
      <span className={`grid size-[26px] place-items-center rounded-full border-2 border-ink font-extrabold text-[13px] ${color}`}>{n}</span>
      <strong className="font-extrabold text-[15px]">{title}</strong>
      <span className="font-semibold text-ink-muted text-sm">{children}</span>
    </div>
  );
}

// --- Progreso en vivo ---------------------------------------------------------------------

/** Steps of the running turn; a "reintentando en N s" label counts down. */
function LiveProgress({ labels, mobile }: { readonly labels: readonly string[]; readonly mobile: boolean }) {
  const done = labels.slice(0, -1);
  const current = labels.at(-1) ?? "El tutor está pensando…";
  return (
    <div className={`flex flex-col gap-1.5 ${mobile ? "" : "pl-[46px]"}`} role="status" aria-live="polite">
      {done.map((label, index) => <ActivityLine key={index} state="done" text={label} />)}
      <ActivityLine state="live" text={<Countdown label={current} />} />
    </div>
  );
}

function Countdown({ label }: { readonly label: string }) {
  const [text, setText] = useState(label);

  useEffect(() => {
    const match = /reintentando en (\d+) s/.exec(label);
    if (match === null) {
      setText(label);
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

  return <>{text}</>;
}

function ActivityLine({ state, text }: { readonly state: "done" | "live" | "failed" | "pending"; readonly text: ReactNode }) {
  const icon = state === "live" ? "spinner" : state === "done" ? "check" : state === "failed" ? "close" : "eye";
  return (
    <div className="flex items-center gap-2 font-bold text-ink-muted text-sm">
      <span className={`activity-dot ${state === "done" ? "activity-dot-done" : state === "live" ? "activity-dot-live" : state === "failed" ? "activity-dot-failed" : ""}`}>
        <Icon name={icon} size={12} strokeWidth={3} />
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

// --- Mensajes -------------------------------------------------------------------------------

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

interface CreatedArtifact {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  /** "3 preguntas", "6 conceptos"; undefined for notes. */
  readonly size: string | undefined;
}

/** Artifacts created during a turn, taken from `artifacts create` results. */
const createdArtifacts = (messages: readonly AgentMessage[]): ReadonlyArray<CreatedArtifact> =>
  messages.flatMap((message) => {
    if (message.role !== "tool-result" || message.isFailure) return [];
    const result = typeof message.result === "string" ? safeJson(message.result) : message.result;
    const typed = result as { created?: unknown; id?: unknown; kind?: unknown; title?: unknown; questionCount?: unknown; nodeCount?: unknown; keyPointCount?: unknown } | undefined;
    if (typed?.created !== true || typeof typed.id !== "string" || !isArtifactKind(typed.kind) || typeof typed.title !== "string") return [];
    const size = typeof typed.questionCount === "number"
      ? pluralize(typed.questionCount, "pregunta", "preguntas")
      : typeof typed.nodeCount === "number"
        ? pluralize(typed.nodeCount, "concepto", "conceptos")
        : typeof typed.keyPointCount === "number"
          ? pluralize(typed.keyPointCount, "punto clave", "puntos clave")
          : undefined;
    return [{ id: typed.id, kind: typed.kind, title: typed.title, size }];
  });

const openArticle: Record<ArtifactKind, string> = { note: "la nota", quiz: "el quiz", test: "el test", diagram: "el esquema", explain: "la explicación" };

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

interface ActivityStep {
  readonly call: Extract<AgentMessage, { role: "tool-call" }>;
  readonly result: Extract<AgentMessage, { role: "tool-result" }> | undefined;
}

/** Pairs each tool call with its result by id (falling back to order). */
const pairSteps = (messages: readonly AgentMessage[]): readonly ActivityStep[] => {
  const results = messages.filter((message): message is Extract<AgentMessage, { role: "tool-result" }> => message.role === "tool-result");
  const used = new Set<number>();
  return messages
    .filter((message): message is Extract<AgentMessage, { role: "tool-call" }> => message.role === "tool-call")
    .map((call) => {
      let index = results.findIndex((result, i) => !used.has(i) && result.id === call.id);
      if (index === -1) index = results.findIndex((_, i) => !used.has(i));
      if (index !== -1) used.add(index);
      return { call, result: index === -1 ? undefined : results[index] };
    });
};

function ActivityGroup({ messages, onSelectArtifact, mobile }: {
  readonly messages: readonly AgentMessage[];
  readonly onSelectArtifact: (artifactId: string) => void;
  readonly mobile: boolean;
}) {
  const steps = pairSteps(messages);
  // Skills are plumbing and in-flight steps are covered by the live progress.
  const visible = steps.filter((step) => step.call.name !== "load_skill" && step.result !== undefined);
  const created = createdArtifacts(messages);
  const indent = mobile ? "" : "pl-[46px]";

  return (
    <div className="flex flex-col gap-2.5">
      {visible.length > 0 && (
        <div className={`flex flex-col gap-1.5 ${indent}`}>
          {visible.map((step, index) => (
            <ActivityLine
              key={index}
              state={step.result === undefined ? "pending" : step.result.isFailure ? "failed" : "done"}
              text={describeCompletedStep(step.call, step.result)}
            />
          ))}
          <details className="group">
            <summary className="cursor-pointer list-none pl-7 font-bold text-ink-subtle text-sm hover:text-ink">
              <span className="group-open:hidden">Ver detalles</span>
              <span className="hidden group-open:inline">Ocultar detalles</span>
            </summary>
            <ol className="mt-2 flex list-none flex-col gap-2 p-0 pl-7">
              {steps.map((step, index) => (
                <li key={index} className="card-flat p-3 text-sm">
                  <div className="font-bold">{describeToolMessage(step.call)}</div>
                  {step.result !== undefined && (
                    <div className={`mt-0.5 font-semibold ${step.result.isFailure ? "text-rosa-ink" : "text-ink-muted"}`}>{describeToolMessage(step.result)}</div>
                  )}
                  <details className="mt-1.5">
                    <summary className="cursor-pointer font-bold text-ink-subtle text-xs">Datos técnicos</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-surface-3 p-2 font-mono text-[12px] text-ink-muted">
                      {JSON.stringify({ llamada: step.call.input, resultado: step.result?.result ?? null }, null, 2)}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
      {created.map((artifact) => (
        <div key={artifact.id} className={`card flex flex-wrap items-center gap-3 bg-lila-soft px-3.5 py-3 ${indent === "" ? "" : "ml-[46px]"}`}>
          <KindIcon kind={artifact.kind} className="bg-paper" />
          <div className="min-w-0 flex-1">
            <div className="font-extrabold text-[15px] leading-tight">{artifact.title}</div>
            <div className="font-semibold text-ink-muted text-sm">
              {kindLabel[artifact.kind]}{artifact.size !== undefined ? ` · ${artifact.size}` : ""}
            </div>
          </div>
          <button className={`btn btn-primary btn-sm ${mobile ? "h-10 w-full" : ""}`} type="button" onClick={() => onSelectArtifact(artifact.id)}>
            {mobile ? `Abrir ${openArticle[artifact.kind]}` : "Abrir"}
          </button>
        </div>
      ))}
    </div>
  );
}

function MessageBubble({ message, mobile }: { readonly message: AgentMessage; readonly mobile: boolean }) {
  if (message.role === "tool-call" || message.role === "tool-result") {
    return null;
  }

  if (message.role === "user") {
    return <div className={`bubble-user ${mobile ? "max-w-[85%]" : ""}`}>{message.content}</div>;
  }

  return (
    <article className="flex gap-2.5">
      <Mascot size={mobile ? 30 : 36} className="mt-0.5 shrink-0" />
      <div className={`bubble-tutor ${mobile ? "px-3 py-2.5 text-sm" : ""}`}>
        <div className="markdown">
          <Streamdown>{message.content}</Streamdown>
        </div>
      </div>
    </article>
  );
}
