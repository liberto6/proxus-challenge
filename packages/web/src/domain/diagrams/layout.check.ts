import type { DiagramArtifact } from "@proxus/shared";
import { layoutDiagram, type DiagramLayout } from "./layout.ts";
import { mermaidEdgeCount, toMermaid } from "./mermaid.ts";

/**
 * Deterministic checks of the diagram layout (no browser, no API):
 * every node placed, no overlapping boxes, the expected shape per type, and
 * the same geometry on every run.
 *
 *   pnpm --filter @proxus/web run check:layout
 */

interface CriterionResult {
  readonly id: string;
  readonly passed: boolean;
  readonly message: string;
}

const criterion = (id: string, passed: boolean, message: string): CriterionResult => ({ id, passed, message });

const node = (id: string, label: string, pages: readonly number[]) =>
  ({ id, label, description: `${label}: concepto del material con una descripción suficientemente larga.`, pages });

const cycle: DiagramArtifact = {
  kind: "diagram",
  id: "cycle",
  title: "El ciclo del agua: fases",
  diagramType: "process",
  summary: "Las cuatro fases del ciclo del agua se encadenan en un bucle.",
  source: { materialId: "ciclo-del-agua", pages: [1, 2] },
  nodes: [
    node("evaporacion", "Evaporación", [1]),
    node("condensacion", "Condensación", [1]),
    node("precipitacion", "Precipitación", [2]),
    node("recoleccion", "Recolección", [2]),
    node("transpiracion", "Transpiración", [2]),
    node("sublimacion", "Sublimación", [2])
  ],
  mainPath: ["evaporacion", "condensacion", "precipitacion", "recoleccion"],
  cyclic: true,
  edges: [
    { from: "transpiracion", to: "condensacion", label: "aporta vapor" },
    { from: "sublimacion", to: "condensacion", label: "aporta vapor" }
  ]
};

const linear: DiagramArtifact = {
  ...cycle,
  id: "linear",
  cyclic: false,
  edges: [{ from: "transpiracion", to: "evaporacion", label: "aporta vapor" }, { from: "sublimacion", to: "recoleccion", label: "reduce" }]
};

const conceptMap: DiagramArtifact = {
  kind: "diagram",
  id: "map",
  title: "Recolección del agua",
  diagramType: "concept-map",
  summary: "La recolección devuelve el agua a la superficie o al subsuelo.",
  source: { materialId: "ciclo-del-agua", pages: [2, 3] },
  rootId: "recoleccion",
  nodes: [
    node("recoleccion", "Recolección", [2]),
    node("escorrentia", "Escorrentía", [2, 3]),
    node("infiltracion", "Infiltración", [2]),
    node("acuifero", "Acuífero", [2, 3]),
    node("rios", "Ríos y mares", [3])
  ],
  edges: [
    { from: "recoleccion", to: "escorrentia", label: "una vía es" },
    { from: "recoleccion", to: "infiltracion", label: "otra vía es" },
    { from: "infiltracion", to: "acuifero", label: "forma" },
    { from: "escorrentia", to: "rios", label: "llega a" },
    { from: "acuifero", to: "rios", label: "alimenta" }
  ]
};

/** Twelve concepts around one root: the largest allowed diagram. */
const large: DiagramArtifact = {
  ...conceptMap,
  id: "large",
  nodes: [node("raiz", "Raíz", [1]), ...Array.from({ length: 11 }, (_, index) => node(`c${index + 1}`, `Concepto ${index + 1}`, [1]))],
  rootId: "raiz",
  edges: [
    ...Array.from({ length: 5 }, (_, index) => ({ from: "raiz", to: `c${index + 1}`, label: `relación ${index + 1}` })),
    ...Array.from({ length: 6 }, (_, index) => ({ from: `c${(index % 5) + 1}`, to: `c${index + 6}`, label: "lleva a" }))
  ]
};

const overlaps = (layout: DiagramLayout, margin = 16): string[] => {
  const hits: string[] = [];
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i]!;
      const b = layout.nodes[j]!;
      const apart = a.x + a.width + margin <= b.x || b.x + b.width + margin <= a.x || a.y + a.height + margin <= b.y || b.y + b.height + margin <= a.y;
      if (!apart) hits.push(`${a.id}/${b.id}`);
    }
  }
  return hits;
};

const inside = (layout: DiagramLayout): boolean =>
  layout.nodes.every((box) => box.x >= 0 && box.y >= 0 && box.x + box.width <= layout.width && box.y + box.height <= layout.height);

const results: CriterionResult[] = [];

for (const artifact of [cycle, linear, conceptMap, large]) {
  const layout = layoutDiagram(artifact);
  const placed = artifact.nodes.every((item) => layout.nodes.some((box) => box.id === item.id));
  const hits = overlaps(layout);
  results.push(
    criterion(`${artifact.id}.all-nodes-placed`, placed && layout.nodes.length === artifact.nodes.length && inside(layout), `${layout.nodes.length} nodes in ${layout.width}x${layout.height}`),
    criterion(`${artifact.id}.no-overlaps`, hits.length === 0, hits.length === 0 ? "no overlapping boxes" : hits.join(", ")),
    criterion(`${artifact.id}.every-edge-has-a-path`, layout.edges.every((edge) => edge.path.startsWith("M ") && Number.isFinite(edge.labelX)), `${layout.edges.length} edges`),
    criterion(`${artifact.id}.deterministic`, JSON.stringify(layoutDiagram(artifact)) === JSON.stringify(layout), "same output twice")
  );
}

