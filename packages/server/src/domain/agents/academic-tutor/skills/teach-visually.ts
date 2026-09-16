import { diagramLimits } from "@proxus/shared";
import { AgentSkill } from "../../harness/index.ts";

export interface TeachVisuallyOptions {
  /** Draw a diagram on the tutor's own initiative when the topic calls for it. */
  readonly autoDiagram: boolean;
}

/**
 * Worked examples the skill quotes. They are also validated by the evals, so
 * the model never learns from an example the system would reject.
 */
export const teachVisuallyExamples = {
  process: {
    kind: "diagram",
    title: "El ciclo del agua: fases",
    diagramType: "process",
    summary: "Las cuatro fases del ciclo del agua se encadenan en un bucle: el agua se evapora, se condensa en nubes, precipita y vuelve a recogerse; las plantas y el hielo aportan vapor extra.",
    source: { materialId: "<materialId>", pages: [1, 2, 3] },
    nodes: [
      { id: "evaporacion", label: "Evaporación", sublabel: "líquido → vapor por el calor del sol", kind: "step", pages: [1], description: "El calor del sol convierte el agua líquida de océanos, ríos y lagos en vapor que sube a la atmósfera." },
      { id: "condensacion", label: "Condensación", sublabel: "vapor → gotas; forma las nubes", kind: "step", pages: [1], description: "El vapor se enfría en altura y forma nubes compuestas por gotas diminutas." },
      { id: "precipitacion", label: "Precipitación", sublabel: "las gotas caen como lluvia, nieve o granizo", kind: "step", pages: [2], description: "Cuando las gotas crecen, caen como lluvia, nieve o granizo según la temperatura." },
      { id: "recoleccion", label: "Recolección", sublabel: "el agua vuelve al mar o al subsuelo", kind: "step", pages: [2], description: "El agua vuelve a océanos y lagos (escorrentía) o se filtra al subsuelo formando acuíferos (infiltración)." },
      { id: "sol", label: "Sol", sublabel: "fuente de calor que evapora el agua", kind: "agent", pages: [1], description: "El calor del sol es lo que convierte el agua líquida en vapor en la fase de evaporación." },
      { id: "plantas", label: "Plantas", sublabel: "aportan vapor por transpiración", kind: "agent", pages: [2], description: "Las plantas liberan vapor de agua (transpiración) que se suma al vapor procedente de la evaporación." },
      { id: "escorrentia", label: "Escorrentía", sublabel: "agua que fluye por la superficie", kind: "definition", pages: [2, 3], description: "Agua que fluye por la superficie hacia ríos y mares." },
      { id: "infiltracion", label: "Infiltración", sublabel: "agua que se filtra al subsuelo", kind: "definition", pages: [2], description: "Agua que se filtra al subsuelo a través del terreno y forma acuíferos." }
    ],
    mainPath: ["evaporacion", "condensacion", "precipitacion", "recoleccion"],
    cyclic: true,
    edges: [
      { from: "evaporacion", to: "condensacion", label: "el vapor se enfría en altura" },
      { from: "condensacion", to: "precipitacion", label: "las gotas crecen y pesan" },
      { from: "precipitacion", to: "recoleccion", label: "el agua llega al suelo" },
      { from: "recoleccion", to: "evaporacion", label: "el agua vuelve a calentarse" },
      { from: "sol", to: "evaporacion", label: "calienta el agua" },
      { from: "plantas", to: "condensacion", label: "aportan vapor" },
      { from: "recoleccion", to: "escorrentia", label: "una vía es" },
      { from: "recoleccion", to: "infiltracion", label: "otra vía es" }
    ],
    groups: [{ id: "destinos", label: "Destinos del agua", nodeIds: ["recoleccion", "escorrentia", "infiltracion"] }],
    cards: [
      { title: "Claves", items: ["Cuatro fases en bucle: evaporación, condensación, precipitación, recolección.", "Transpiración y sublimación aportan vapor extra a la atmósfera."], pages: [1, 2] },
      { title: "Definiciones", items: ["Acuífero: capa subterránea de roca permeable que almacena agua.", "Humedad relativa: porcentaje de vapor respecto al máximo posible."], pages: [3] },
      { title: "Fechas", items: ["Perrault (1674): trabajos que consolidan la teoría moderna del ciclo.", "Mariotte (1686): continúa esa consolidación en el siglo XVII."], pages: [3] }
    ],
    views: [
      { label: "Fases", focus: ["evaporacion", "condensacion", "precipitacion", "recoleccion"], note: "El bucle principal." },
      { label: "Aportes de vapor", focus: ["sol", "plantas", "evaporacion", "condensacion"], note: "Quién pone el vapor en la atmósfera." }
    ]
  },
  conceptMap: {
    kind: "diagram",
    title: "Rendimiento de un procesador",
    diagramType: "concept-map",
    summary: "El rendimiento se mide por el tiempo de ejecución, que se calcula a partir de las instrucciones, los ciclos por instrucción y el tiempo de ciclo.",
    source: { materialId: "<materialId>", pages: [4, 5] },
    rootId: "rendimiento",
    nodes: [
      { id: "rendimiento", label: "Rendimiento", sublabel: "inverso del tiempo de ejecución", kind: "quantity", pages: [4], description: "Medida de lo rápido que un procesador ejecuta un programa; a menor tiempo de ejecución, mayor rendimiento." },
      { id: "tiempo-cpu", label: "Tiempo de CPU", sublabel: "tiempo que la CPU dedica al programa", kind: "quantity", pages: [4], description: "Tiempo que la CPU dedica a ejecutar el programa, sin contar esperas de entrada/salida." },
      { id: "ecuacion", label: "Ecuación del tiempo de CPU", sublabel: "Tiempo = IC × CPI × Tc", kind: "formula", formula: "Tiempo de CPU = IC × CPI × Tc", pages: [5], description: "El tiempo de CPU es el producto del número de instrucciones, los ciclos por instrucción y el tiempo de ciclo del reloj." },
      { id: "ic", label: "IC", sublabel: "número de instrucciones ejecutadas", kind: "quantity", pages: [5], description: "Instruction count: número de instrucciones que ejecuta el programa; depende del compilador y del repertorio." },
      { id: "cpi", label: "CPI", sublabel: "ciclos medios por instrucción", kind: "quantity", pages: [5], description: "Ciclos por instrucción: media de ciclos de reloj que consume cada instrucción; depende de la microarquitectura." },
      { id: "tc", label: "Tiempo de ciclo", sublabel: "duración de un ciclo de reloj", kind: "definition", pages: [5], description: "Inverso de la frecuencia de reloj; lo fija la tecnología y la organización del procesador." }
    ],
    edges: [
      { from: "rendimiento", to: "tiempo-cpu", label: "es inverso del" },
      { from: "tiempo-cpu", to: "ecuacion", label: "se calcula con" },
      { from: "ecuacion", to: "ic", label: "depende de" },
      { from: "ecuacion", to: "cpi", label: "depende de" },
      { from: "ecuacion", to: "tc", label: "depende de" },
      { from: "ic", to: "cpi", label: "se intercambia con" }
    ],
    groups: [{ id: "factores", label: "Factores de la ecuación", nodeIds: ["ic", "cpi", "tc"] }],
    cards: [
      { title: "Claves", items: ["Mejorar el rendimiento es reducir el tiempo de CPU.", "Reducir un factor suele subir otro: menos instrucciones más complejas elevan el CPI."], pages: [4, 5] },
      { title: "Fórmulas", items: ["Tiempo de CPU = IC × CPI × Tc", "Frecuencia = 1 / Tc"], pages: [5] }
    ]
  },
  timeline: {
    kind: "diagram",
    title: "Evolución de la idea de arquitectura",
    diagramType: "timeline",
    summary: "La idea de arquitectura pasó de describir el repertorio de instrucciones a abarcar la organización interna y, después, a medirse con métricas cuantitativas.",
    source: { materialId: "<materialId>", pages: [2, 3] },
    phases: ["Primeros computadores", "Década de 1980", "Actualidad"],
    nodes: [
      { id: "repertorio", label: "Arquitectura = repertorio", sublabel: "lo que ve el programador", kind: "step", phase: "Primeros computadores", pages: [2], description: "Al principio la arquitectura era el conjunto de instrucciones y registros visibles para el programador." },
      { id: "organizacion", label: "Se añade la organización", sublabel: "cómo se implementa por dentro", kind: "step", phase: "Década de 1980", pages: [2], description: "La arquitectura pasa a incluir la organización interna: segmentación, memoria caché, unidades funcionales." },
      { id: "cuantitativo", label: "Enfoque cuantitativo", sublabel: "decidir midiendo el rendimiento", kind: "step", phase: "Actualidad", pages: [3], description: "Las decisiones de diseño se toman midiendo su efecto en el tiempo de ejecución con programas de prueba." },
      { id: "compilador", label: "Compilador", sublabel: "traduce y decide qué instrucciones se usan", kind: "agent", pages: [2], description: "El compilador determina qué instrucciones del repertorio se usan y con qué frecuencia." },
      { id: "benchmarks", label: "Programas de prueba", sublabel: "cargas con las que se mide", kind: "example", pages: [3], description: "Conjuntos de programas representativos con los que se mide el rendimiento para comparar diseños." }
    ],
    mainPath: ["repertorio", "organizacion", "cuantitativo"],
    edges: [
      { from: "repertorio", to: "organizacion", label: "importa cómo se implementa" },
      { from: "organizacion", to: "cuantitativo", label: "hay que medir para elegir" },
      { from: "compilador", to: "repertorio", label: "explota el" },
      { from: "benchmarks", to: "cuantitativo", label: "alimentan el" }
    ],
    cards: [{ title: "Claves", items: ["Arquitectura = repertorio + organización + hardware.", "Diseñar es medir: el tiempo de ejecución decide."], pages: [2, 3] }]
  }
} as const;

