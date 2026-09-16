import { diagramLimits, type CreateDiagramArtifactInput } from "@proxus/shared";

/**
 * Diagram rules the schema cannot express: unique ids, edges over existing
 * nodes, every node anchored to pages that exist and were read, and a shape
 * that is a structure rather than a list in disguise.
 *
 * `normalizeDiagramInput` fixes what can be fixed without losing information
 * (ids to slugs, a single page number to an array, duplicate edges). Everything
 * else comes back from `validateDiagram` as issues with a hint, all at once, so
 * the model can repair the JSON in one round trip.
 */

export interface DiagramIssue {
  readonly code: DiagramIssueCode;
  readonly message: string;
}

export type DiagramIssueCode =
  | "duplicate-node-id"
  | "node-count"
  | "label-length"
  | "description-length"
  | "summary-length"
  | "edge-unknown-node"
  | "edge-self-loop"
  | "edge-count"
  | "edge-label-length"
  | "node-no-pages"
  | "node-page-outside-source"
  | "source-required"
  | "page-out-of-range"
  | "page-not-rendered"
  | "node-disconnected"
  | "process-main-path"
  | "process-side-edge-label"
  | "concept-map-root"
  | "concept-map-edge-label"
  | "concept-map-unreachable"
  | "degenerate-list"
  | "node-sublabel"
  | "node-kind"
  | "transition-labels"
  | "density"
  | "outline-like"
  | "group-members"
  | "card-shape"
  | "view-focus"
  | "timeline-phases";

export interface DiagramValidationContext {
  /** Pages of the source material; when known, cited pages must be within 1..pageCount. */
  readonly pageCount?: number | undefined;
  /** Pages of the source material rendered in this conversation; when known, cited pages must be among them. */
  readonly renderedPages?: ReadonlySet<number> | undefined;
}

// --- Normalization ------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Lower-case ASCII slug: "Condensación" -> "condensacion". Empty input stays empty so validation reports it. */
export const slugId = (value: string): string => value
  .trim()
  .toLocaleLowerCase()
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40);

const normalizePages = (pages: unknown): unknown => {
  if (typeof pages === "number") return [pages];
  if (typeof pages === "string" && /^\d+$/.test(pages.trim())) return [Number(pages)];
  if (Array.isArray(pages)) {
    const numbers = pages.map((page) => typeof page === "string" && /^\d+$/.test(page.trim()) ? Number(page) : page);
    return [...new Set(numbers)];
  }
  return pages;
};

const normalizeId = (id: unknown): unknown => typeof id === "string" ? slugId(id) : id;

/**
 * One line for the box when the model sent none: the first sentence of the
 * description, cut to the limit. Derived, not invented; the skill still asks
 * for a real sublabel.
 */
export const deriveSublabel = (description: string): string => {
  const first = description.trim().split(/(?<=[.;:!?])\s/)[0] ?? "";
  const max = diagramLimits.sublabel.max;
  return first.length <= max ? first : `${first.slice(0, max - 1).trimEnd()}…`;
};

const normalizeNode = (node: unknown): unknown => {
  if (!isRecord(node)) return node;
  const description = typeof node.description === "string" ? node.description.trim() : node.description;
  const sublabel = typeof node.sublabel === "string" && node.sublabel.trim().length > 0
    ? node.sublabel.trim()
    : typeof description === "string" && description.length > 0 ? deriveSublabel(description) : node.sublabel;
  return {
    ...node,
    id: normalizeId(node.id),
    label: typeof node.label === "string" ? node.label.trim() : node.label,
    description,
    pages: normalizePages(node.pages),
    ...(sublabel === undefined ? {} : { sublabel }),
    ...(typeof node.kind === "string" ? { kind: node.kind.trim().toLocaleLowerCase() } : {}),
    ...(typeof node.formula === "string" ? { formula: node.formula.trim() } : {}),
    ...(typeof node.phase === "string" ? { phase: node.phase.trim() } : {})
  };
};

