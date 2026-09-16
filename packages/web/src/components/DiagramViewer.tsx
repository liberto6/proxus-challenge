import type { DiagramArtifact, DiagramNode } from "@proxus/shared";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { layoutDiagram, splitTransitions, type DiagramLayout, type LayoutEdge, type LayoutNode } from "../domain/diagrams/layout.ts";
import { toMermaid } from "../domain/diagrams/mermaid.ts";
import { formatPages } from "../lib/format.ts";
import { Icon } from "./icons.tsx";

export interface DiagramViewerProps {
  readonly artifact: DiagramArtifact;
  /** Sends a question about a node to the tutor chat. */
  readonly onAskTutor: (text: string, nodeId: string) => void;
  /** Opens a page of the source material next to the node; undefined when the material is gone. */
  readonly onOpenPage?: ((page: number, nodeId: string) => void) | undefined;
  /** Page currently previewed, to mark its chip. */
  readonly openPage?: number | undefined;
}

type ViewMode = "diagram" | "list";

interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Explorable drawing of a diagram: pan and zoom, focus on a node (its
 * neighbours stay lit, the rest dims), follow relations from the node card,
 * switch to the reading list, export as SVG or Mermaid.
 */
export function DiagramViewer({ artifact, onAskTutor, onOpenPage, openPage }: DiagramViewerProps) {
  const layout = useMemo(() => layoutDiagram(artifact), [artifact]);
  const [mode, setMode] = useState<ViewMode>("diagram");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [viewBox, setViewBox] = useState<ViewBox>(() => fullView(layout));
  const [copied, setCopied] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | undefined>(undefined);

  const nodesById = useMemo(() => new Map(artifact.nodes.map((node) => [node.id, node])), [artifact]);
  const selected = selectedId === undefined ? undefined : nodesById.get(selectedId);
  const neighbours = useMemo(() => selectedId === undefined ? new Set<string>() : new Set(relationsOf(artifact, selectedId).map((relation) => relation.other)), [artifact, selectedId]);

  // Wheel zoom must cancel the page scroll, which React's passive onWheel cannot do.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = toSvgPoint(svg, event.clientX, event.clientY);
      setViewBox((current) => zoomAt(current, layout, event.deltaY > 0 ? 1.15 : 1 / 1.15, point));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [layout]);

  const select = (id: string | undefined) => setSelectedId(id);

  const centerOn = (id: string) => {
    const box = layout.nodes.find((node) => node.id === id);
    if (box === undefined) return;
    setViewBox((current) => ({
      ...current,
      x: box.x + box.width / 2 - current.width / 2,
      y: box.y + box.height / 2 - current.height / 2
    }));
  };

  const follow = (id: string) => {
    select(id);
    centerOn(id);
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (state === undefined || state.pointerId !== event.pointerId) return;
    const svg = event.currentTarget;
    const scale = viewBox.width / svg.clientWidth;
    const dx = (event.clientX - state.x) * scale;
    const dy = (event.clientY - state.y) * scale;
    if (Math.abs(event.clientX - state.x) + Math.abs(event.clientY - state.y) > 3) state.moved = true;
    drag.current = { ...state, x: event.clientX, y: event.clientY };
    setViewBox((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    drag.current = undefined;
    if (state !== undefined && !state.moved && event.target === event.currentTarget) {
      select(undefined);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = viewBox.width * 0.1;
    const pans: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const pan = pans[event.key];
    if (pan !== undefined) {
      event.preventDefault();
      setViewBox((current) => ({ ...current, x: current.x + pan[0], y: current.y + pan[1] }));
    } else if (event.key === "Escape") {
      select(undefined);
    } else if (event.key === "+" || event.key === "=") {
      setViewBox((current) => zoomAt(current, layout, 1 / 1.2));
    } else if (event.key === "-") {
      setViewBox((current) => zoomAt(current, layout, 1.2));
    }
  };

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (svg === null) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
    clone.setAttribute("width", String(layout.width));
    clone.setAttribute("height", String(layout.height));
    clone.querySelectorAll("[data-dim]").forEach((element) => element.removeAttribute("opacity"));
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug(artifact.title)}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(toMermaid(artifact));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="segmented" role="tablist" aria-label="Vista del esquema">
          <button type="button" role="tab" aria-selected={mode === "diagram"} className={mode === "diagram" ? "segmented-on" : ""} onClick={() => setMode("diagram")}>Esquema</button>
          <button type="button" role="tab" aria-selected={mode === "list"} className={mode === "list" ? "segmented-on" : ""} onClick={() => setMode("list")}>Lista</button>
        </div>
        {mode === "diagram" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="icon-btn text-ink" type="button" aria-label="Reducir" title="Reducir (−)" onClick={() => setViewBox((current) => zoomAt(current, layout, 1.2))}><Icon name="minus" size={16} strokeWidth={2.4} /></button>
            <button className="icon-btn text-ink" type="button" aria-label="Ampliar" title="Ampliar (+)" onClick={() => setViewBox((current) => zoomAt(current, layout, 1 / 1.2))}><Icon name="plus" size={16} strokeWidth={2.4} /></button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setViewBox(fullView(layout))}>Ajustar</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={downloadSvg} title="Descargar como imagen SVG"><Icon name="download" size={14} /> SVG</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void copyMermaid()} title="Copiar el esquema en formato Mermaid">{copied ? "Copiado" : "Mermaid"}</button>
          </div>
        )}
      </div>

      {mode === "list"
        ? <DiagramList artifact={artifact} onAskTutor={onAskTutor} onOpenPage={onOpenPage} />
        : (
            <>
              <div
                className="diagram-stage"
                tabIndex={0}
                onKeyDown={onKeyDown}
                aria-label="Esquema interactivo. Arrastra para mover, rueda para ampliar, flechas para desplazar."
              >
                <svg
                  ref={svgRef}
                  className="block h-full w-full touch-none select-none"
                  viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label={`${artifact.title}: ${artifact.summary}`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => { drag.current = undefined; }}
                  onDoubleClick={(event) => { if (event.target === event.currentTarget) setViewBox(fullView(layout)); }}
                  style={{ fontFamily: "Nunito, system-ui, sans-serif", cursor: drag.current === undefined ? "grab" : "grabbing" }}
                >
                  <defs>
                    <marker id="diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={palette.inkMuted} />
                    </marker>
                    <marker id="diagram-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill={palette.ink} />
                    </marker>
                  </defs>
                  {layout.edges.map((edge) => (
                    <EdgeShape
                      key={edge.id}
                      edge={edge}
                      state={selectedId === undefined ? "normal" : edge.from === selectedId || edge.to === selectedId ? "lit" : "dim"}
                    />
                  ))}
                  {layout.nodes.map((box) => {
                    const node = nodesById.get(box.id);
                    if (node === undefined) return null;
                    return (
                      <NodeShape
                        key={box.id}
                        box={box}
                        node={node}
                        state={selectedId === undefined ? "normal" : box.id === selectedId ? "selected" : neighbours.has(box.id) ? "lit" : "dim"}
                        onSelect={() => select(box.id === selectedId ? undefined : box.id)}
                      />
                    );
                  })}
                </svg>
              </div>

              {selected === undefined
                ? <p className="font-semibold text-ink-subtle text-sm">Toca un concepto para ver su explicación, sus páginas y sus relaciones.</p>
                : (
                    <NodeCard
                      artifact={artifact}
                      node={selected}
                      openPage={openPage}
                      onFollow={follow}
                      onOpenPage={onOpenPage}
                      onAskTutor={onAskTutor}
                      onClose={() => select(undefined)}
                    />
                  )}
            </>
          )}
    </div>
  );
}

