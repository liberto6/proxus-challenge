import type { DiagramArtifact } from "@proxus/shared";

/**
 * Geometry of a diagram, computed from its graph. The model never sends
 * positions: the same artifact always produces the same drawing.
 *
 * Three shapes, one output:
 * - a cyclic process is a ring of steps, with side concepts outside the ring
 *   next to the step they feed;
 * - a linear process is a column of steps, side concepts to the right;
 * - a concept map is layered by distance from the root (breadth-first,
 *   ignoring edge direction), children under their parents.
 */

// Two zones per box: the label and a one-line sublabel.
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 72;
const PADDING = 32;
const COLUMN_GAP = 72;
const ROW_GAP = 84;
const SIDE_GAP = 96;
const RING_MIN_RADIUS = 210;

export type NodeRole = "step" | "side" | "root" | "concept";
export type EdgeKind = "main" | "side" | "relation";

export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly role: NodeRole;
  /** 1-based position in the main path, for the step badge. */
  readonly step?: number;
}

export interface LayoutEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /** SVG path data, from the boundary of `from` to the boundary of `to`. */
  readonly path: string;
  readonly label?: string;
  readonly labelX: number;
  readonly labelY: number;
}

/** Outlined box around the members of a group, drawn behind the nodes. */
export interface LayoutGroup {
  readonly id: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Background band of a timeline phase, spanning its steps from top to bottom. */
export interface LayoutBand {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DiagramLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly groups: readonly LayoutGroup[];
  readonly bands: readonly LayoutBand[];
  readonly width: number;
  readonly height: number;
}

const BAND_TITLE = 30;
/** Room between two steps of a timeline for the cause written over the arrow. */
const TIMELINE_GAP = 170;

const GROUP_PADDING = 18;
const GROUP_TITLE = 22;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Rect extends Point {
  readonly width: number;
  readonly height: number;
}

interface Placed {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly role: NodeRole;
  readonly step?: number;
}

export const layoutDiagram = (artifact: DiagramArtifact): DiagramLayout => {
  const ids = new Set(artifact.nodes.map((node) => node.id));
  const edges = artifact.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);

  if (artifact.diagramType === "process" || artifact.diagramType === "timeline") {
    const path = (artifact.mainPath ?? []).filter((id, index, all) => ids.has(id) && all.indexOf(id) === index);
    if (artifact.diagramType === "timeline") return timeline(artifact, path, edges);
    return artifact.cyclic === true && path.length >= 3
      ? ring(artifact, path, edges)
      : column(artifact, path, edges);
  }
  return layered(artifact, edges);
};

// --- Process: ring ---------------------------------------------------------------

const ring = (artifact: DiagramArtifact, path: readonly string[], allEdges: DiagramArtifact["edges"]): DiagramLayout => {
  const { transitions, edges } = splitTransitions(path, artifact.cyclic === true, allEdges);
  const count = path.length;
  const radius = Math.max(RING_MIN_RADIUS, (NODE_WIDTH + 40) / (2 * Math.sin(Math.PI / count)));
  const angleOf = (index: number) => -Math.PI / 2 + (index / count) * 2 * Math.PI;
  const placed: Placed[] = path.map((id, index) => ({
    id,
    cx: radius * Math.cos(angleOf(index)),
    cy: radius * Math.sin(angleOf(index)),
    role: "step",
    step: index + 1
  }));

  // Side concepts sit outside the ring, in the direction of the step they feed.
  const inPath = new Set(path);
  const sideTargets = sideNodeTargets(artifact, path, edges);
  const perStep = new Map<string, string[]>();
  for (const node of artifact.nodes) {
    if (inPath.has(node.id)) continue;
    const target = sideTargets.get(node.id) ?? path[0]!;
    perStep.set(target, [...(perStep.get(target) ?? []), node.id]);
  }
  for (const [target, sides] of perStep) {
    const angle = angleOf(path.indexOf(target));
    const outward = { x: Math.cos(angle), y: Math.sin(angle) };
    const tangent = { x: -Math.sin(angle), y: Math.cos(angle) };
    // Far enough that the boxes do not touch whatever the direction: a box beside a
    // step needs a full width of clearance, one above it only a height.
    const clearance = Math.abs(outward.x) * NODE_WIDTH + Math.abs(outward.y) * NODE_HEIGHT;
    const distance = radius + clearance + SIDE_GAP / 2;
    sides.forEach((id, index) => {
      const offset = (index - (sides.length - 1) / 2) * (NODE_WIDTH + 24);
      placed.push({
        id,
        cx: outward.x * distance + tangent.x * offset,
        cy: outward.y * distance + tangent.y * offset,
        role: "side"
      });
    });
  }

  const frame = normalize(placed);
  const rects = new Map(frame.nodes.map((node) => [node.id, node]));
  const center = { x: frame.offsetX, y: frame.offsetY };
  const layoutEdges: LayoutEdge[] = [];

  // Main path as arcs along the ring, clipped to the node boxes.
  for (let index = 0; index < count; index++) {
    const fromId = path[index]!;
    const toId = path[(index + 1) % count]!;
    const fromAngle = angleOf(index);
    const toAngle = angleOf(index + 1);
    const start = circleExit(center, radius, fromAngle, rects.get(fromId)!, +1);
    const end = circleExit(center, radius, toAngle, rects.get(toId)!, -1);
    // The label sits just outside the ring, at the middle of the arc.
    const mid = pointOnCircle(center, radius + 14, (fromAngle + toAngle) / 2);
    const label = transitions.get(`${fromId}->${toId}`);
    layoutEdges.push({
      id: `main-${index}`,
      from: fromId,
      to: toId,
      kind: "main",
      path: `M ${round(start.x)} ${round(start.y)} A ${round(radius)} ${round(radius)} 0 0 1 ${round(end.x)} ${round(end.y)}`,
      ...(label === undefined ? {} : { label }),
      labelX: round(mid.x),
      labelY: round(mid.y)
    });
  }
  layoutEdges.push(...straightEdges(edges, rects, "side"));

  return finish(artifact, frame, layoutEdges);
};

