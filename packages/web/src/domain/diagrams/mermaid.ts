import type { DiagramArtifact } from "@proxus/shared";
import { splitTransitions } from "./layout.ts";

/**
 * Mermaid `flowchart` text for a diagram, so the student can paste it into
 * notes tools (Obsidian, Notion, GitHub). Generated from the artifact, never
 * by the model.
 */
export const toMermaid = (artifact: DiagramArtifact): string => {
  const lines = [artifact.diagramType === "timeline" ? "flowchart LR" : "flowchart TD"];
  const quote = (text: string) => `"${text.replaceAll("\"", "'")}"`;
  const declare = (node: DiagramArtifact["nodes"][number]) => {
    const text = node.sublabel === undefined ? node.label : `${node.label}<br/><i>${node.sublabel}</i>`;
    const kind = node.kind ?? "concept";
    // Shapes close to the drawing: agents as stadiums, conditions as hexagons, formulas as subroutines.
    return kind === "agent" ? `${node.id}([${quote(text)}])`
      : kind === "condition" ? `${node.id}{{${quote(text)}}}`
        : kind === "formula" ? `${node.id}[[${quote(node.formula ?? text)}]]`
          : `${node.id}[${quote(text)}]`;
  };

  // Phases (timeline) and groups become subgraphs; the rest are declared loose.
  const declared = new Set<string>();
  const subgraph = (id: string, label: string, ids: readonly string[]) => {
    const members = artifact.nodes.filter((node) => ids.includes(node.id) && !declared.has(node.id));
    if (members.length === 0) return;
    lines.push(`  subgraph ${id} [${quote(label)}]`);
    for (const node of members) {
      lines.push(`    ${declare(node)}`);
      declared.add(node.id);
    }
    lines.push("  end");
  };
  (artifact.phases ?? []).forEach((phase, index) => subgraph(`phase_${index + 1}`, phase, artifact.nodes.filter((node) => node.phase === phase).map((node) => node.id)));
  for (const group of artifact.groups ?? []) subgraph(group.id, group.label, group.nodeIds);
  for (const node of artifact.nodes) {
    if (!declared.has(node.id)) lines.push(`  ${declare(node)}`);
  }

  const path = artifact.mainPath ?? [];
  const { transitions, edges } = splitTransitions(path, artifact.cyclic === true, artifact.edges);
  const arrow = (from: string, to: string) => {
    const label = transitions.get(`${from}->${to}`);
    return label === undefined ? `  ${from} --> ${to}` : `  ${from} -- ${quote(label)} --> ${to}`;
  };
  for (let index = 0; index < path.length - 1; index++) {
    lines.push(arrow(path[index]!, path[index + 1]!));
  }
  if (artifact.cyclic === true && path.length >= 2) {
    lines.push(arrow(path[path.length - 1]!, path[0]!));
  }
  for (const edge of edges) {
    lines.push(edge.label === undefined ? `  ${edge.from} --> ${edge.to}` : `  ${edge.from} -- ${quote(edge.label)} --> ${edge.to}`);
  }

  return `${lines.join("\n")}\n`;
};

/** Number of edges the Mermaid text will contain (main-path stretches included, transitions not doubled). */
export const mermaidEdgeCount = (artifact: DiagramArtifact): number => {
  const path = artifact.mainPath ?? [];
  const stretches = Math.max(0, path.length - 1) + (artifact.cyclic === true && path.length >= 2 ? 1 : 0);
  return stretches + splitTransitions(path, artifact.cyclic === true, artifact.edges).edges.length;
};