const normalizeGroup = (group: unknown): unknown => isRecord(group)
  ? {
      ...group,
      id: normalizeId(group.id),
      label: typeof group.label === "string" ? group.label.trim() : group.label,
      nodeIds: Array.isArray(group.nodeIds) ? [...new Set(group.nodeIds.map(normalizeId))] : group.nodeIds
    }
  : group;

const normalizeView = (view: unknown): unknown => isRecord(view)
  ? {
      ...view,
      focus: Array.isArray(view.focus) ? [...new Set(view.focus.map(normalizeId))] : view.focus
    }
  : view;

const normalizeCard = (card: unknown): unknown => isRecord(card)
  ? {
      ...card,
      title: typeof card.title === "string" ? card.title.trim() : card.title,
      items: Array.isArray(card.items) ? card.items.map((item) => typeof item === "string" ? item.trim() : item).filter((item) => item !== "") : card.items,
      pages: normalizePages(card.pages ?? [])
    }
  : card;

const normalizeEdge = (edge: unknown): unknown => isRecord(edge)
  ? {
      ...edge,
      from: normalizeId(edge.from),
      to: normalizeId(edge.to),
      ...(typeof edge.label === "string" ? { label: edge.label.trim() } : {})
    }
  : edge;

/**
 * Lossless clean-up of a diagram input before decoding: slug ids everywhere,
 * `pages: 2` as `[2]`, trimmed text, a sublabel derived from the description
 * when missing, and exact duplicate edges removed. An edge between two
 * consecutive steps is kept: it is the labelled transition of that stretch.
 * Non-diagram inputs are returned untouched.
 */
