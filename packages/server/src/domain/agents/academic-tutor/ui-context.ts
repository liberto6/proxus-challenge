import type { Artifact } from "../../artifacts/artifact.ts";

/**
 * System note describing what the student has open in the interface, so the
 * tutor can answer "explain question 2" without asking which artifact. It is
 * injected for the current turn only and never persisted.
 */
export const describeUiContext = (artifact: Artifact, openQuestionId: string | undefined): string => {
  const lines = [
    "UI CONTEXT (what the student has open right now):",
    `- Open artifact: ${artifact.kind} "${artifact.title}" (id: ${artifact.id}).`
  ];

  if (artifact.kind !== "note") {
    lines.push(`- It has ${artifact.questions.length} question(s): ${artifact.questions.map((question) => question.id).join(", ")}.`);
    const question = openQuestionId === undefined
      ? undefined
      : artifact.questions.find((candidate) => candidate.id === openQuestionId);
    if (question !== undefined) {
      lines.push(`- Focused question ${question.id}: "${question.prompt}"`);
    }
  }

  lines.push(
    "When the student refers to \"this quiz\", \"the test\", \"question 2\" or similar without naming an artifact, they mean this one.",
    "Use `artifacts show <id>` if you need its full content."
  );

  return lines.join("\n");
};
