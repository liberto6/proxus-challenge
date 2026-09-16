import { diagramLimits } from "@proxus/shared";
import { AgentSkill } from "../../harness/index.ts";

export interface TeachVisuallyOptions {
  /** Draw a diagram on the tutor's own initiative when the topic calls for it. */
  readonly autoDiagram: boolean;
}

const processExample = JSON.stringify({
  kind: "diagram",
  title: "El ciclo del agua: fases",
  diagramType: "process",
  summary: "Las cuatro fases del ciclo del agua se encadenan en un bucle: el agua se evapora, se condensa en nubes, precipita y vuelve a recogerse.",
  source: { materialId: "<materialId>", pages: [1, 2] },
  nodes: [
    { id: "evaporacion", label: "Evaporación", description: "El calor del sol convierte el agua líquida de océanos, ríos y lagos en vapor que sube a la atmósfera.", pages: [1] },
    { id: "condensacion", label: "Condensación", description: "El vapor se enfría en altura y forma nubes compuestas por gotas diminutas.", pages: [1] },
    { id: "precipitacion", label: "Precipitación", description: "Cuando las gotas crecen, caen como lluvia, nieve o granizo según la temperatura.", pages: [2] },
    { id: "recoleccion", label: "Recolección", description: "El agua vuelve a océanos y lagos (escorrentía) o se filtra al subsuelo formando acuíferos (infiltración).", pages: [2] },
    { id: "transpiracion", label: "Transpiración", description: "Las plantas liberan vapor de agua que se suma al vapor procedente de la evaporación.", pages: [2] }
  ],
  mainPath: ["evaporacion", "condensacion", "precipitacion", "recoleccion"],
  cyclic: true,
  edges: [{ from: "transpiracion", to: "condensacion", label: "aporta vapor" }]
});

const conceptMapExample = JSON.stringify({
  kind: "diagram",
  title: "Recolección del agua",
  diagramType: "concept-map",
  summary: "La recolección devuelve el agua a la superficie o al subsuelo; cada vía tiene su concepto asociado.",
  source: { materialId: "<materialId>", pages: [2, 3] },
  rootId: "recoleccion",
  nodes: [
    { id: "recoleccion", label: "Recolección", description: "Fase en la que el agua vuelve a océanos y lagos o se filtra al subsuelo.", pages: [2] },
    { id: "escorrentia", label: "Escorrentía", description: "Agua que fluye por la superficie hacia ríos y mares.", pages: [2, 3] },
    { id: "infiltracion", label: "Infiltración", description: "Agua que se filtra al subsuelo a través del terreno.", pages: [2] },
    { id: "acuifero", label: "Acuífero", description: "Capa subterránea de roca permeable que almacena el agua infiltrada.", pages: [2, 3] }
  ],
  edges: [
    { from: "recoleccion", to: "escorrentia", label: "una vía es" },
    { from: "recoleccion", to: "infiltracion", label: "otra vía es" },
    { from: "infiltracion", to: "acuifero", label: "forma" }
  ]
});

export const makeTeachVisuallySkill = (options: TeachVisuallyOptions) => AgentSkill.make({
  name: "teach-visually",
  description: options.autoDiagram
    ? "Decide when a topic is better understood as a diagram (process, cycle, hierarchy, related concepts) and create one anchored to the material pages; load it whenever you explain a process or a set of related concepts, or the student asks for an esquema, mapa or diagrama."
    : "Create a diagram (process, cycle, hierarchy, related concepts) anchored to the material pages when the student asks for an esquema, mapa or diagrama.",
  content: [
    "# Teach visually",
    "",
    "A diagram is a visual summary of how the concepts of a topic relate: what the pieces are and how they connect. The student explores it in the panel (zoom, focus on a node, follow relations, jump to the pages). It is not an exercise.",
    "",
    "## When a diagram helps",
    "- The material presents steps, phases or stages in order (`process`), including cycles (`process` with `cyclic: true`).",
    "- The material presents parts of a whole, types of something, or concepts defined through each other (`concept-map`). A hierarchy is a concept map with the parent as root and edges such as \"es un tipo de\" or \"es parte de\".",
    "- Signals in the text: \"fases\", \"etapas\", \"primero… después\", \"se compone de\", \"tipos de\", \"provoca\", \"da lugar a\".",
    "",
    "## When it does not",
    "- Lists of dates or events without causal links, isolated definitions, tables of data, a single concept, or pages you have not rendered.",
    "- In those cases say so in one sentence and offer a `note` or a `quiz` instead. Never draw a list.",
    "",
    ...(options.autoDiagram
      ? [
          "## On your own initiative",
          "- When you explain a process, a cycle, a hierarchy or a set of related concepts from the material, create the diagram in the same turn, after rendering the pages, and answer with the explanation. The interface shows an \"Abrir\" card next to your answer; you do not need to ask first.",
          "- Do not create one when the student asks a direct question about a single fact or definition, or only wants a short answer.",
          ""
        ]
      : []),
    "## How to build it",
    "1. Render the pages first (`materials view`). Every node must cite the page(s) that explain it; the system rejects pages you have not rendered.",
    `2. Between ${diagramLimits.nodes.min} and ${diagramLimits.nodes.max} nodes. Label: ${diagramLimits.label.min}-${diagramLimits.label.max} characters. Description: ${diagramLimits.description.min}-${diagramLimits.description.max} characters with what the material says about the concept, not general knowledge. Summary: ${diagramLimits.summary.min}-${diagramLimits.summary.max} characters.`,
    "3. `process`: `mainPath` lists the step ids in order (their edges are implicit); `cyclic: true` when the last step leads back to the first; `edges` only for side concepts that feed a step, always with a label.",
    "4. `concept-map`: `rootId` is the central concept; every edge has a label that states the relation (\"es parte de\", \"provoca\", \"es un tipo de\"). Every node connects to the root through some chain of edges.",
    "5. Ids are short lower-case slugs without accents (`condensacion`). Do not use apostrophes or single quotes in labels or descriptions: the JSON goes inside single quotes on the command line.",
    "6. Persist it with `artifacts create '<json>'`. The response confirms `nodeCount` and `edgeCount`.",
    "",
    "Examples (replace `<materialId>` with the id from `materials list`):",
    `- \`artifacts create '${processExample}'\``,
    `- \`artifacts create '${conceptMapExample}'\``,
    "",
    "## If the system rejects it",
    "- A result starting with `DIAGRAM_INVALID` lists every problem with a hint. Fix all of them and call `artifacts create` again with the full JSON.",
    "- At most two attempts. If the second one is rejected too, explain the structure in text and offer a `note`.",
    "",
    "## After creating it",
    "- Reply with two or three sentences: what the diagram shows (type, number of concepts, which pages it covers) and an invitation to open it from the panel. Do not list the nodes or repeat the descriptions in the chat.",
    "- If the student later asks about a concept of the diagram (the interface tells you which node is open), explain it from the pages it cites; use `artifacts show <id>` if you need the full diagram."
  ].join("\n")
});

export const TeachVisuallySkill = makeTeachVisuallySkill({ autoDiagram: true });