// --- SVG shapes ---------------------------------------------------------------------

/** Mirror of the colour tokens in styles.input.css, as literal values so the exported SVG keeps them. */
const palette = {
  ink: "#1f1b2d",
  inkMuted: "#5b5670",
  paper: "#ffffff",
  lilaSoft: "#eeebff",
  lilaInk: "#4b3db8",
  sunSoft: "#fff1c2",
  sun: "#ffc94d"
} as const;

type NodeState = "normal" | "selected" | "lit" | "dim";

function NodeShape({ box, node, state, onSelect }: {
  readonly box: LayoutNode;
  readonly node: DiagramNode;
  readonly state: NodeState;
  readonly onSelect: () => void;
}) {
  const fill = box.role === "step" ? palette.lilaSoft : box.role === "root" ? palette.sunSoft : palette.paper;
  const lines = wrapLabel(node.label);
  const lineHeight = 15;
  const firstY = box.y + box.height / 2 - ((lines.length - 1) * lineHeight) / 2 + 5;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${node.label}. ${node.description}`}
      aria-pressed={state === "selected"}
      data-dim={state === "dim" ? "true" : undefined}
      opacity={state === "dim" ? 0.35 : 1}
      style={{ cursor: "pointer", transition: "opacity 120ms ease-out" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <rect x={box.x + 3} y={box.y + 3} width={box.width} height={box.height} rx={10} fill={palette.ink} />
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={10}
        fill={fill}
        stroke={state === "selected" ? palette.sun : palette.ink}
        strokeWidth={state === "selected" ? 4 : 2}
      />
      {box.step !== undefined && (
        <>
          <circle cx={box.x + 2} cy={box.y + 2} r={11} fill={palette.sun} stroke={palette.ink} strokeWidth={2} />
          <text x={box.x + 2} y={box.y + 6} textAnchor="middle" fontSize={11} fontWeight={800} fill={palette.ink}>{box.step}</text>
        </>
      )}
      {lines.map((line, index) => (
        <text
          key={index}
          x={box.x + box.width / 2}
          y={firstY + index * lineHeight}
          textAnchor="middle"
          fontSize={13}
          fontWeight={800}
          fill={palette.ink}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function EdgeShape({ edge, state }: { readonly edge: LayoutEdge; readonly state: "normal" | "lit" | "dim" }) {
  const stroke = state === "lit" ? palette.ink : palette.inkMuted;
  const width = edge.kind === "main" ? (state === "lit" ? 3.5 : 2.5) : state === "lit" ? 3 : 2;
  return (
    <g data-dim={state === "dim" ? "true" : undefined} opacity={state === "dim" ? 0.25 : 1} style={{ transition: "opacity 120ms ease-out" }}>
      <path
        d={edge.path}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={edge.kind === "side" ? "6 5" : undefined}
        markerEnd={`url(#${state === "lit" ? "diagram-arrow-lit" : "diagram-arrow"})`}
      />
      {edge.label !== undefined && (
        <text
          x={edge.labelX}
          y={edge.labelY + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={palette.inkMuted}
          stroke={palette.paper}
          strokeWidth={4}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

/** Splits a label into at most two lines that fit a 150 px box at 13 px bold. */
const wrapLabel = (label: string): readonly string[] => {
  const maxChars = 19;
  if (label.length <= maxChars) return [label];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length <= 2) return lines;
  const second = lines.slice(1).join(" ");
  return [lines[0]!, second.length > maxChars ? `${second.slice(0, maxChars - 1)}…` : second];
};

// --- Node card ---------------------------------------------------------------------

function NodeCard({ artifact, node, openPage, onFollow, onOpenPage, onAskTutor, onClose }: {
  readonly artifact: DiagramArtifact;
  readonly node: DiagramNode;
  readonly openPage: number | undefined;
  readonly onFollow: (id: string) => void;
  readonly onOpenPage: ((page: number, nodeId: string) => void) | undefined;
  readonly onAskTutor: (text: string, nodeId: string) => void;
  readonly onClose: () => void;
}) {
  const relations = relationsOf(artifact, node.id);
  const labels = new Map(artifact.nodes.map((candidate) => [candidate.id, candidate.label]));
  return (
    <section className="card flex flex-col gap-2.5 p-4" aria-label={`Concepto: ${node.label}`} aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-display font-semibold text-lg leading-tight">{node.label}</h4>
        <button className="icon-btn text-ink" type="button" onClick={onClose} aria-label="Cerrar la ficha del concepto"><Icon name="close" size={14} strokeWidth={2.4} /></button>
      </div>
      <p className="font-semibold text-[15px] leading-snug">{node.description}</p>
      <PageChips node={node} openPage={openPage} onOpenPage={onOpenPage} />
      {relations.length > 0 && (
        <ul className="flex list-none flex-col gap-1 p-0" aria-label="Relaciones">
          {relations.map((relation, index) => (
            <li key={index}>
              <button className="text-left font-semibold text-ink-muted text-sm hover:text-ink" type="button" onClick={() => onFollow(relation.other)}>
                {relation.direction === "out" ? "→ " : "← "}
                <span className="text-ink underline decoration-2 decoration-sun underline-offset-2">{labels.get(relation.other) ?? relation.other}</span>
                {relation.label !== undefined ? ` · ${relation.label}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onAskTutor(`Explícame «${node.label}» del esquema «${artifact.title}»`, node.id)}>
          <Icon name="spark" size={14} /> Preguntar al tutor
        </button>
      </div>
    </section>
  );
}

function PageChips({ node, openPage, onOpenPage }: {
  readonly node: DiagramNode;
  readonly openPage: number | undefined;
  readonly onOpenPage: ((page: number, nodeId: string) => void) | undefined;
}) {
  if (node.pages.length === 0) return null;
  const pages = [...node.pages].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Páginas del material">
      {onOpenPage === undefined
        ? <span className="badge badge-neutral" title="El material ya no está disponible">{formatPages(pages)} · material eliminado</span>
        : pages.map((page) => (
            <button
              key={page}
              className={`badge ${openPage === page ? "badge-sun" : "badge-neutral"} cursor-pointer hover:border-ink`}
              type="button"
              onClick={() => onOpenPage(page, node.id)}
              aria-pressed={openPage === page}
              title={`Ver la página ${page} del material`}
            >
              <Icon name="eye" size={12} /> pág. {page}
            </button>
          ))}
    </div>
  );
}

// --- Reading list ------------------------------------------------------------------

/**
 * Reading view of a diagram: the same nodes and relations as the drawing, in
 * reading order. It is the accessible view and the one used on narrow screens.
 */
export function DiagramList({ artifact, onAskTutor, onOpenPage }: {
  readonly artifact: DiagramArtifact;
  readonly onAskTutor: (text: string, nodeId: string) => void;
  readonly onOpenPage?: ((page: number, nodeId: string) => void) | undefined;
}) {
  const sections = readingOrder(artifact);
  return (
    <div className="flex flex-col gap-4">
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2" aria-label={section.title}>
          <h4 className="font-extrabold text-lila-ink text-xs uppercase tracking-wider">{section.title}</h4>
          <ol className="flex list-none flex-col gap-2 p-0">
            {section.nodes.map((node, index) => (
              <li key={node.id} className="card-flat flex flex-col gap-1.5 p-3">
                <div className="flex items-start gap-2">
                  {section.numbered && (
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink bg-lila-soft font-extrabold text-[12px]">{index + 1}</span>
                  )}
                  <h5 className="min-w-0 flex-1 font-extrabold text-[15px] leading-snug">{node.label}</h5>
                </div>
                <p className="font-semibold text-ink-muted text-sm">{node.description}</p>
                <NodeRelations artifact={artifact} node={node} />
                <div className="flex flex-wrap items-center gap-2">
                  <PageChips node={node} openPage={undefined} onOpenPage={onOpenPage} />
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => onAskTutor(`Explícame «${node.label}» del esquema «${artifact.title}»`, node.id)}
                  >
                    Preguntar al tutor
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** "→ Condensación · aporta vapor", "← Evaporación · sigue a". */
export function NodeRelations({ artifact, node }: { readonly artifact: DiagramArtifact; readonly node: DiagramNode }) {
  const relations = relationsOf(artifact, node.id);
  if (relations.length === 0) return null;
  const labels = new Map(artifact.nodes.map((candidate) => [candidate.id, candidate.label]));
  return (
    <ul className="flex list-none flex-col gap-0.5 p-0 font-semibold text-ink-muted text-sm">
      {relations.map((relation, index) => (
        <li key={index}>
          {relation.direction === "out" ? "→ " : "← "}
          <span className="text-ink">{labels.get(relation.other) ?? relation.other}</span>
          {relation.label !== undefined ? ` · ${relation.label}` : ""}
        </li>
      ))}
    </ul>
  );
}

// --- Graph helpers -----------------------------------------------------------------

export interface NodeRelation {
  readonly other: string;
  readonly direction: "out" | "in";
  readonly label: string | undefined;
}

/**
 * Relations touching a node: main-path steps first (with the transition's
 * cause when the diagram states it), then the other edges.
 */
export const relationsOf = (artifact: DiagramArtifact, nodeId: string): readonly NodeRelation[] => {
  const relations: NodeRelation[] = [];
  const path = artifact.mainPath ?? [];
  const { transitions, edges } = splitTransitions(path, artifact.cyclic === true, artifact.edges);
  const index = path.indexOf(nodeId);
  if (index !== -1) {
    const previous = index > 0 ? path[index - 1] : artifact.cyclic ? path[path.length - 1] : undefined;
    const next = index < path.length - 1 ? path[index + 1] : artifact.cyclic ? path[0] : undefined;
    if (previous !== undefined && previous !== nodeId) relations.push({ other: previous, direction: "in", label: transitions.get(`${previous}->${nodeId}`) ?? "sigue a" });
    if (next !== undefined && next !== nodeId) relations.push({ other: next, direction: "out", label: transitions.get(`${nodeId}->${next}`) ?? "sigue" });
  }
  for (const edge of edges) {
    if (edge.from === nodeId) relations.push({ other: edge.to, direction: "out", label: edge.label });
    else if (edge.to === nodeId) relations.push({ other: edge.from, direction: "in", label: edge.label });
  }
  return relations;
};

interface ReadingSection {
  readonly title: string;
  readonly numbered: boolean;
  readonly nodes: readonly DiagramNode[];
}

/**
 * Process: the main path in order, then the side concepts. Concept map: the
 * root, then each level outwards (breadth-first, ignoring edge direction).
 */
export const readingOrder = (artifact: DiagramArtifact): readonly ReadingSection[] => {
  const byId = new Map(artifact.nodes.map((node) => [node.id, node]));
  const pick = (ids: readonly string[]) => ids.flatMap((id) => {
    const node = byId.get(id);
    return node === undefined ? [] : [node];
  });

  if (artifact.diagramType === "process") {
    const path = artifact.mainPath ?? [];
    const inPath = new Set(path);
    const side = artifact.nodes.filter((node) => !inPath.has(node.id));
    return [
      { title: artifact.cyclic ? "Pasos del ciclo" : "Pasos", numbered: true, nodes: pick(path) },
      ...(side.length > 0 ? [{ title: "Conceptos relacionados", numbered: false, nodes: side }] : [])
    ];
  }

  return bfsLevels(artifact).map((ids, depth) => ({
    title: depth === 0 ? "Concepto central" : depth === 1 ? "Conceptos relacionados" : `Nivel ${depth}`,
    numbered: false,
    nodes: pick(ids)
  }));
};

/** Node ids by distance from the root, ignoring edge direction; unreachable nodes go last. */
const bfsLevels = (artifact: DiagramArtifact): readonly (readonly string[])[] => {
  const ids = artifact.nodes.map((node) => node.id);
  const root = artifact.rootId !== undefined && ids.includes(artifact.rootId) ? artifact.rootId : ids[0];
  if (root === undefined) return [];
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of artifact.edges) {
    neighbours.get(edge.from)?.push(edge.to);
    neighbours.get(edge.to)?.push(edge.from);
  }
  const seen = new Set<string>([root]);
  const levels: string[][] = [[root]];
  while (true) {
    const last = levels[levels.length - 1] ?? [];
    const next: string[] = [];
    for (const id of last) {
      for (const other of neighbours.get(id) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          next.push(other);
        }
      }
    }
    if (next.length === 0) break;
    levels.push(next);
  }
  const unreachable = ids.filter((id) => !seen.has(id));
  return unreachable.length > 0 ? [...levels, unreachable] : levels;
};

// --- View box helpers -----------------------------------------------------------------

const fullView = (layout: DiagramLayout): ViewBox => ({ x: 0, y: 0, width: layout.width, height: layout.height });

/** Scales the view box by `factor` (> 1 zooms out) around `anchor`, within 0.4×–2.5× of the full view. */
const zoomAt = (current: ViewBox, layout: DiagramLayout, factor: number, anchor?: { x: number; y: number }): ViewBox => {
  const minWidth = layout.width / 2.5;
  const maxWidth = layout.width * 2.5;
  const width = Math.min(maxWidth, Math.max(minWidth, current.width * factor));
  const applied = width / current.width;
  const height = current.height * applied;
  const point = anchor ?? { x: current.x + current.width / 2, y: current.y + current.height / 2 };
  return {
    x: point.x - (point.x - current.x) * applied,
    y: point.y - (point.y - current.y) * applied,
    width,
    height
  };
};

/** Client coordinates to view-box coordinates, honouring `xMidYMid meet`. */
const toSvgPoint = (svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } => {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (matrix === null) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
};

const slug = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "esquema";
