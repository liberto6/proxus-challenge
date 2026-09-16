import type { Artifact, ArtifactAttempt, KeyPointCorrection } from "../../artifacts/artifact.ts";

export interface UiContextFocus {
  readonly openQuestionId?: string | undefined;
  readonly openNodeId?: string | undefined;
  /** The student's most recent graded attempt on the open artifact, when there is one. */
  readonly latestAttempt?: ArtifactAttempt | undefined;
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
    case "explain": {
      lines.push(...describeExplainContext(artifact, focus));
      break;
    }
  }

  lines.push(
    "When the student refers to \"this quiz\", \"the test\", \"question 2\", \"this concept\", \"this step\", \"this point\" or similar without naming an artifact, they mean this one.",
    "Use `artifacts show <id>` if you need its full content."
  );

  return lines.join("\n");
};

/**
 * The explanation objective: its key points, the student's latest graded
 * attempt (status per point) and, for the focused point, the hidden reference
 * so the tutor can explain what was missing. The reference of a point without
 * a graded attempt must not be revealed; the note says so.
 */
const describeExplainContext = (artifact: Extract<Artifact, { readonly kind: "explain" }>, focus: UiContextFocus): readonly string[] => {
  const attempt = focus.latestAttempt;
  const graded = attempt !== undefined && attempt.artifactKind === "explain" && attempt.status === "graded" ? attempt : undefined;
  const correctionOf = (keyPointId: string): KeyPointCorrection | undefined =>
    graded?.corrections.find((correction) => correction.keyPointId === keyPointId);

  const lines = [
    `- It is an explanation objective ("${artifact.prompt}") with ${artifact.keyPoints.length} key point(s):`,
    ...artifact.keyPoints.map((point) => {
      const correction = correctionOf(point.id);
      const status = correction === undefined ? "not attempted" : correction.status;
      return `  - ${point.id}: "${point.label}" (pages ${point.pages.join(", ")}) — ${status}`;
    })
  ];

  if (graded === undefined) {
    lines.push("- The student has no graded attempt yet. Do not reveal the references or the required ideas; if asked, give the titles only.");
  } else {
    lines.push(
      `- Latest attempt: ${graded.score}/${graded.maxScore} (${graded.answer.inputMode === "voice" ? "dictated" : "written"}). Transcript: "${truncate(graded.answer.transcript, 400)}"`,
      ...graded.corrections
        .filter((correction) => correction.status !== "covered")
        .map((correction) => `  - ${correction.keyPointId}: ${correction.status} — ${correction.feedback}`)
    );
  }

  const point = focus.openQuestionId === undefined
    ? undefined
    : artifact.keyPoints.find((candidate) => candidate.id === focus.openQuestionId);
  if (point !== undefined) {
    const correction = correctionOf(point.id);
    lines.push(`- Focused key point ${point.id}: "${point.label}" (pages ${point.pages.join(", ")}).`);
    if (correction !== undefined) {
      lines.push(
        correction.status === "covered"
          ? `  The student covered it. Reference, for your own check: "${point.expected}". Required ideas: ${point.mustMention.join("; ")}.`
          : `  Reference (already shown to the student because the point was ${correction.status}): "${point.expected}". Required ideas: ${point.mustMention.join("; ")}.`
      );
    } else {
      lines.push("  Not attempted yet: explain the idea from the pages without giving the reference sentence or the required ideas.");
    }
  }

  return lines;
};

const truncate = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max)}…`;
