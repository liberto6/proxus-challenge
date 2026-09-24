import { useEffect } from "react";

/**
 * Runs `onEscape` on Escape while `active`. Captured at the document and stopped
 * there, so the app's own Escape handler (which closes the practice panel) does
 * not also fire: one Escape leaves the full-screen view, the next closes the panel.
 */
export const useEscape = (active: boolean, onEscape: () => void): void => {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onEscape();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, onEscape]);
};