// --- Process: column -------------------------------------------------------------

const column = (artifact: DiagramArtifact, path: readonly string[], allEdges: DiagramArtifact["edges"]): DiagramLayout => {
  const { transitions, edges } = splitTransitions(path, false, allEdges);
  const placed: Placed[] = path.map((id, index) => ({
    id,
    cx: 0,
    cy: index * (NODE_HEIGHT + ROW_GAP),
    role: "step",
    step: index + 1
  }));
  const inPath = new Set(path);
  const sideTargets = sideNodeTargets(artifact, path, edges);
  const perStep = new Map<string, string[]>();
  const loose: string[] = [];
  for (const node of artifact.nodes) {
    if (inPath.has(node.id)) continue;
    const target = sideTargets.get(node.id);
    if (target === undefined) loose.push(node.id);
    else perStep.set(target, [...(perStep.get(target) ?? []), node.id]);
  }
  for (const [target, sides] of perStep) {
    const stepY = placed.find((node) => node.id === target)?.cy ?? 0;
    sides.forEach((id, index) => {
      placed.push({ id, cx: NODE_WIDTH + SIDE_GAP + index * (NODE_WIDTH + 24), cy: stepY, role: "side" });
    });
  }
  // Nodes without a step to attach to: a row under the column.
  const bottom = path.length * (NODE_HEIGHT + ROW_GAP);
  loose.forEach((id, index) => {
    placed.push({ id, cx: index * (NODE_WIDTH + COLUMN_GAP), cy: bottom, role: "side" });
  });

  const frame = normalize(placed);
  const rects = new Map(frame.nodes.map((node) => [node.id, node]));
  const layoutEdges: LayoutEdge[] = [];
  for (let index = 0; index < path.length - 1; index++) {
    const from = rects.get(path[index]!)!;
    const to = rects.get(path[index + 1]!)!;
    const start = { x: from.x + from.width / 2, y: from.y + from.height };
    const end = { x: to.x + to.width / 2, y: to.y };
    const label = transitions.get(`${from.id}->${to.id}`);
    layoutEdges.push({
      id: `main-${index}`,
      from: from.id,
      to: to.id,
      kind: "main",
      path: line(start, end),
      ...(label === undefined ? {} : { label }),
      // Beside the vertical segment, to the left of the column.
      labelX: round((start.x + end.x) / 2 - 12),
      labelY: round((start.y + end.y) / 2)
    });
  }
  layoutEdges.push(...straightEdges(edges, rects, "side"));
  return finish(artifact, frame, layoutEdges);
};

/**
 * Edges between consecutive steps are the labelled transitions of the main
 * path: they are drawn on the main edge, not as a second arrow.
 */