export const normalizeDiagramInput = (input: unknown): unknown => {
  if (!isRecord(input) || input.kind !== "diagram") {
    return input;
  }

  const nodes = Array.isArray(input.nodes) ? input.nodes.map(normalizeNode) : input.nodes;
  const mainPath = Array.isArray(input.mainPath) ? input.mainPath.map(normalizeId) : input.mainPath;
  const rootId = normalizeId(input.rootId);

  const seen = new Set<string>();
  const edges = Array.isArray(input.edges)
    ? input.edges.map(normalizeEdge).filter((edge) => {
        if (!isRecord(edge) || typeof edge.from !== "string" || typeof edge.to !== "string") return true;
        const key = `${edge.from}->${edge.to}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    : input.edges;

  return {
    ...input,
    ...(typeof input.summary === "string" ? { summary: input.summary.trim() } : {}),
    nodes,
    edges,
    ...(mainPath === undefined ? {} : { mainPath }),
    ...(rootId === undefined ? {} : { rootId }),
    ...(Array.isArray(input.phases) ? { phases: input.phases.map((phase) => typeof phase === "string" ? phase.trim() : phase) } : {}),
    ...(Array.isArray(input.groups) ? { groups: input.groups.map(normalizeGroup) } : {}),
    ...(Array.isArray(input.cards) ? { cards: input.cards.map(normalizeCard) } : {}),
    ...(Array.isArray(input.views) ? { views: input.views.map(normalizeView) } : {})
  };
};

// --- Validation ---------------------------------------------------------------

const issue = (code: DiagramIssueCode, message: string): DiagramIssue => ({ code, message });

const formatPages = (pages: Iterable<number>): string => [...pages].sort((a, b) => a - b).join(", ");

/** All the problems of a decoded diagram input, in a stable order. Empty when the diagram is acceptable. */
export const validateDiagram = (
  input: CreateDiagramArtifactInput,
  context: DiagramValidationContext = {}
): readonly DiagramIssue[] => {
  const issues: DiagramIssue[] = [];
  const limits = diagramLimits;

  // Nodes: ids, counts, text lengths.
  const ids = new Set<string>();
  for (const node of input.nodes) {
    if (node.id.length === 0) {
      issues.push(issue("duplicate-node-id", `A node has an empty id after normalization. Give every node a short id like "condensacion".`));
    } else if (ids.has(node.id)) {
      issues.push(issue("duplicate-node-id", `Node id "${node.id}" is used more than once. Rename one of the nodes with id "${node.id}".`));
    }
    ids.add(node.id);
  }
  if (input.nodes.length < limits.nodes.min || input.nodes.length > limits.nodes.max) {
    issues.push(issue("node-count", input.nodes.length < limits.nodes.min
      ? `The diagram has ${input.nodes.length} node(s); it needs at least ${limits.nodes.min}. A structure with fewer concepts is better explained as text.`
      : `The diagram has ${input.nodes.length} nodes; the maximum is ${limits.nodes.max}. Merge or drop minor concepts; keep the ${limits.nodes.max} that matter.`));
  }
  const sequential = input.diagramType === "process" || input.diagramType === "timeline";
  const stepIds = new Set(input.mainPath ?? []);
  for (const node of input.nodes) {
    if (node.label.length < limits.label.min || node.label.length > limits.label.max) {
      issues.push(issue("label-length", `Label of node "${node.id}" has ${node.label.length} characters; it must have ${limits.label.min}-${limits.label.max}.`));
    }
    if (node.description.length < limits.description.min || node.description.length > limits.description.max) {
      issues.push(issue("description-length", `Description of node "${node.id}" has ${node.description.length} characters; it must have ${limits.description.min}-${limits.description.max}. Say what the material explains about it.`));
    }
    // The one-line "what it is" shown inside the box.
    const sublabel = node.sublabel ?? "";
    if (sublabel.length < limits.sublabel.min || sublabel.length > limits.sublabel.max) {
      issues.push(issue("node-sublabel", sublabel.length === 0
        ? `Node "${node.id}" has no sublabel. Add one line (${limits.sublabel.min}-${limits.sublabel.max} characters) saying what the concept is, e.g. "líquido → vapor por el calor del sol".`
        : `Sublabel of node "${node.id}" has ${sublabel.length} characters; it must have ${limits.sublabel.min}-${limits.sublabel.max}.`));
    }
    if (node.kind === "formula" && (node.formula === undefined || node.formula.trim().length === 0)) {
      issues.push(issue("node-kind", `Node "${node.id}" is a formula but has no "formula" text. Add the expression, e.g. "Tiempo de CPU = IC × CPI × Tc".`));
    }
    if (sequential && stepIds.has(node.id) && node.kind !== undefined && node.kind !== "step") {
      issues.push(issue("node-kind", `Node "${node.id}" is a step of mainPath, so its kind must be "step" (it is "${node.kind}"). Agents, conditions and concepts go beside the path, not on it.`));
    }
  }
  if (input.summary.length < limits.summary.min || input.summary.length > limits.summary.max) {
    issues.push(issue("summary-length", `The summary has ${input.summary.length} characters; it must have ${limits.summary.min}-${limits.summary.max}.`));
  }

  // Edges: references, loops, counts, labels.
  const validIds = [...ids].filter((id) => id.length > 0).join(", ");
  input.edges.forEach((edge, index) => {
    for (const endpoint of [edge.from, edge.to]) {
      if (!ids.has(endpoint)) {
        issues.push(issue("edge-unknown-node", `Edge ${index + 1} points to "${endpoint}", which is not a node id. Valid ids: ${validIds}.`));
      }
    }
    if (edge.from === edge.to) {
      issues.push(issue("edge-self-loop", `Edge ${index + 1} connects "${edge.from}" to itself. Remove it.`));
    }
    if (edge.label !== undefined && (edge.label.length < limits.edgeLabel.min || edge.label.length > limits.edgeLabel.max)) {
      issues.push(issue("edge-label-length", `Label of edge ${index + 1} ("${edge.from}" -> "${edge.to}") has ${edge.label.length} characters; it must have ${limits.edgeLabel.min}-${limits.edgeLabel.max}.`));
    }
  });
  if (input.edges.length > limits.edges.max) {
    issues.push(issue("edge-count", `The diagram has ${input.edges.length} edges; the maximum is ${limits.edges.max}. Keep the relations that matter.`));
  }

  // Pages: every node cites pages, within the source, the material and what was read.
  const sourcePages = new Set(input.source?.pages ?? []);
  if (input.source === undefined || sourcePages.size === 0) {
    issues.push(issue("source-required", `Diagrams are always built from rendered pages: include "source": {"materialId": "<id>", "pages": [..]} with the pages you rendered.`));
  }
  for (const node of input.nodes) {
    if (node.pages.length < limits.pagesPerNode.min || node.pages.length > limits.pagesPerNode.max) {
      issues.push(issue("node-no-pages", node.pages.length === 0
        ? `Node "${node.id}" has no pages. Every node must cite the page(s) where the material explains it${context.renderedPages === undefined ? "" : ` (pages rendered: ${formatPages(context.renderedPages)})`}.`
        : `Node "${node.id}" cites ${node.pages.length} pages; the maximum is ${limits.pagesPerNode.max}.`));
      continue;
    }
    const outside = node.pages.filter((page) => !sourcePages.has(page));
    if (outside.length > 0 && sourcePages.size > 0) {
      issues.push(issue("node-page-outside-source", `Node "${node.id}" cites page(s) ${formatPages(outside)}, which are not in source.pages (${formatPages(sourcePages)}). Add them to source.pages or fix the node.`));
    }
  }
  if (context.pageCount !== undefined) {
    const outOfRange = [...sourcePages].filter((page) => !Number.isInteger(page) || page < 1 || page > context.pageCount!);
    if (outOfRange.length > 0) {
      issues.push(issue("page-out-of-range", `source.pages includes ${formatPages(outOfRange)}, but the material has ${context.pageCount} page(s).`));
    }
  }
  if (context.renderedPages !== undefined) {
    const unread = [...sourcePages].filter((page) => !context.renderedPages!.has(page));
    if (unread.length > 0 && input.source !== undefined) {
      issues.push(issue("page-not-rendered", `source.pages includes ${formatPages(unread)}, which you have not rendered in this conversation. Call \`materials view ${input.source.materialId} ${formatPages(unread).replaceAll(" ", "")}\` first, or drop those pages.`));
    }
  }

  // Shape by type.
  const mainPath = input.mainPath ?? [];
  const touched = new Set<string>();
  for (const edge of input.edges) {
    touched.add(edge.from);
    touched.add(edge.to);
  }

  if (sequential) {
    const pathIds = new Set(mainPath);
    const unknownSteps = mainPath.filter((id) => !ids.has(id));
    if (mainPath.length < 3 || unknownSteps.length > 0 || pathIds.size !== mainPath.length) {
      issues.push(issue("process-main-path", unknownSteps.length > 0
        ? `mainPath names "${unknownSteps.join("\", \"")}", which are not node ids. Valid ids: ${validIds}.`
        : pathIds.size !== mainPath.length
          ? `mainPath repeats a step. List each step once, in order; set "cyclic": true if the last step leads back to the first.`
          : `A ${input.diagramType} needs "mainPath": the ordered ids of at least 3 steps. It has ${mainPath.length}.`));
    }
    // Every stretch of the path should state its cause: an edge between the two steps, labelled.
    if (mainPath.length >= 3 && unknownSteps.length === 0) {
      const stretches: string[] = [];
      for (let index = 0; index < mainPath.length; index++) {
        const next = index < mainPath.length - 1 ? mainPath[index + 1] : input.cyclic === true ? mainPath[0] : undefined;
        if (next !== undefined) stretches.push(`${mainPath[index]}->${next}`);
      }
      const labelled = new Set(input.edges.filter((edge) => edge.label !== undefined && edge.label.trim().length > 0).map((edge) => `${edge.from}->${edge.to}`));
      const missing = stretches.filter((stretch) => !labelled.has(stretch));
      if (stretches.length > 0 && missing.length > Math.floor(stretches.length * 0.2)) {
        issues.push(issue("transition-labels", `${stretches.length - missing.length} of ${stretches.length} steps of mainPath explain why the next step happens. Add an edge between consecutive steps with the cause, e.g. {"from":"${missing[0]!.split("->")[0]}","to":"${missing[0]!.split("->")[1]}","label":"el vapor se enfría en altura"}; at least ${Math.ceil(stretches.length * 0.8)} of ${stretches.length} are needed.`));
      }
    }
    input.edges.forEach((edge, index) => {
      if (edge.label === undefined || edge.label.trim().length === 0) {
        issues.push(issue("process-side-edge-label", `Edge ${index + 1} ("${edge.from}" -> "${edge.to}") needs a label saying how the concept relates to the step, e.g. "aporta vapor". Steps of the main path do not need edges.`));
      }
    });
    for (const node of input.nodes) {
      if (!pathIds.has(node.id) && !touched.has(node.id)) {
        issues.push(issue("node-disconnected", `Node "${node.id}" is neither a step of mainPath nor connected by an edge. Connect it or drop it.`));
      }
    }
    // More concepts hanging loose (not tied to a step, directly or through a group) than steps:
    // the process is not what the diagram shows.
    const attached = new Set<string>(pathIds);
    const groupsOf = new Map<string, readonly string[]>();
    for (const group of input.groups ?? []) {
      for (const member of group.nodeIds) groupsOf.set(member, group.nodeIds);
    }
    for (const node of input.nodes) {
      if (pathIds.has(node.id)) continue;
      const linkedToStep = input.edges.some((edge) => (edge.from === node.id && pathIds.has(edge.to)) || (edge.to === node.id && pathIds.has(edge.from)));
      const groupedWithStep = (groupsOf.get(node.id) ?? []).some((member) => pathIds.has(member));
      if (linkedToStep || groupedWithStep) attached.add(node.id);
    }
    const loose = input.nodes.length - attached.size;
    if (input.nodes.length >= limits.nodes.min && mainPath.length >= 3 && loose > mainPath.length) {
      issues.push(issue("degenerate-list", `${loose} of ${input.nodes.length} nodes are neither steps nor tied to a step; the process is not what the diagram shows. Put the list in a card, or connect each concept to the step it belongs to.`));
    }
    if (input.diagramType === "timeline") {
      const phases = input.phases ?? [];
      const unique = new Set(phases);
      const withoutPhase = mainPath.filter((id) => {
        const phase = input.nodes.find((node) => node.id === id)?.phase;
        return phase === undefined || !unique.has(phase);
      });
      if (phases.length === 0 || unique.size !== phases.length || withoutPhase.length > 0) {
        issues.push(issue("timeline-phases", phases.length === 0
          ? `A timeline needs "phases": the ordered list of periods or stages, and every step of mainPath names one in "phase".`
          : unique.size !== phases.length
            ? `"phases" repeats a name. List each phase once, in order.`
            : `Step(s) ${withoutPhase.map((id) => `"${id}"`).join(", ")} have no "phase" among ${phases.map((phase) => `"${phase}"`).join(", ")}.`));
      }
    }
  } else {
    const root = input.rootId;
    if (root === undefined || !ids.has(root)) {
      issues.push(issue("concept-map-root", root === undefined
        ? `A concept map needs "rootId": the id of the central concept.`
        : `rootId "${root}" is not a node id. Valid ids: ${validIds}.`));
    }
    input.edges.forEach((edge, index) => {
      if (edge.label === undefined || edge.label.trim().length === 0) {
        issues.push(issue("concept-map-edge-label", `Edge ${index + 1} ("${edge.from}" -> "${edge.to}") needs a label. A concept map states relations: "es parte de", "provoca", "es un tipo de".`));
      }
    });
    for (const node of input.nodes) {
      if (!touched.has(node.id)) {
        issues.push(issue("node-disconnected", `Node "${node.id}" has no edges. Connect it to another concept or drop it.`));
      }
    }
    if (root !== undefined && ids.has(root)) {
      const unreachable = input.nodes.filter((node) => !reachableFrom(root, input.edges).has(node.id) && touched.has(node.id));
      if (unreachable.length > 0) {
        issues.push(issue("concept-map-unreachable", `Node(s) ${unreachable.map((node) => `"${node.id}"`).join(", ")} are not connected to the root "${root}" through any chain of edges.`));
      }
      if (isStarList(root, input)) {
        issues.push(issue("degenerate-list", `Every edge goes from "${root}" to a leaf with the same label and the leaves are unrelated to each other. This is a list, not a structure: put the list in a card, or add the relations between the concepts.`));
      }
    }
    // A map with fewer relations than concepts, or with one relation repeated everywhere, is a table of contents.
    if (input.nodes.length >= 5) {
      const distinctLabels = new Set(input.edges.map((edge) => (edge.label ?? "").trim().toLocaleLowerCase()).filter((label) => label.length > 0));
      if (input.edges.length < input.nodes.length - 1 || distinctLabels.size < 3) {
        issues.push(issue("density", `${input.nodes.length} concepts with ${input.edges.length} relation(s) and ${distinctLabels.size} distinct label(s). A concept map needs at least ${input.nodes.length - 1} relations and 3 different kinds of relation ("depende de", "se calcula como", "es un tipo de").`));
      }
    }
  }

  // The outline of the document is not knowledge: section titles joined by "incluye" or "contiene".
  if (isOutlineLike(input)) {
    issues.push(issue("outline-like", `Most relations are "incluye", "contiene", "trata" or "se compone de" and no node is a definition, quantity or formula: this maps the document outline. Draw the knowledge instead: quantities, formulas and definitions, and how they relate ("se calcula como", "depende de", "es inverso de").`));
  }

  // Groups, cards and views.
  const groups = input.groups ?? [];
  if (groups.length > limits.groups.max) {
    issues.push(issue("group-members", `${groups.length} groups; the maximum is ${limits.groups.max}.`));
  }
  const groupIds = new Set<string>();
  const grouped = new Map<string, string>();
  for (const group of groups) {
    if (groupIds.has(group.id)) issues.push(issue("group-members", `Group id "${group.id}" is used more than once.`));
    groupIds.add(group.id);
    const unknown = group.nodeIds.filter((id) => !ids.has(id));
    if (unknown.length > 0) issues.push(issue("group-members", `Group "${group.id}" names ${unknown.map((id) => `"${id}"`).join(", ")}, which are not node ids.`));
    if (group.nodeIds.length < limits.groups.members.min || group.nodeIds.length > limits.groups.members.max) {
      issues.push(issue("group-members", `Group "${group.id}" has ${group.nodeIds.length} member(s); it needs ${limits.groups.members.min}-${limits.groups.members.max}.`));
    }
    for (const member of group.nodeIds) {
      const other = grouped.get(member);
      if (other !== undefined && other !== group.id) issues.push(issue("group-members", `Node "${member}" is in groups "${other}" and "${group.id}"; a node belongs to one group.`));
      grouped.set(member, group.id);
    }
  }

  const cards = input.cards ?? [];
  const cardsRequired = input.diagramType === "concept-map" || sourcePages.size >= 3;
  if (cards.length === 0 && cardsRequired) {
    issues.push(issue("card-shape", `Add 1-${limits.cards.max} "cards" under the drawing with what does not fit in boxes: key points, definitions and formulas, dates. Each card: {"title","items":[..],"pages":[..]}.`));
  }
  if (cards.length > limits.cards.max) {
    issues.push(issue("card-shape", `${cards.length} cards; the maximum is ${limits.cards.max}.`));
  }
  cards.forEach((card, index) => {
    if (card.title.trim().length === 0 || card.title.length > limits.cards.title.max) {
      issues.push(issue("card-shape", `Card ${index + 1} needs a title of at most ${limits.cards.title.max} characters.`));
    }
    if (card.items.length < limits.cards.items.min || card.items.length > limits.cards.items.max) {
      issues.push(issue("card-shape", `Card ${index + 1} ("${card.title}") has ${card.items.length} item(s); it needs ${limits.cards.items.min}-${limits.cards.items.max}.`));
    }
    const long = card.items.filter((item) => item.length > limits.cards.item.max);
    if (long.length > 0) issues.push(issue("card-shape", `Card ${index + 1} ("${card.title}") has ${long.length} item(s) longer than ${limits.cards.item.max} characters.`));
    const outside = card.pages.filter((page) => !sourcePages.has(page));
    if (card.pages.length === 0 || outside.length > 0) {
      issues.push(issue("card-shape", card.pages.length === 0
        ? `Card ${index + 1} ("${card.title}") cites no pages. Every card cites the page(s) its items come from.`
        : `Card ${index + 1} ("${card.title}") cites page(s) ${formatPages(outside)}, which are not in source.pages.`));
    }
  });

  const views = input.views ?? [];
  if (views.length > limits.views.max) {
    issues.push(issue("view-focus", `${views.length} views; the maximum is ${limits.views.max}.`));
  }
  views.forEach((view, index) => {
    const unknown = view.focus.filter((id) => !ids.has(id));
    if (unknown.length > 0) issues.push(issue("view-focus", `View ${index + 1} ("${view.label}") focuses ${unknown.map((id) => `"${id}"`).join(", ")}, which are not node ids.`));
    if (view.focus.length < limits.views.focus.min || view.focus.length > limits.views.focus.max) {
      issues.push(issue("view-focus", `View ${index + 1} ("${view.label}") focuses ${view.focus.length} node(s); it needs ${limits.views.focus.min}-${limits.views.focus.max}.`));
    }
  });

  return issues;
};

