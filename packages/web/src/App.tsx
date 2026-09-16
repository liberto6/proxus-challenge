import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState, type ReactNode } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { ArtifactWorkspace } from "./components/ArtifactWorkspace.tsx";
import { Chat, type ChatPrefill } from "./components/Chat.tsx";
import { Icon } from "./components/icons.tsx";
import { Brand, MaterialsSection, PracticeList, Sidebar } from "./components/Sidebar.tsx";
import { artifactsQuery } from "./domain/artifacts/atoms.ts";
import { materialsQuery } from "./domain/materials/atoms.ts";
import { useMaterialUpload } from "./domain/materials/use-material-upload.tsx";
import { useLayoutMode } from "./lib/use-media-query.ts";

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
  const uploader = useMaterialUpload();
  const materials = useAtomValue(materialsQuery);
  const artifacts = useAtomValue(artifactsQuery);
  // While the list loads, assume there are materials so the onboarding does not flash.
  const hasMaterials = !AsyncResult.isSuccess(materials) || materials.value.materials.length > 0;
  const artifactCount = AsyncResult.isSuccess(artifacts) ? artifacts.value.artifacts.length : 0;

  const openArtifact = (id: string) => {
    setSelectedArtifactId(id);
    setMobileTab("practice");
    setMaterialsOpen(false);
  };
  const closeArtifact = () => setSelectedArtifactId(null);
  const askTutor = (text: string, context?: { readonly nodeId: string }) => {
    setPrefill({ text, nonce: Date.now(), ...(context === undefined ? {} : { nodeId: context.nodeId }) });
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
              <Sheet title="Materiales" onBack={() => setMaterialsOpen(false)}>
                <MaterialsSection uploader={uploader} hideTitle />
              </Sheet>
            )
          : mobileTab === "chat"
            ? (
                <Chat
                  selectedArtifactId={selectedArtifactId}
                  onSelectArtifact={openArtifact}
                  hasMaterials={hasMaterials}
                  onRequestUpload={requestUpload}
                  prefill={prefill}
                  mobile
                  headerExtra={
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => setMaterialsOpen(true)}>
                      <Icon name="pdf" size={16} /> Materiales
                    </button>
                  }
                />
              )
            : selectedArtifactId !== null
              ? <ArtifactWorkspace artifactId={selectedArtifactId} onClose={closeArtifact} onAskTutor={askTutor} />
              : (
                  <Sheet title="Práctica">
                    <PracticeList selectedArtifactId={selectedArtifactId} onSelectArtifact={openArtifact} />
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
      <Sidebar uploader={uploader} selectedArtifactId={selectedArtifactId} onSelectArtifact={openArtifact} />
      <Chat
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