const ringLayout = layoutDiagram(cycle);
const steps = ringLayout.nodes.filter((box) => box.role === "step");
const centerX = steps.reduce((sum, box) => sum + box.x + box.width / 2, 0) / steps.length;
const centerY = steps.reduce((sum, box) => sum + box.y + box.height / 2, 0) / steps.length;
const radii = steps.map((box) => Math.hypot(box.x + box.width / 2 - centerX, box.y + box.height / 2 - centerY));
results.push(
  criterion("cycle.renders-as-ring", Math.max(...radii) - Math.min(...radii) < 1 && ringLayout.edges.filter((edge) => edge.kind === "main").length === 4 && ringLayout.edges.some((edge) => edge.from === "recoleccion" && edge.to === "evaporacion"), `radii: ${radii.map((r) => Math.round(r)).join(",")}`),
  criterion("cycle.arcs-use-svg-arc-command", ringLayout.edges.filter((edge) => edge.kind === "main").every((edge) => edge.path.includes(" A ")), "main edges are arcs"),
  criterion("cycle.side-nodes-outside-ring", ringLayout.nodes.filter((box) => box.role === "side").every((box) => Math.hypot(box.x + box.width / 2 - centerX, box.y + box.height / 2 - centerY) > Math.max(...radii) + 40), "side concepts sit outside")
);

const columnLayout = layoutDiagram(linear);
const columnSteps = columnLayout.nodes.filter((box) => box.role === "step");
results.push(
  criterion("linear.steps-in-one-column-top-down", columnSteps.every((box) => box.x === columnSteps[0]!.x) && columnSteps.every((box, index) => index === 0 || box.y > columnSteps[index - 1]!.y), `x: ${columnSteps.map((box) => box.x).join(",")}`),
  criterion("linear.no-return-edge", !columnLayout.edges.some((edge) => edge.from === "recoleccion" && edge.to === "evaporacion"), "no edge closes the path")
);

const mapLayout = layoutDiagram(conceptMap);
const byId = new Map(mapLayout.nodes.map((box) => [box.id, box]));
results.push(
  criterion("map.root-on-top", byId.get("recoleccion")?.role === "root" && mapLayout.nodes.every((box) => box.y >= byId.get("recoleccion")!.y), "root has the smallest y"),
  criterion("map.children-below-parents", (byId.get("acuifero")?.y ?? 0) > (byId.get("infiltracion")?.y ?? 0) && (byId.get("rios")?.y ?? 0) > (byId.get("escorrentia")?.y ?? 0), "levels increase with depth"),
  criterion("map.edge-labels-kept", mapLayout.edges.every((edge) => edge.label !== undefined), `${mapLayout.edges.length} labelled edges`)
);

const labelledCycle: DiagramArtifact = {
  ...cycle,
  id: "labelled",
  edges: [
    ...cycle.edges,
    { from: "evaporacion", to: "condensacion", label: "el vapor se enfría en altura" },
    { from: "recoleccion", to: "evaporacion", label: "el agua vuelve al mar" }
  ]
};
const labelledLayout = layoutDiagram(labelledCycle);
results.push(
  criterion("cycle.transitions-label-the-main-edges", labelledLayout.edges.filter((edge) => edge.kind === "main").length === 4 && labelledLayout.edges.filter((edge) => edge.kind === "side").length === 2 && labelledLayout.edges.some((edge) => edge.kind === "main" && edge.from === "evaporacion" && edge.label === "el vapor se enfría en altura"), `main edges: ${labelledLayout.edges.filter((edge) => edge.kind === "main").map((edge) => edge.label ?? "-").join(" | ")}`),
  criterion("cycle.transition-labels-outside-ring", labelledLayout.edges.filter((edge) => edge.kind === "main").every((edge) => Math.hypot(edge.labelX - centerX, edge.labelY - centerY) > Math.max(...radii)), "labels sit outside the ring"),
  criterion("mermaid-does-not-double-transitions", (toMermaid(labelledCycle).match(/-->/g) ?? []).length === 6 && toMermaid(labelledCycle).includes('evaporacion -- "el vapor se enfría en altura" --> condensacion'), `${(toMermaid(labelledCycle).match(/-->/g) ?? []).length} arrows`)
);

// One side concept beside a step on the right of the ring must not touch it.
const oneSide: DiagramArtifact = { ...cycle, id: "one-side", nodes: cycle.nodes.filter((item) => item.id !== "sublimacion"), edges: [cycle.edges[0]!] };
const oneSideLayout = layoutDiagram(oneSide);
results.push(criterion("cycle.single-side-node-clears-its-step", overlaps(oneSideLayout).length === 0, overlaps(oneSideLayout).join(",") || "no overlap"));