const outlineLabels = new Set(["incluye", "contiene", "trata", "trata de", "se compone de", "tiene", "abarca", "consta de", "incluye enfoque", "aborda"]);

/** Section titles joined by "incluye"/"contiene", with no definition, quantity or formula: the document's outline. */
const isOutlineLike = (input: CreateDiagramArtifactInput): boolean => {
  if (input.edges.length < 3) return false;
  const outline = input.edges.filter((edge) => outlineLabels.has((edge.label ?? "").trim().toLocaleLowerCase())).length;
  const knowledge = input.nodes.some((node) => node.kind === "definition" || node.kind === "quantity" || node.kind === "formula");
  return outline >= Math.ceil(input.edges.length * 0.6) && !knowledge;
};

const reachableFrom = (root: string, edges: CreateDiagramArtifactInput["edges"]): ReadonlySet<string> => {
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
    neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
  }
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of neighbours.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
};

/** Root with four or more leaves, one identical label on every edge, and no edge among the leaves. */
const isStarList = (root: string, input: CreateDiagramArtifactInput): boolean => {
  if (input.edges.length < 4) return false;
  const labels = new Set(input.edges.map((edge) => (edge.label ?? "").trim().toLocaleLowerCase()));
  const allFromRoot = input.edges.every((edge) => edge.from === root || edge.to === root);
  return allFromRoot && labels.size === 1;
};

/** Model-facing report: every issue numbered with its code and hint. */
export const renderDiagramIssues = (issues: readonly DiagramIssue[]): string => [
  `DIAGRAM_INVALID (${issues.length} problem${issues.length === 1 ? "" : "s"}). Fix all of them and call \`artifacts create\` again with the full JSON.`,
  ...issues.map((item, index) => `${index + 1}. [${item.code}] ${item.message}`)
].join("\n");