const example = (value: unknown) => JSON.stringify(value);

export const makeTeachVisuallySkill = (options: TeachVisuallyOptions) => AgentSkill.make({
  name: "teach-visually",
  description: options.autoDiagram
    ? "Decide when a topic is better understood as a diagram (process, cycle, timeline, hierarchy, related concepts) and create one anchored to the material pages; load it whenever you explain a process or a set of related concepts, or the student asks for an esquema, mapa or diagrama."
    : "Create a diagram (process, cycle, timeline, hierarchy, related concepts) anchored to the material pages when the student asks for an esquema, mapa or diagrama.",
  content: [
    "# Teach visually",
    "",
    "A diagram is a visual summary that saves reading: each box says what a concept is, each arrow says how or why two concepts relate, and cards under the drawing keep what does not fit in boxes (definitions, formulas, dates). The student explores it in the panel (zoom, focus, follow relations, jump to the pages). It is not an exercise.",
    "",
    "## Draw the knowledge, not the document",
    "- Nodes are concepts, quantities, formulas, definitions, steps, agents or examples. Never section titles or chapter names.",
    "- Every edge is a proposition you could read aloud: \"Tiempo de CPU —se calcula con→ IC × CPI × Tc\", \"el vapor —se enfría en altura→ condensación\". Never \"incluye\", \"contiene\", \"trata de\": the system rejects a map made of those.",
    "- Before creating it, check the diagram answers three questions about the topic: what is it? what does it depend on or what causes it? what happens next?",
    "- For technical material: quantities (`quantity`), formulas with their expression (`formula` + `formula`), definitions (`definition`), and relations such as \"se calcula como\", \"depende de\", \"es inverso de\", \"es un tipo de\".",
    "- For processes and narratives: steps (`step`) with the cause of every transition, who or what acts (`agent`), what decides a branch (`condition`).",
    "",
    "## When a diagram helps",
    "- Steps, phases or stages in order (`process`; `cyclic: true` for cycles).",
    "- An evolution over time or a pipeline with stages (`timeline` with `phases`).",
    "- Parts of a whole, types of something, or concepts defined through each other (`concept-map`; a hierarchy is a concept map with the parent as root).",
    "- Signals: \"fases\", \"etapas\", \"primero… después\", \"se compone de\", \"tipos de\", \"provoca\", \"se calcula\", \"evolucionó\".",
    "",
    "## When it does not",
    "- A single fact or definition, a direct question, or pages you have not rendered: answer in text.",
    "- Lists of dates, isolated definitions or tables never become boxes: they go into `cards` of a diagram about the topic, or into a `note` if there is no structure to draw.",
    "",
    ...(options.autoDiagram
      ? [
          "## On your own initiative",
          "- When you explain a process, a cycle, an evolution, a hierarchy or a set of related concepts from the material, create the diagram in the same turn, after rendering the pages, and answer with the explanation. The interface shows an \"Abrir\" card next to your answer; you do not need to ask first.",
          "- Do not create one when the student asks a direct question about a single fact or definition, or only wants a short answer.",
          ""
        ]
      : []),
    "## How to build it",
    "1. Render the pages first (`materials view`). Every node and every card cites the page(s) that explain it; the system rejects pages you have not rendered.",
    `2. ${diagramLimits.nodes.min}-${diagramLimits.nodes.max} nodes, ideally 6-12. Each node: \`label\` (${diagramLimits.label.min}-${diagramLimits.label.max} characters), \`sublabel\` (${diagramLimits.sublabel.min}-${diagramLimits.sublabel.max} characters, one line saying what it is, shown in the box), \`kind\`, \`description\` (${diagramLimits.description.min}-${diagramLimits.description.max} characters with what the material says, not general knowledge), \`pages\`.`,
    "3. `process` / `timeline`: `mainPath` lists the step ids in order. Add an edge between each pair of consecutive steps with the cause of the transition (at least 80 % of the stretches); `cyclic: true` when the last step leads back to the first; `timeline` also needs `phases` in order and a `phase` on every step. Agents and concepts go beside the path, connected to a step with a labelled edge.",
    "4. `concept-map`: `rootId` is the central concept; every edge has a label; at least as many relations as concepts minus one, with at least three different kinds of relation.",
    "5. `groups` (optional, up to 6): concepts that belong together, e.g. the sub-steps of a step or the factors of a formula. `views` (optional, up to 4): subsets worth looking at together, with a short note.",
    `6. \`cards\` (1-${diagramLimits.cards.max}; required for concept maps and when you cite 3 or more pages): "Claves" (always), "Definiciones" / "Fórmulas" (if the material has them), "Fechas" or "Errores típicos" (if it has them). ${diagramLimits.cards.items.min}-${diagramLimits.cards.items.max} items of at most ${diagramLimits.cards.item.max} characters, each card with its pages.`,
    "7. Ids are short lower-case slugs without accents (`condensacion`). Do not use apostrophes or single quotes anywhere in the JSON: it goes inside single quotes on the command line.",
    "8. Persist it with `artifacts create '<json>'`. The response confirms `nodeCount` and `edgeCount`.",
    "",
    "Examples (replace `<materialId>` with the id from `materials list`):",
    `- Process with causes, agents, a group and cards: \`artifacts create '${example(teachVisuallyExamples.process)}'\``,
    `- Concept map of a technical topic, with a formula: \`artifacts create '${example(teachVisuallyExamples.conceptMap)}'\``,
    `- Timeline with phases: \`artifacts create '${example(teachVisuallyExamples.timeline)}'\``,
    "",
    "## If the system rejects it",
    "- A result starting with `DIAGRAM_INVALID` lists every problem with a hint. Fix all of them and call `artifacts create` again with the full JSON.",
    "- At most two attempts. If the second one is rejected too, explain the structure in text and offer a `note`.",
    "",
    "## After creating it",
    "- Reply with two or three sentences: what the diagram shows (type, number of concepts, which pages it covers) and an invitation to open it from the panel. Do not list the nodes or repeat the descriptions or the cards in the chat.",
    "- If the student later asks about a concept of the diagram (the interface tells you which node is open), explain it from the pages it cites; use `artifacts show <id>` if you need the full diagram."
  ].join("\n")
});

export const TeachVisuallySkill = makeTeachVisuallySkill({ autoDiagram: true });
