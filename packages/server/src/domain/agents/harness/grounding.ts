import { Context, Effect, Option } from "effect";
import { isMaterialPageImages } from "../../materials/material.ts";
import type { AgentMessage } from "./message.ts";

/**
 * Grounding guard: an answer may only cite material pages that were rendered
 * (read) during the conversation.
 *
 * The skill already tells the model to render pages before answering; this
 * module makes the rule checkable in code. It is deliberately narrow and
 * deterministic: it only looks at explicit page citations such as
 * "página 2", "páginas 1-3", "págs. 2 y 4", "p. 3" or "page 2". Claims that do
 * not name a page are outside its reach.
 */

export type RenderedPages = ReadonlyMap<string, ReadonlySet<number>>;

/** Pages rendered so far, per material id, taken from successful `materials view` results. */
export const renderedPages = (messages: readonly AgentMessage[]): RenderedPages => {
  const rendered = new Map<string, Set<number>>();

  for (const message of messages) {
    if (message.role !== "tool-result" || message.isFailure || !isMaterialPageImages(message.result)) {
      continue;
    }

    const pages = rendered.get(message.result.material.id) ?? new Set<number>();
    for (const page of message.result.pages) {
      pages.add(page.page);
    }
    rendered.set(message.result.material.id, pages);
  }

  return rendered;
};

const citationPattern =
  /\b(?:p[áa]g(?:inas?|s?\.?)|pp?\.|pages?)\s*((?:\d{1,4})(?:\s*(?:[-–—]|a|to)\s*\d{1,4})?(?:\s*(?:,|y|and|e)\s*\d{1,4}(?:\s*(?:[-–—]|a|to)\s*\d{1,4})?)*)/giu;

/** Page numbers explicitly cited in a text, in order of appearance, without duplicates. */
export const citedPages = (text: string): readonly number[] => {
  const pages = new Set<number>();

  for (const match of text.matchAll(citationPattern)) {
    const list = match[1] ?? "";
    for (const chunk of list.split(/\s*(?:,|\by\b|\band\b|\be\b)\s*/u)) {
      const range = /^(\d{1,4})\s*(?:[-–—]|a|to)\s*(\d{1,4})$/u.exec(chunk.trim());
      if (range !== null) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (to >= from && to - from <= 50) {
          for (let page = from; page <= to; page++) {
            pages.add(page);
          }
        }
        continue;
      }

      const single = /^(\d{1,4})$/u.exec(chunk.trim());
      if (single !== null) {
        pages.add(Number(single[1]));
      }
    }
  }

  return [...pages];
};

/**
 * Pages rendered so far in the running conversation, for commands that must
 * only accept content anchored to what was read (diagrams). The session
 * provides it on every model step; when absent (CLI, evals) commands skip the
 * check, like progress events are dropped without a sink.
 */
export interface RenderedPagesRef {
  readonly pages: RenderedPages;
}

export const RenderedPagesRef = Context.Service<RenderedPagesRef>("@proxus/server/agents/harness/RenderedPagesRef");

/** Pages rendered for one material in this conversation, or `undefined` when the session does not track them. */
export const renderedPagesOf = (materialId: string): Effect.Effect<ReadonlySet<number> | undefined> =>
  Effect.serviceOption(RenderedPagesRef).pipe(
    Effect.map((ref) => Option.isSome(ref) ? ref.value.pages.get(materialId) ?? new Set<number>() : undefined)
  );

/** Cited pages that were not rendered for any material during the conversation. */
export const ungroundedCitations = (text: string, rendered: RenderedPages): readonly number[] => {
  const cited = citedPages(text);
  if (cited.length === 0) {
    return [];
  }

  const renderedAnywhere = new Set<number>();
  for (const pages of rendered.values()) {
    for (const page of pages) {
      renderedAnywhere.add(page);
    }
  }

  return cited.filter((page) => !renderedAnywhere.has(page));
};

/** What the conversation knows about a material: from `materials list` lines and `materials view` results. */
export interface KnownMaterial {
  readonly id: string;
  readonly title: string;
  readonly pageCount: number;
}