export const splitTransitions = (
  path: readonly string[],
  cyclic: boolean,
  edges: DiagramArtifact["edges"]
): { readonly transitions: ReadonlyMap<string, string>; readonly edges: DiagramArtifact["edges"] } => {
  const stretches = new Set<string>();
  for (let index = 0; index < path.length; index++) {
    const next = index < path.length - 1 ? path[index + 1] : cyclic ? path[0] : undefined;
    if (next !== undefined && next !== path[index]) stretches.add(`${path[index]}->${next}`);
  }
  const transitions = new Map<string, string>();
  const rest: DiagramArtifact["edges"][number][] = [];
  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    if (stretches.has(key)) {
      if (edge.label !== undefined && !transitions.has(key)) transitions.set(key, edge.label);
    } else {
      rest.push(edge);
    }
  }
  return { transitions, edges: rest };
};

// --- Timeline ------------------------------------------------------------------------

/**
 * Steps left to right on one axis; each phase is a band behind its steps;
 * side concepts alternate above and below the step they feed.
 */
const timeline = (artifact: DiagramArtifact, path: readonly string[], allEdges: DiagramArtifact["edges"]): DiagramLayout => {
  const { transitions, edges } = splitTransitions(path, false, allEdges);
  const placed: Placed[] = path.map((id, index) => ({
    id,
    cx: index * (NODE_WIDTH + TIMELINE_GAP),
    cy: 0,
    role: "step",
    step: index + 1
  }));
  const inPath = new Set(path);
  const sideTargets = sideNodeTargets(artifact, path, edges);
  const perStep = new Map<string, string[]>();
  const loose: string[] = [];
  for (const node of artifact.nodes) {
    if (inPath.has(node.id)) continue;
    const target = sideTargets.get(node.id);
    if (target === undefined) loose.push(node.id);
    else perStep.set(target, [...(perStep.get(target) ?? []), node.id]);
  }
  for (const [target, sides] of perStep) {
    const stepX = placed.find((node) => node.id === target)?.cx ?? 0;
    sides.forEach((id, index) => {
      // First above, then below, then further above, and so on.
      const level = Math.floor(index / 2) + 1;
      const sign = index % 2 === 0 ? -1 : 1;
      placed.push({ id, cx: stepX, cy: sign * level * (NODE_HEIGHT + ROW_GAP), role: "side" });
    });
  }
  const below = Math.max(1, ...[...perStep.values()].map((sides) => Math.floor((sides.length - 1) / 2) + 1)) + 1;
  loose.forEach((id, index) => {
    placed.push({ id, cx: index * (NODE_WIDTH + TIMELINE_GAP), cy: below * (NODE_HEIGHT + ROW_GAP), role: "side" });
  });

  const frame = normalize(placed, BAND_TITLE);
  const rects = new Map(frame.nodes.map((node) => [node.id, node]));
  const layoutEdges: LayoutEdge[] = [];
  for (let index = 0; index < path.length - 1; index++) {
    const from = rects.get(path[index]!)!;
    const to = rects.get(path[index + 1]!)!;
    const start = { x: from.x + from.width, y: from.y + from.height / 2 };
    const end = { x: to.x, y: to.y + to.height / 2 };
    const label = transitions.get(`${from.id}->${to.id}`);
    layoutEdges.push({
      id: `main-${index}`,
      from: from.id,
      to: to.id,
      kind: "main",
      path: line(start, end),
      ...(label === undefined ? {} : { label }),
      labelX: round((start.x + end.x) / 2),
      labelY: round(start.y - 14)
    });
  }
  layoutEdges.push(...straightEdges(edges, rects, "side"));

  // Phase bands: from the first step of the phase to the last, full height.
  const phaseOf = new Map(artifact.nodes.map((node) => [node.id, node.phase]));
  const bands: LayoutBand[] = (artifact.phases ?? []).flatMap((phase) => {
    const steps = path.map((id) => rects.get(id)!).filter((box) => phaseOf.get(box.id) === phase);
    if (steps.length === 0) return [];
    const x = Math.min(...steps.map((box) => box.x)) - TIMELINE_GAP / 2 + 6;
    const right = Math.max(...steps.map((box) => box.x + box.width)) + TIMELINE_GAP / 2 - 6;
    return [{ label: phase, x: round(x), y: 8, width: round(right - x), height: round(frame.height - 16) }];
  });

  return finish(artifact, frame, layoutEdges, bands);
};

