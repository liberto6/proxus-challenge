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

export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 56;
const PADDING = 28;
const COLUMN_GAP = 64;
const ROW_GAP = 72;
const SIDE_GAP = 88;
const RING_MIN_RADIUS = 170;

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

export interface DiagramLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

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

  if (artifact.diagramType === "process") {
    const path = (artifact.mainPath ?? []).filter((id, index, all) => ids.has(id) && all.indexOf(id) === index);
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
    const distance = radius + NODE_HEIGHT + SIDE_GAP;
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

  return { nodes: frame.nodes, edges: layoutEdges, width: frame.width, height: frame.height };
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
  return { nodes: frame.nodes, edges: layoutEdges, width: frame.width, height: frame.height };
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

/** For each side concept, the step it connects to (first edge touching a step wins). */
const sideNodeTargets = (artifact: DiagramArtifact, path: readonly string[], edges: DiagramArtifact["edges"]): ReadonlyMap<string, string> => {
  const inPath = new Set(path);
  const targets = new Map<string, string>();
  for (const edge of edges) {
    if (!inPath.has(edge.from) && inPath.has(edge.to) && !targets.has(edge.from)) targets.set(edge.from, edge.to);
    if (!inPath.has(edge.to) && inPath.has(edge.from) && !targets.has(edge.to)) targets.set(edge.to, edge.from);
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

  // Order each row by the mean position of its neighbours in the row above.
  const position = new Map<string, number>();
  rows.forEach((row, rowIndex) => {
    const ordered = rowIndex === 0
      ? row
      : [...row].sort((a, b) => barycenter(a, neighbours, position, rowIndex, depth) - barycenter(b, neighbours, position, rowIndex, depth) || row.indexOf(a) - row.indexOf(b));
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
    // Same row or a skipped level: a curve bulging sideways so it does not cross the rows.
    const control = {
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

  return { nodes: frame.nodes, edges: layoutEdges, width: frame.width, height: frame.height };
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

// --- Shared geometry -----------------------------------------------------------------

/** Shifts centres so every box sits inside the frame with padding; returns boxes and the shift applied. */
const normalize = (placed: readonly Placed[]) => {
  const minX = Math.min(...placed.map((node) => node.cx - NODE_WIDTH / 2));
  const minY = Math.min(...placed.map((node) => node.cy - NODE_HEIGHT / 2));
  const maxX = Math.max(...placed.map((node) => node.cx + NODE_WIDTH / 2));
  const maxY = Math.max(...placed.map((node) => node.cy + NODE_HEIGHT / 2));
  const offsetX = PADDING - minX;
  const offsetY = PADDING - minY;
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
    height: round(maxY - minY + PADDING * 2)
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
