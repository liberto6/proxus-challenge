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
  /\b(?:p[áa]g(?:ina|s?\.?)|pp?\.|pages?)\s*((?:\d{1,4})(?:\s*(?:[-–—]|a|to)\s*\d{1,4})?(?:\s*(?:,|y|and|e)\s*\d{1,4}(?:\s*(?:[-–—]|a|to)\s*\d{1,4})?)*)/giu;

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

/** Instruction injected when a draft answer cites pages that were not rendered. */
export const groundingReminder = (pages: readonly number[]): string =>
  [
    "GROUNDING CHECK FAILED.",
    `Your draft answer cited page(s) ${pages.join(", ")} that you have not rendered in this conversation.`,
    "You must not describe or cite the content of pages you have not read.",
    "Call the cli tool with `materials list` if you do not know the material id, then `materials view <materialId> <pages>` to render the cited pages, and answer again using only what the rendered pages show.",
    "If the material does not exist or the pages are out of range, say so instead of citing them."
  ].join(" ");

/** Note appended to an answer that still cites unrendered pages after the retry. */
export const groundingDisclaimer = (pages: readonly number[]): string =>
  `\n\n> Aviso: esta respuesta cita las páginas ${pages.join(", ")} sin haberlas leído en esta conversación. Pídeme que las lea para confirmar el contenido.`;