/** For each side concept, the step it connects to (first edge touching a step wins). */
const sideNodeTargets = (artifact: DiagramArtifact, path: readonly string[], edges: DiagramArtifact["edges"]): ReadonlyMap<string, string> => {
  const inPath = new Set(path);
  const targets = new Map<string, string>();
  for (const edge of edges) {
    if (!inPath.has(edge.from) && inPath.has(edge.to) && !targets.has(edge.from)) targets.set(edge.from, edge.to);
    if (!inPath.has(edge.to) && inPath.has(edge.from) && !targets.has(edge.to)) targets.set(edge.to, edge.from);
  }
  // Members of a group that contains a step hang from that step.
  for (const group of artifact.groups ?? []) {
    const step = group.nodeIds.find((id) => inPath.has(id));
    if (step === undefined) continue;
    for (const member of group.nodeIds) {
      if (!inPath.has(member) && !targets.has(member)) targets.set(member, step);
    }
  }
  // Side concepts linked only to other side concepts follow their neighbour's step.
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
        if (!inPath.has(a) && !targets.has(a) && targets.has(b)) {
          targets.set(a, targets.get(b)!);
          changed = true;
        }
      }
    }
  }
  return targets;
};

// --- Concept map: layered ----------------------------------------------------------

const layered = (artifact: DiagramArtifact, edges: DiagramArtifact["edges"]): DiagramLayout => {
  const ids = artifact.nodes.map((node) => node.id);
  const root = artifact.rootId !== undefined && ids.includes(artifact.rootId) ? artifact.rootId : ids[0];
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    neighbours.get(edge.from)!.push(edge.to);
    neighbours.get(edge.to)!.push(edge.from);
  }

  const depth = new Map<string, number>();
  const rows: string[][] = [];
  if (root !== undefined) {
    depth.set(root, 0);
    rows.push([root]);
    while (true) {
      const last = rows[rows.length - 1]!;
      const next: string[] = [];
      for (const id of last) {
        for (const other of neighbours.get(id) ?? []) {
          if (!depth.has(other)) {
            depth.set(other, rows.length);
            next.push(other);
          }
        }
      }
      if (next.length === 0) break;
      rows.push(next);
    }
  }
  const unreachable = ids.filter((id) => !depth.has(id));
  if (unreachable.length > 0) {
    unreachable.forEach((id) => depth.set(id, rows.length));
    rows.push(unreachable);
  }

  // Order each row by the mean position of its neighbours in the row above;
  // members of a group stay adjacent (ordered by the group's own barycentre).
  const groupOf = new Map<string, number>();
  (artifact.groups ?? []).forEach((group, index) => group.nodeIds.forEach((id) => groupOf.set(id, index)));
  const position = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    const own = new Map(row.map((id) => [id, barycenter(id, neighbours, position, rowIndex, depth)]));
    const groupCenter = (id: string): number => {
      const group = groupOf.get(id);
      if (group === undefined) return own.get(id) ?? 0;
      const members = row.filter((other) => groupOf.get(other) === group);
      return members.reduce((sum, other) => sum + (own.get(other) ?? 0), 0) / members.length;
    };
    const ordered = rowIndex === 0
      ? row
      : [...row].sort((a, b) =>
          groupCenter(a) - groupCenter(b)
          || (groupOf.get(a) ?? -1) - (groupOf.get(b) ?? -1)
          || (own.get(a) ?? 0) - (own.get(b) ?? 0)
          || row.indexOf(a) - row.indexOf(b));
    ordered.forEach((id, index) => position.set(id, index - (ordered.length - 1) / 2));
    rows[rowIndex] = ordered;
  });

  const placed: Placed[] = ids.map((id) => ({
    id,
    cx: (position.get(id) ?? 0) * (NODE_WIDTH + COLUMN_GAP),
    cy: (depth.get(id) ?? 0) * (NODE_HEIGHT + ROW_GAP),
    role: id === root ? "root" : "concept"
  }));

  const frame = normalize(placed);
  const rects = new Map(frame.nodes.map((node) => [node.id, node]));
  const layoutEdges = edges.map((edge, index): LayoutEdge => {
    const from = rects.get(edge.from)!;
    const to = rects.get(edge.to)!;
    const adjacent = Math.abs((depth.get(edge.from) ?? 0) - (depth.get(edge.to) ?? 0)) === 1;
    const fromCenter = centerOf(from);
    const toCenter = centerOf(to);
    if (adjacent) {
      const start = clipToRect(fromCenter, toCenter, from);
      const end = clipToRect(toCenter, fromCenter, to);
      const label = labelBeside(start, end);
      return {
        id: `edge-${index}`,
        from: edge.from,
        to: edge.to,
        kind: "relation",
        path: line(start, end),
        ...(edge.label === undefined ? {} : { label: edge.label }),
        labelX: label.x,
        labelY: label.y
      };
    }
    // Same row: a curve dipping below the row. A skipped level: a curve bulging
    // sideways so it does not run through the rows in between.
    const sameRow = (depth.get(edge.from) ?? 0) === (depth.get(edge.to) ?? 0);
    const control = sameRow
      ? { x: (fromCenter.x + toCenter.x) / 2, y: fromCenter.y + NODE_HEIGHT + 36 }
      : {
          x: (fromCenter.x + toCenter.x) / 2 + (fromCenter.x <= toCenter.x ? 1 : -1) * (NODE_WIDTH / 2 + COLUMN_GAP),
          y: (fromCenter.y + toCenter.y) / 2
        };
    const start = clipToRect(fromCenter, control, from);
    const end = clipToRect(toCenter, control, to);
    const mid = quadraticPoint(start, control, end, 0.5);
    return {
      id: `edge-${index}`,
      from: edge.from,
      to: edge.to,
      kind: "relation",
      path: `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      labelX: round(mid.x),
      labelY: round(mid.y)
    };
  });

  return finish(artifact, frame, layoutEdges);
};

const barycenter = (
  id: string,
  neighbours: ReadonlyMap<string, readonly string[]>,
  position: ReadonlyMap<string, number>,
  rowIndex: number,
  depth: ReadonlyMap<string, number>
): number => {
  const above = (neighbours.get(id) ?? []).filter((other) => depth.get(other) === rowIndex - 1);
  if (above.length === 0) return 0;
  return above.reduce((sum, other) => sum + (position.get(other) ?? 0), 0) / above.length;
};

// --- Groups ------------------------------------------------------------------------------

/**
 * Envelopes around the members of each group: the bounding box of the member
 * boxes plus padding and room for the title. Computed after placement, so a
 * group's look depends on its members staying together (side concepts of a
 * group hang from the same step; concept-map rows keep members adjacent).
 */
const groupEnvelopes = (artifact: DiagramArtifact, nodes: readonly LayoutNode[]): LayoutGroup[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (artifact.groups ?? []).flatMap((group) => {
    const members = group.nodeIds.flatMap((id) => {
      const box = byId.get(id);
      return box === undefined ? [] : [box];
    });
    if (members.length === 0) return [];
    const x = Math.min(...members.map((box) => box.x)) - GROUP_PADDING;
    const y = Math.min(...members.map((box) => box.y)) - GROUP_PADDING - GROUP_TITLE;
    const right = Math.max(...members.map((box) => box.x + box.width)) + GROUP_PADDING;
    const bottom = Math.max(...members.map((box) => box.y + box.height)) + GROUP_PADDING;
    return [{ id: group.id, label: group.label, nodeIds: members.map((box) => box.id), x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) }];
  });
};

/** Assembles the layout and grows the frame so group envelopes stay inside it. */
const finish = (artifact: DiagramArtifact, frame: ReturnType<typeof normalize>, edges: readonly LayoutEdge[], bands: readonly LayoutBand[] = []): DiagramLayout => {
  const groups = groupEnvelopes(artifact, frame.nodes);
  const shiftX = Math.max(0, ...groups.map((group) => PADDING - group.x));
  const shiftY = Math.max(0, ...groups.map((group) => PADDING - group.y));
  const nodes = shiftX === 0 && shiftY === 0 ? frame.nodes : frame.nodes.map((node) => ({ ...node, x: round(node.x + shiftX), y: round(node.y + shiftY) }));
  const shifted = shiftX === 0 && shiftY === 0 ? groups : groups.map((group) => ({ ...group, x: round(group.x + shiftX), y: round(group.y + shiftY) }));
  const movedEdges = shiftX === 0 && shiftY === 0 ? edges : edges.map((edge) => ({ ...edge, path: shiftPath(edge.path, shiftX, shiftY), labelX: round(edge.labelX + shiftX), labelY: round(edge.labelY + shiftY) }));
  const width = Math.max(frame.width + shiftX, ...shifted.map((group) => group.x + group.width + PADDING));
  const height = Math.max(frame.height + shiftY, ...shifted.map((group) => group.y + group.height + PADDING));
  const movedBands = bands.map((band) => ({ ...band, x: round(band.x + shiftX), height: round(Math.max(band.height, height - 16)) }));
  return { nodes, edges: movedEdges, groups: shifted, bands: movedBands, width: round(width), height: round(height) };
};

/** Moves every absolute coordinate pair of a path (M, L, Q control/end points, A end point). Arc radii are untouched. */
const shiftPath = (path: string, dx: number, dy: number): string =>
  path.replace(/([MLQ]|A [\d.]+ [\d.]+ \d \d \d)((?:\s+-?[\d.]+\s+-?[\d.]+)+)/g, (_, command: string, coords: string) => {
    const numbers = coords.trim().split(/\s+/).map(Number);
    const moved: string[] = [];
    for (let index = 0; index < numbers.length; index += 2) {
      moved.push(`${round(numbers[index]! + dx)} ${round(numbers[index + 1]! + dy)}`);
    }
    return `${command} ${moved.join(" ")}`;
  });

// --- Shared geometry -----------------------------------------------------------------

/** Shifts centres so every box sits inside the frame with padding; returns boxes and the shift applied. */
const normalize = (placed: readonly Placed[], topInset = 0) => {
  const minX = Math.min(...placed.map((node) => node.cx - NODE_WIDTH / 2));
  const minY = Math.min(...placed.map((node) => node.cy - NODE_HEIGHT / 2));
  const maxX = Math.max(...placed.map((node) => node.cx + NODE_WIDTH / 2));
  const maxY = Math.max(...placed.map((node) => node.cy + NODE_HEIGHT / 2));
  const offsetX = PADDING - minX;
  const offsetY = PADDING + topInset - minY;
  const nodes: LayoutNode[] = placed.map((node) => ({
    id: node.id,
    x: round(node.cx - NODE_WIDTH / 2 + offsetX),
    y: round(node.cy - NODE_HEIGHT / 2 + offsetY),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    role: node.role,
    ...(node.step === undefined ? {} : { step: node.step })
  }));
  return {
    nodes,
    offsetX,
    offsetY,
    width: round(maxX - minX + PADDING * 2),
    height: round(maxY - minY + PADDING * 2 + topInset)
  };
};

const straightEdges = (edges: DiagramArtifact["edges"], rects: ReadonlyMap<string, Rect & { id: string }>, kind: EdgeKind): LayoutEdge[] =>
  edges.map((edge, index) => {
    const from = rects.get(edge.from)!;
    const to = rects.get(edge.to)!;
    const start = clipToRect(centerOf(from), centerOf(to), from);
    const end = clipToRect(centerOf(to), centerOf(from), to);
    const label = labelBeside(start, end);
    return {
      id: `edge-${index}`,
      from: edge.from,
      to: edge.to,
      kind,
      path: line(start, end),
      ...(edge.label === undefined ? {} : { label: edge.label }),
      labelX: label.x,
      labelY: label.y
    };
  });

const centerOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** Midpoint of a segment pushed 12 px to its side (the upper side when horizontal), so a label does not sit on the line. */
const labelBeside = (start: Point, end: Point): Point => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const sign = normal.y <= 0 ? 1 : -1;
  return {
    x: round((start.x + end.x) / 2 + normal.x * 12 * sign),
    y: round((start.y + end.y) / 2 + normal.y * 12 * sign)
  };
};

/** Where the segment from the centre of `rect` towards `target` leaves the box (with a small margin). */
const clipToRect = (from: Point, target: Point, rect: Rect): Point => {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return from;
  const margin = 4;
  const halfW = rect.width / 2 + margin;
  const halfH = rect.height / 2 + margin;
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy)
  );
  return { x: from.x + dx * scale, y: from.y + dy * scale };
};

const pointOnCircle = (center: Point, radius: number, angle: number): Point => ({
  x: center.x + radius * Math.cos(angle),
  y: center.y + radius * Math.sin(angle)
});

/** First point of the ring, walking from a node's angle in `direction`, that is outside the node box. */
const circleExit = (center: Point, radius: number, angle: number, rect: Rect, direction: 1 | -1): Point => {
  const margin = 6;
  const inside = (point: Point) =>
    point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin &&
    point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin;
  let step = 0;
  let point = pointOnCircle(center, radius, angle);
  while (inside(point) && step < 400) {
    step += 1;
    point = pointOnCircle(center, radius, angle + direction * step * 0.005);
  }
  return point;
};

const quadraticPoint = (start: Point, control: Point, end: Point, t: number): Point => ({
  x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x,
  y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y
});

const line = (start: Point, end: Point): string => `M ${round(start.x)} ${round(start.y)} L ${round(end.x)} ${round(end.y)}`;

const round = (value: number): number => Math.round(value * 10) / 10;
