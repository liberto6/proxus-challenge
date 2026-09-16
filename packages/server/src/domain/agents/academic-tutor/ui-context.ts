import type { Artifact } from "../../artifacts/artifact.ts";

export interface UiContextFocus {
  readonly openQuestionId?: string | undefined;
  readonly openNodeId?: string | undefined;
}

/**
 * System note describing what the student has open in the interface, so the
 * tutor can answer "explain question 2" or "explain this concept" without
 * asking which artifact. It is injected for the current turn only and never
 * persisted.
 */
export const describeUiContext = (artifact: Artifact, focus: UiContextFocus = {}): string => {
  const lines = [
    "UI CONTEXT (what the student has open right now):",
    `- Open artifact: ${artifact.kind} "${artifact.title}" (id: ${artifact.id}).`
  ];

  switch (artifact.kind) {
    case "note":
      break;
    case "quiz":
    case "test": {
      lines.push(`- It has ${artifact.questions.length} question(s): ${artifact.questions.map((question) => question.id).join(", ")}.`);
      const question = focus.openQuestionId === undefined
        ? undefined
        : artifact.questions.find((candidate) => candidate.id === focus.openQuestionId);
      if (question !== undefined) {
        lines.push(`- Focused question ${question.id}: "${question.prompt}"`);
      }
      break;
    }
    case "diagram": {
      lines.push(`- It is a ${artifact.diagramType} diagram with ${artifact.nodes.length} node(s): ${artifact.nodes.map((node) => node.id).join(", ")}.`);
      const node = focus.openNodeId === undefined
        ? undefined
        : artifact.nodes.find((candidate) => candidate.id === focus.openNodeId);
      if (node !== undefined) {
        lines.push(`- Focused node ${node.id}: "${node.label}" — ${node.description} (pages ${node.pages.join(", ")})`);
      }
      break;
    }
  }

  lines.push(
    "When the student refers to \"this quiz\", \"the test\", \"question 2\", \"this concept\", \"this step\" or similar without naming an artifact, they mean this one.",
    "Use `artifacts show <id>` if you need its full content."
  );

  return lines.join("\n");
};
