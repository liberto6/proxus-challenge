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
