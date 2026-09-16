import type { DiagramArtifact } from "@proxus/shared";

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
  for (let index = 0; index < path.length - 1; index++) {
    lines.push(`  ${path[index]} --> ${path[index + 1]}`);
  }
  if (artifact.cyclic === true && path.length >= 2) {
    lines.push(`  ${path[path.length - 1]} --> ${path[0]}`);
  }
  for (const edge of artifact.edges) {
    lines.push(edge.label === undefined ? `  ${edge.from} --> ${edge.to}` : `  ${edge.from} -- ${quote(edge.label)} --> ${edge.to}`);
  }

  return `${lines.join("\n")}\n`;
};

/** Number of edges the Mermaid text will contain (implicit steps included). */
export const mermaidEdgeCount = (artifact: DiagramArtifact): number => {
  const path = artifact.mainPath ?? [];
  const implicit = Math.max(0, path.length - 1) + (artifact.cyclic === true && path.length >= 2 ? 1 : 0);
  return implicit + artifact.edges.length;
};
