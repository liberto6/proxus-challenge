import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { folderOf, generalFolderId, type AgentSession } from "@proxus/shared";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { ArtifactWorkspace, type AskTutorContext } from "./components/ArtifactWorkspace.tsx";
import { Chat, type ChatPrefill, type ChatSession } from "./components/Chat.tsx";
import { FolderSwitcher } from "./components/FolderSwitcher.tsx";
import { Icon } from "./components/icons.tsx";
import { Brand, MaterialsSection, PracticeList, SessionsSection, Sidebar, type FolderContext } from "./components/Sidebar.tsx";
import { artifactsQuery } from "./domain/artifacts/atoms.ts";
import { foldersQuery, sessionsQuery } from "./domain/folders/atoms.ts";
import { rememberCurrent, rememberedFolderId, rememberedSessionId } from "./domain/folders/current.ts";
import { materialsQuery } from "./domain/materials/atoms.ts";
import { useMaterialUpload } from "./domain/materials/use-material-upload.tsx";
import { createSession, deleteSession, loadSession, resumeOrCreateSession } from "./domain/tutor/session.ts";
import { useLayoutMode } from "./lib/use-media-query.ts";

/**
 * The folder the student works in and the conversation inside it. Switching
 * folder starts a new conversation there; reloading resumes the last one.
 */
