import type { DiagramArtifact } from "@proxus/shared";
import { splitTransitions } from "./layout.ts";

/**
 * Mermaid `flowchart` text for a diagram, so the student can paste it into
 * notes tools (Obsidian, Notion, GitHub). Generated from the artifact, never
 * by the model.
 */
export const toMermaid = (artifact: DiagramArtifact): string => {
  const lines = ["flowchart TD"];
  const quote = (text: string) => `"${text.replaceAll("\"", "'")}"`;

  for (const node of artifact.nodes) {
    lines.push(`  ${node.id}[${quote(node.label)}]`);
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
