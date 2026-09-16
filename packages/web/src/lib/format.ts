/** Formatting helpers for dates and study metadata shown to the student. */

const dayMs = 24 * 60 * 60 * 1000;

const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "hoy", "ayer", "hace 3 días" or "12 sep" from an ISO date; `undefined` when missing or invalid. */
export const relativeDay = (iso: string | undefined, now: Date = new Date()): string | undefined => {
  if (iso === undefined) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfToday - startOfThat) / dayMs);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return `${date.getDate()} ${monthNames[date.getMonth()]}`;
};

export const pluralize = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

/** "pág. 3", "pág. 1-3" or "pág. 1, 4" from a list of page numbers. */
export const formatPages = (pages: ReadonlyArray<number>): string | undefined => {
  if (pages.length === 0) return undefined;
  const sorted = [...pages].sort((a, b) => a - b);
  const contiguous = sorted.every((page, index) => index === 0 || page === (sorted[index - 1] ?? 0) + 1);
  if (sorted.length === 1) return `pág. ${sorted[0]}`;
  if (contiguous) return `pág. ${sorted[0]}-${sorted[sorted.length - 1]}`;
  return `pág. ${sorted.join(", ")}`;
};

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