const useFolderSession = () => {
  const [folderId, setFolderId] = useState<string>(rememberedFolderId);
  const [state, setState] = useState<ChatSession["state"]>("loading");
  const [session, setSession] = useState<AgentSession | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const folders = useAtomValue(foldersQuery);
  const sessions = useAtomValue(sessionsQuery);
  const refreshSessions = useAtomRefresh(sessionsQuery);
  const request = useRef(0);

  // An empty conversation of the folder is reused instead of piling up one per visit.
  const emptySessionOf = (target: string): string | undefined =>
    AsyncResult.isSuccess(sessions)
      ? sessions.value.sessions.find((item) => folderOf(item) === target && item.messageCount === 0)?.id
      : undefined;
  const openOrCreate = (target: string) => async () => {
    const emptyId = emptySessionOf(target);
    if (emptyId !== undefined) {
      const stored = await loadSession(emptyId);
      if (stored !== undefined && stored.messages.length === 0) return stored;
    }
    return createSession(target);
  };

  const run = useCallback((work: () => Promise<AgentSession>) => {
    const id = ++request.current;
    setState("loading");
    setError(undefined);
    work()
      .then((next) => {
        if (id !== request.current) return;
        setSession(next);
        setState("ready");
        rememberCurrent(folderOf(next), next.id);
        refreshSessions();
      })
      .catch((cause) => {
        if (id !== request.current) return;
        setState("failed");
        setError(`No se pudo cargar la conversación: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
  }, [refreshSessions]);

  const selectFolder = (next: string) => {
    if (next === folderId) return;
    setFolderId(next);
    rememberCurrent(next, undefined);
    run(openOrCreate(next));
  };

  // A remembered folder that no longer exists falls back to General. Checked once,
  // when the list first arrives: later the list may lag behind a folder just created.
  const validated = useRef(false);
  useEffect(() => {
    if (validated.current || !AsyncResult.isSuccess(folders)) return;
    validated.current = true;
    if (!folders.value.folders.some((folder) => folder.id === folderId)) selectFolder(generalFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]);

  // First load: resume the remembered conversation of the folder, or create one.
  useEffect(() => {
    run(() => resumeOrCreateSession(folderId, rememberedSessionId()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);



  // "Nueva" on an already empty conversation keeps it: there is nothing to leave behind.
  const newSession = () => {
    if (session !== undefined && session.messages.length === 0 && state === "ready") return;
    run(openOrCreate(folderId));
  };
  const selectSession = (id: string) => {
    if (id === session?.id) return;
    run(async () => {
      const stored = await loadSession(id);
      if (stored === undefined) throw new Error("la conversación ya no existe");
      return stored;
    });
  };
  const removeSession = (id: string) => {
    run(async () => {
      await deleteSession(id);
      if (id !== session?.id && session !== undefined) return session;
      return createSession(folderId);
    });
  };
  const folderDeleted = (deleted: string) => {
    if (deleted === folderId) selectFolder(generalFolderId);
  };

  const chatSession: ChatSession = { state, session, error, retry: () => setAttempt((n) => n + 1) };
  const folder: FolderContext = {
    folderId,
    sessionId: session?.id,
    onSelectFolder: selectFolder,
    onFolderDeleted: folderDeleted,
    onSelectSession: selectSession,
    onNewSession: newSession,
    onRemoveSession: removeSession,
    sessionBusy: state === "loading"
  };
  return { chatSession, folder };
};

/**
 * Three zones: materials (left), the conversation (centre, never narrower than
 * 480 px) and the practice panel (right, only while an artifact is open).
 * Below 1280 px the panel slides over the chat; below 768 px everything is one
 * column with tabs.
 */
export function App() {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "practice">("chat");
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [prefill, setPrefill] = useState<ChatPrefill | undefined>();
  const layout = useLayoutMode();
  const { chatSession, folder } = useFolderSession();
  const uploader = useMaterialUpload(folder.folderId);
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);
  // While the list loads, assume there are materials so the onboarding does not flash.
  const hasMaterials = !AsyncResult.isSuccess(materials) || materials.value.materials.some((material) => folderOf(material) === folder.folderId);
  const artifactCount = AsyncResult.isSuccess(artifacts) ? artifacts.value.artifacts.filter((artifact) => folderOf(artifact) === folder.folderId).length : 0;

  // Leaving the conversation (new one, another folder) closes whatever was open.
  useEffect(() => {
    setSelectedArtifactId(null);
  }, [chatSession.session?.id]);

  const openArtifact = (id: string) => {
    setSelectedArtifactId(id);
    setMobileTab("practice");
    setMaterialsOpen(false);
  };
  const closeArtifact = () => setSelectedArtifactId(null);
  const askTutor = (text: string, context?: AskTutorContext) => {
    setPrefill({ text, nonce: Date.now(), ...context });
    if (layout === "mobile") setMobileTab("chat");
    if (layout === "compact") setSelectedArtifactId(null);
  };
  // On phones the picker lives in the materials sheet, so open the sheet instead
  // of clicking an input that is about to unmount.
  const requestUpload = () => {
    if (layout === "mobile") setMaterialsOpen(true);
    else uploader.openPicker();
  };

  useEffect(() => {
    if (selectedArtifactId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeArtifact();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedArtifactId]);

  if (layout === "mobile") {
    return (
      <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-canvas">
        {materialsOpen
          ? (
              <Sheet title="Carpeta" onBack={() => setMaterialsOpen(false)}>
                <div className="flex flex-col gap-6">
                  <FolderSwitcher folderId={folder.folderId} onSelect={folder.onSelectFolder} onDeleted={folder.onFolderDeleted} />
                  <MaterialsSection folderId={folder.folderId} uploader={uploader} />
                  <SessionsSection folder={folder} />
                </div>
              </Sheet>
            )
          : mobileTab === "chat"
            ? (
                <Chat
                  chatSession={chatSession}
                  selectedArtifactId={selectedArtifactId}
                  onSelectArtifact={openArtifact}
                  hasMaterials={hasMaterials}
                  onRequestUpload={requestUpload}
                  prefill={prefill}
                  mobile
                  headerExtra={
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setMaterialsOpen(true)}>
                      <Icon name="pdf" size={16} /> Carpeta
                    </button>
                  }
                />
              )
            : selectedArtifactId !== null
              ? <ArtifactWorkspace artifactId={selectedArtifactId} onClose={closeArtifact} onAskTutor={askTutor} />
              : (
                  <Sheet title="Práctica">
                    <PracticeList folderId={folder.folderId} selectedArtifactId={selectedArtifactId} onSelectArtifact={openArtifact} />
                  </Sheet>
                )}
        {!materialsOpen && uploader.input}
        <nav className="grid h-[60px] grid-cols-2 border-ink border-t-2 bg-paper pb-[env(safe-area-inset-bottom)]" aria-label="Secciones">
          <button className={`mobile-tab ${mobileTab === "chat" ? "mobile-tab-active" : ""}`} type="button" onClick={() => { setMobileTab("chat"); setMaterialsOpen(false); }} aria-current={mobileTab === "chat" ? "page" : undefined}>
            <span className="mobile-tab-pill"><Icon name="chat" size={18} /></span>
            Chat
          </button>
          <button className={`mobile-tab ${mobileTab === "practice" ? "mobile-tab-active" : ""}`} type="button" onClick={() => { setMobileTab("practice"); setMaterialsOpen(false); }} aria-current={mobileTab === "practice" ? "page" : undefined}>
            <span className="mobile-tab-pill"><Icon name="quiz" size={18} /></span>
            {artifactCount > 0 ? `Práctica · ${artifactCount}` : "Práctica"}
          </button>
        </nav>
      </div>
    );
  }

  const wide = layout === "wide";
  const showPanelColumn = wide && selectedArtifactId !== null;

  return (
    <div
      className="grid h-dvh overflow-hidden bg-canvas"
      style={{
        gridTemplateColumns: showPanelColumn
          ? "280px minmax(480px, 1fr) minmax(440px, 36%)"
          : `${wide ? 280 : 240}px minmax(0, 1fr)`
      }}
    >
      <Sidebar folder={folder} uploader={uploader} selectedArtifactId={selectedArtifactId} onSelectArtifact={openArtifact} />
      <Chat
        chatSession={chatSession}
        selectedArtifactId={selectedArtifactId}
        onSelectArtifact={openArtifact}
        hasMaterials={hasMaterials}
        onRequestUpload={requestUpload}
        prefill={prefill}
      />
      {showPanelColumn && (
        <div className="min-h-0 min-w-0 border-ink border-l-2">
          <ArtifactWorkspace artifactId={selectedArtifactId} onClose={closeArtifact} onAskTutor={askTutor} />
        </div>
      )}
      {!wide && selectedArtifactId !== null && (
        <div className="fixed inset-0 z-20 flex justify-end bg-ink/35" onClick={closeArtifact}>
          <div className="h-full w-[480px] max-w-full border-ink border-l-2 shadow-hard-lg" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Panel de práctica">
            <ArtifactWorkspace artifactId={selectedArtifactId} onClose={closeArtifact} onAskTutor={askTutor} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-screen page on phones with a header and an optional back button. */
function Sheet({ title, onBack, children }: { readonly title: string; readonly onBack?: () => void; readonly children: ReactNode }) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-paper" aria-label={title}>
      <header className="flex h-14 items-center gap-2 border-ink border-b-2 px-3">
        {onBack !== undefined
          ? (
              <button className="icon-btn text-ink" type="button" onClick={onBack} aria-label="Volver al chat">
                <Icon name="back" size={18} />
              </button>
            )
          : <Brand compact />}
        {onBack !== undefined && <h1 className="font-display font-semibold text-base">{title}</h1>}
      </header>
      <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>
    </section>
  );
}