const listLinePattern = /^- (\S+): (.+) \((\d+) pages?, file: /gmu;

/**
 * Materials seen so far in the conversation, with their page counts. Page counts
 * let the guard tell "you did not read that page" from "no material has that
 * page", which points at the usual cause: the number printed on the paper, or
 * pages counted across several PDFs, instead of the position in the PDF.
 */
export const knownMaterials = (messages: readonly AgentMessage[]): ReadonlyMap<string, KnownMaterial> => {
  const materials = new Map<string, KnownMaterial>();

  for (const message of messages) {
    if (message.role !== "tool-result" || message.isFailure) {
      continue;
    }
    if (isMaterialPageImages(message.result)) {
      const material = message.result.material;
      materials.set(material.id, { id: material.id, title: material.title, pageCount: material.pageCount });
      continue;
    }
    if (typeof message.result === "string") {
      for (const line of message.result.matchAll(listLinePattern)) {
        const [, id, title, pageCount] = line;
        if (id !== undefined && title !== undefined && pageCount !== undefined) {
          materials.set(id, { id, title, pageCount: Number(pageCount) });
        }
      }
    }
  }

  return materials;
};

export interface CitationCheck {
  /** Cited pages not rendered for any material. */
  readonly ungrounded: readonly number[];
  /** Ungrounded pages beyond the longest known material (only when some material is known). */
  readonly outOfRange: readonly number[];
  readonly materials: readonly KnownMaterial[];
}

/** Grounding check of a draft answer against what the conversation has read and knows. */
export const checkCitations = (text: string, rendered: RenderedPages, materials: ReadonlyMap<string, KnownMaterial>): CitationCheck => {
  const ungrounded = ungroundedCitations(text, rendered);
  const known = [...materials.values()];
  const longest = known.reduce((max, material) => Math.max(max, material.pageCount), 0);
  return {
    ungrounded,
    outOfRange: longest === 0 ? [] : ungrounded.filter((page) => page > longest),
    materials: known
  };
};

/** "61-95" instead of thirty-five numbers: consecutive pages become a range. */
export const formatPageList = (pages: readonly number[]): string => {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let index = 0; index < sorted.length;) {
    const start = sorted[index] ?? 0;
    let end = start;
    while (index + 1 < sorted.length && sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index] ?? end;
    }
    parts.push(end - start >= 2 ? `${start}-${end}` : end === start ? `${start}` : `${start}, ${end}`);
    index += 1;
  }
  return parts.join(", ");
};

const describeMaterials = (materials: readonly KnownMaterial[]): string =>
  materials.map((material) => `${material.title}: ${material.pageCount} ${material.pageCount === 1 ? "página" : "páginas"}`).join("; ");

/** Instruction injected when a draft answer cites pages that were not rendered. */
export const groundingReminder = (check: CitationCheck): string =>
  [
    "GROUNDING CHECK FAILED.",
    `Your draft answer cited page(s) ${formatPageList(check.ungrounded)} that you have not rendered in this conversation.`,
    "You must not describe or cite the content of pages you have not read.",
    "Cite pages by their position in the PDF (1..N, the numbers `materials list` and `materials view` use), never by the number printed on the page, and never by counting pages across several materials. When several materials are loaded, say which one you cite.",
    ...(check.outOfRange.length === 0
      ? []
      : [`No loaded material has page(s) ${formatPageList(check.outOfRange)} (${check.materials.map((material) => `${material.id}: ${material.pageCount} pages`).join(", ")}); you were probably reading printed page numbers or counting across materials. Use the PDF positions you actually rendered.`]),
    "Call the cli tool with `materials list` if you do not know the material id, then `materials view <materialId> <pages>` to render the cited pages, and answer again using only what the rendered pages show.",
    "If the material does not exist or the pages are out of range, say so instead of citing them."
  ].join(" ");

/** Note appended to an answer that still cites unrendered pages after the retry. */
export const groundingDisclaimer = (check: CitationCheck): string => {
  const pages = formatPageList(check.ungrounded);
  if (check.outOfRange.length > 0) {
    return `\n\n> Aviso: esta respuesta cita las páginas ${pages}, pero ningún material de esta conversación tiene tantas páginas (${describeMaterials(check.materials)}). Es probable que use la numeración impresa en el papel o que sume las páginas de varios PDF. Pídeme que lea las páginas por su posición en el PDF para confirmar el contenido.`;
  }
  return `\n\n> Aviso: esta respuesta cita las páginas ${pages} sin haberlas leído en esta conversación. Pídeme que las lea para confirmar el contenido.`;
};