// A relation between two concepts of the same row dips below them instead of running through the row.
const sameRowLayout = layoutDiagram({ ...conceptMap, edges: [...conceptMap.edges, { from: "escorrentia", to: "infiltracion", label: "compite con" }] });
const sameRowEdge = sameRowLayout.edges.find((edge) => edge.from === "escorrentia" && edge.to === "infiltracion");
const rowY = sameRowLayout.nodes.find((box) => box.id === "escorrentia")?.y ?? 0;
results.push(criterion("map.same-row-edge-dips-below", sameRowEdge !== undefined && sameRowEdge.path.includes(" Q ") && sameRowEdge.labelY > rowY + 72, `label y ${sameRowEdge?.labelY} vs row y ${rowY}`));

// Groups: members inside their envelope, envelopes apart, a sub-step group around a step of the ring.
const grouped: DiagramArtifact = {
  ...cycle,
  id: "grouped",
  nodes: [...cycle.nodes, node("escorrentia", "Escorrentía", [2]), node("infiltracion", "Infiltración", [2])],
  edges: [...cycle.edges, { from: "recoleccion", to: "escorrentia", label: "una vía es" }, { from: "recoleccion", to: "infiltracion", label: "otra vía es" }],
  groups: [
    { id: "destinos", label: "Destinos del agua", nodeIds: ["recoleccion", "escorrentia", "infiltracion"] },
    { id: "aportes", label: "Aportes de vapor", nodeIds: ["transpiracion", "sublimacion"] }
  ]
};
const groupedLayout = layoutDiagram(grouped);
const envelopeContains = (group: { x: number; y: number; width: number; height: number }, box: { x: number; y: number; width: number; height: number }) =>
  box.x >= group.x && box.y >= group.y && box.x + box.width <= group.x + group.width && box.y + box.height <= group.y + group.height;
const membersInside = groupedLayout.groups.every((group) => group.nodeIds.every((id) => {
  const box = groupedLayout.nodes.find((candidate) => candidate.id === id);
  return box !== undefined && envelopeContains(group, box);
}));
const envelopesApart = groupedLayout.groups.every((a, i) => groupedLayout.groups.every((b, j) => i >= j
  || a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y));
const strangers = groupedLayout.groups.flatMap((group) => groupedLayout.nodes.filter((box) => !group.nodeIds.includes(box.id) && envelopeContains(group, box)).map((box) => `${group.id}:${box.id}`));
results.push(
  criterion("groups.members-inside-envelope", membersInside, `${groupedLayout.groups.length} groups`),
  criterion("groups.envelopes-do-not-cross", envelopesApart, groupedLayout.groups.map((group) => `${group.id}@${group.x},${group.y}`).join(" ")),
  criterion("groups.no-stranger-inside", strangers.length === 0, strangers.join(",") || "only members inside"),
  criterion("groups.frame-contains-envelopes", groupedLayout.groups.every((group) => group.x >= 0 && group.y >= 0 && group.x + group.width <= groupedLayout.width && group.y + group.height <= groupedLayout.height) && overlaps(groupedLayout).length === 0, `${groupedLayout.width}x${groupedLayout.height}`),
  criterion("grouped.deterministic", JSON.stringify(layoutDiagram(grouped)) === JSON.stringify(groupedLayout), "same output twice")
);

const groupedMap: DiagramArtifact = {
  ...conceptMap,
  id: "grouped-map",
  groups: [{ id: "vias", label: "Vías", nodeIds: ["escorrentia", "infiltracion"] }, { id: "destinos", label: "Destinos", nodeIds: ["acuifero", "rios"] }]
};
const groupedMapLayout = layoutDiagram(groupedMap);
results.push(
  criterion("groups.map-members-adjacent", groupedMapLayout.groups.every((group) => group.nodeIds.every((id) => {
    const box = groupedMapLayout.nodes.find((candidate) => candidate.id === id);
    return box !== undefined && envelopeContains(group, box);
  })) && groupedMapLayout.groups.flatMap((group) => groupedMapLayout.nodes.filter((box) => !group.nodeIds.includes(box.id) && envelopeContains(group, box))).length === 0, groupedMapLayout.groups.map((group) => `${group.id}: ${group.width}x${group.height}`).join(" "))
);

const mermaid = toMermaid(cycle);
results.push(
  criterion("mermaid-export-counts", mermaid.startsWith("flowchart TD") && (mermaid.match(/-->/g) ?? []).length === 6 && mermaidEdgeCount(cycle) === 6 && mermaid.includes("recoleccion --> evaporacion") && mermaid.includes('-- "aporta vapor" -->'), `${(mermaid.match(/-->/g) ?? []).length} arrows`)
);

const lines = ["web.diagram-layout (no browser)"];
for (const result of results) {
  lines.push(`  ${result.passed ? "✓" : "✗"} ${result.id}: ${result.message}`);
}
const passed = results.filter((result) => result.passed).length;
lines.push(`${passed}/${results.length} criteria passed`);
console.log(lines.join("\n"));

if (passed !== results.length) {
  process.exitCode = 1;
}
