import type { ArtifactKind } from "@proxus/shared";

/**
 * Iconos de trazo en rejilla de 24 px y la mascota del tutor, como SVG inline.
 * `currentColor` permite colorearlos desde la clase del contenedor.
 */
export type IconName =
  | "pdf"
  | "quiz"
  | "note"
  | "test"
  | "diagram"
  | "upload"
  | "trash"
  | "close"
  | "send"
  | "stop"
  | "check"
  | "eye"
  | "spinner"
  | "chevron"
  | "back"
  | "chat"
  | "cloud"
  | "spark"
  | "alert"
  | "plus"
  | "minus"
  | "download"
  | "expand"
  | "collapse";

const paths: Record<IconName, string> = {
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  quiz: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  note: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  test: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  diagram: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>',
  upload: '<path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  spinner: '<path d="M21 12a9 9 0 1 1-6.2-8.56"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 8a4 4 0 0 1 0 10z"/><path d="m9 13 2 2 4-4"/>',
  spark: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  download: '<path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/>',
  expand: '<path d="M15 3h6v6M9 21H3v-6"/><path d="M21 3l-7 7M3 21l7-7"/>',
  collapse: '<path d="M4 14h6v6M20 10h-6V4"/><path d="M14 10l7-7M3 21l7-7"/>'
};

export function Icon({ name, size = 16, className, strokeWidth = 2 }: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
  readonly strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === "spark" ? "currentColor" : "none"}
      stroke={name === "spark" ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${name === "spinner" ? "spin " : ""}${className ?? ""}`}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: paths[name] }}
    />
  );
}

/** Proxi, el tutor: un blob lila con ojos, sonrisa y un mechón amarillo. */
export function Mascot({ size = 36, className }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <path d="M24 4c11 0 20 8 20 19 0 12-9 21-20 21S4 35 4 23C4 12 13 4 24 4z" fill="#8B7CF6" stroke="#1F1B2D" strokeWidth="2.5" />
      <circle cx="17" cy="22" r="4.2" fill="#fff" stroke="#1F1B2D" strokeWidth="2" />
      <circle cx="31" cy="22" r="4.2" fill="#fff" stroke="#1F1B2D" strokeWidth="2" />
      <circle cx="18" cy="23" r="1.8" fill="#1F1B2D" />
      <circle cx="32" cy="23" r="1.8" fill="#1F1B2D" />
      <path d="M17 31c3 4 11 4 14 0" fill="none" stroke="#1F1B2D" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M22 5l2-4 2 4" fill="#FFC94D" stroke="#1F1B2D" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export const kindIcon: Record<ArtifactKind, IconName> = { note: "note", quiz: "quiz", test: "test", diagram: "diagram" };

export const kindLabel: Record<ArtifactKind, string> = { note: "Nota", quiz: "Quiz", test: "Test", diagram: "Esquema" };

/** Caja de color por tipo de artefacto, con su icono dentro. */
export function KindIcon({ kind, size = 34, className }: { readonly kind: ArtifactKind | "pdf"; readonly size?: number; readonly className?: string }) {
  const name: IconName = kind === "pdf" ? "pdf" : kindIcon[kind];
  return (
    <span className={`kind-icon kind-${kind} ${className ?? ""}`} style={{ width: size, height: size }}>
      <Icon name={name} size={Math.round(size * 0.53)} />
    </span>
  );
}
