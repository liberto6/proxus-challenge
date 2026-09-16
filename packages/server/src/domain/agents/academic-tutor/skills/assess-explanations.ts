import { explainLimits } from "@proxus/shared";
import { AgentSkill } from "../../harness/index.ts";

export interface AssessExplanationsOptions {
  /** Offer an explanation objective on the tutor's own initiative after explaining a topic. */
  readonly autoExplain: boolean;
}

/**
 * Worked example the skill quotes. The eval validates it, so the model never
 * learns from an example the system would reject.
 */
export const assessExplanationsExample = {
  kind: "explain",
  title: "Explica el ciclo del agua",
  source: { materialId: "<materialId>", pages: [1, 2, 3] },
  prompt: "Explica con tus palabras cómo funciona el ciclo del agua, de principio a fin.",
  keyPoints: [
    {
      id: "evaporacion",
      label: "Qué es la evaporación y qué la provoca",
      expected: "El calor del sol calienta el agua de mares, ríos y lagos y la convierte en vapor de agua que sube a la atmósfera.",
      mustMention: ["sol|calor", "vapor"],
      pages: [1]
    },
    {
      id: "condensacion",
      label: "Qué le pasa al vapor en altura",
      expected: "Al subir, el vapor se enfría y se condensa en pequeñas gotas que forman las nubes.",
      mustMention: ["se enfría|enfriar|frío", "nubes"],
      contradictions: ["se calienta en altura"],
      pages: [1]
    },
    {
      id: "precipitacion",
      label: "Cómo vuelve el agua a la superficie",
      expected: "Cuando las gotas pesan demasiado caen en forma de lluvia, nieve o granizo: es la precipitación.",
      mustMention: ["lluvia|precipitación|precipita"],
      pages: [2]
    },
    {
      id: "ciclo",
      label: "Por qué es un ciclo",
      expected: "El agua recogida vuelve a mares y ríos por escorrentía o infiltración y el proceso empieza de nuevo.",
      mustMention: ["vuelve|regresa|empieza de nuevo|otra vez"],
      pages: [2, 3]
    }
  ]
} as const;

const example = (value: unknown) => JSON.stringify(value);

export const makeAssessExplanationsSkill = (options: AssessExplanationsOptions) => AgentSkill.make({
  name: "assess-explanations",
  description: options.autoExplain
    ? "Create an explanation objective: the key points of a topic the student should be able to explain in their own words, each with a hidden reference anchored to the material pages; the system grades the student's explanation point by point. Load it when the student wants to explain a topic themselves, asks to be tested by explaining, or after you explain a topic worth checking that way."
    : "Create an explanation objective: the key points of a topic the student should be able to explain in their own words, each with a hidden reference anchored to the material pages; the system grades the student's explanation point by point. Load it when the student wants to explain a topic themselves or asks to be tested by explaining.",
  content: [
    "# Assess explanations",
    "",
    "An explanation objective checks whether the student can explain a topic, not just recognise the right option. You fix the key points they must cover; the student explains in their own words (by dictation or text) in the panel; the system compares the transcript with the reference you wrote and marks each point as covered, partial, missing or wrong, showing the pages to reread. The student sees only the titles of the key points before explaining; the references stay hidden.",
    "",
    "## When to create one",
    "- The student says they want to explain the topic themselves, asks you to test them by explaining, or asks \"pregúntame\", \"ponme a prueba\" about something they have studied.",
    "- The student has just finished a quiz or a diagram on a topic and wants to go further.",
    "- Not for a single fact or definition (a quiz question is enough), and not on pages you have not rendered.",
    "",
    ...(options.autoExplain
      ? [
          "## On your own initiative",
          "- After explaining a process, a mechanism or a set of related concepts from the material, create the objective in the same turn (after rendering the pages) and mention it in one sentence: the interface shows an \"Abrir\" card next to your answer.",
          "- Do not create one for a direct question or when the student only wants a short answer.",
          ""
        ]
      : [
          "## Offer it",
          "- After explaining a process, a mechanism or a set of related concepts, offer it in one sentence (\"¿Quieres explicármelo tú y te lo corrijo?\"). Create it only when the student accepts.",
          ""
        ]),
    "## How to build it",
    "1. Render the pages first (`materials view`). Every key point cites the page(s) that explain it; the system rejects pages you have not rendered.",
    `2. \`prompt\` (${explainLimits.prompt.min}-${explainLimits.prompt.max} characters): one sentence asking the student to explain the topic in their own words.`,
    `3. ${explainLimits.keyPoints.min}-${explainLimits.keyPoints.max} key points, in the order the explanation should follow. Each one:`,
    `   - \`label\` (${explainLimits.label.min}-${explainLimits.label.max} characters): the idea to explain, written as a question or a claim (\"Qué provoca la evaporación\", \"Por qué el vapor se condensa\"). Never a section title (\"Evaporación\"): the system rejects an objective made of titles.`,
    `   - \`expected\` (${explainLimits.expected.min}-${explainLimits.expected.max} characters): one to three sentences with what the material says, the way a good student would say it. It is revealed to the student only for the points they did not cover.`,
    `   - \`mustMention\` (${explainLimits.mustMention.min}-${explainLimits.mustMention.max} items): the ideas that must appear for the point to count, as the words a student would actually use. Separate synonyms with \`|\` (\"se enfría|enfriar|frío\"); the check is by words, so give the common forms. Do not repeat an idea in two points. Avoid rare jargon unless the material insists on it.`,
    `   - \`contradictions\` (optional, up to ${explainLimits.contradictions.max}): short phrases that reveal a wrong idea (\"se calienta en altura\"). A transcript containing one marks the point as wrong.`,
    `   - \`pages\` (${explainLimits.pagesPerPoint.min}-${explainLimits.pagesPerPoint.max}): the pages that explain the point, all within \`source.pages\`.`,
    "4. Ids are short lower-case slugs without accents (`evaporacion`). Do not use apostrophes or single quotes anywhere in the JSON: it goes inside single quotes on the command line.",
    "5. Persist it with `artifacts create '<json>'`. The response confirms `keyPointCount`.",
    "",
    "Example (replace `<materialId>` with the id from `materials list`):",
    `- \`artifacts create '${example(assessExplanationsExample)}'\``,
    "",
    "## If the system rejects it",
    "- A result starting with `EXPLAIN_INVALID` lists every problem with a hint. Fix all of them and call `artifacts create` again with the full JSON.",
    "- At most two attempts. If the second one is rejected too, ask the student to explain the topic in the chat and give feedback yourself, citing the pages.",
    "",
    "## After creating it",
    "- Reply with two or three sentences: what the student will have to explain, how many key points, which pages it covers, and an invitation to open it from the panel and use the microphone or write.",
    "- Never reveal `expected`, `mustMention` or `contradictions` in the chat before the student has a graded attempt on that point. If they ask what the points are, give the titles only.",
    "- When the student asks about a point after an attempt (the interface tells you the open point and their latest result), explain what was missing or wrong from the pages the point cites, in your words, and suggest how to say it. Do not read the reference sentence aloud as if it were the only valid wording: the goal is understanding, not recitation."
  ].join("\n")
});

export const AssessExplanationsSkill = makeAssessExplanationsSkill({ autoExplain: false });
