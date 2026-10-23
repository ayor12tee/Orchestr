/**
 * Dependency graph helpers: validation, cycle prevention and traversal.
 *
 * Edges point from predecessor to successor ("A must finish before B").
 * Informational edges are part of the graph for display and impact listing,
 * but they never block a task and are skipped by the scheduler.
 */

export type DependencyType = "finish_to_start" | "informational";

export interface Dependency {
  id?: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  /** Calendar days after the predecessor's finish. 0 means "next day". */
  lagDays: number;
  /**
   * An authorised user recorded an approved exception letting the successor
   * proceed before this predecessor finishes (brief §6.2). The edge still
   * schedules, but it no longer stops the successor from being "ready".
   */
  exceptionApproved?: boolean;
}

export type DependencyValidationError =
  | { code: "self_dependency"; message: string }
  | { code: "unknown_task"; message: string; taskId: string }
  | { code: "duplicate"; message: string }
  | { code: "invalid_lag"; message: string }
  | { code: "cycle"; message: string; path: string[] };

export function buildAdjacency(deps: readonly Dependency[]): Map<string, Dependency[]> {
  const out = new Map<string, Dependency[]>();
  for (const dep of deps) {
    const list = out.get(dep.predecessorId);
    if (list) list.push(dep);
    else out.set(dep.predecessorId, [dep]);
  }
  return out;
}

/**
 * Returns the path from `from` to `to` following successor edges, or null if
 * `to` is unreachable. Iterative DFS, so deep chains can't overflow the stack.
 */
export function findPath(
  adjacency: Map<string, Dependency[]>,
  from: string,
  to: string,
): string[] | null {
  const parent = new Map<string, string | null>([[from, null]]);
  const stack = [from];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === to) {
      const path: string[] = [];
      for (let cur: string | null = node; cur !== null; cur = parent.get(cur) ?? null) path.push(cur);
      return path.reverse();
    }
    for (const edge of adjacency.get(node) ?? []) {
      if (!parent.has(edge.successorId)) {
        parent.set(edge.successorId, node);
        stack.push(edge.successorId);
      }
    }
  }
  return null;
}

/**
 * Validates a new or modified dependency against the existing graph.
 * `existing` should exclude the edge being modified when editing one.
 *
 * Informational edges are checked for cycles too: a loop of "relates to"
 * edges would make downstream-impact listings ambiguous.
 */
export function validateDependency(
  candidate: Dependency,
  existing: readonly Dependency[],
  knownTaskIds: ReadonlySet<string>,
): DependencyValidationError | null {
  const { predecessorId, successorId } = candidate;
  if (predecessorId === successorId) {
    return { code: "self_dependency", message: "A task cannot depend on itself." };
  }
  for (const id of [predecessorId, successorId]) {
    if (!knownTaskIds.has(id)) return { code: "unknown_task", message: `Task ${id} does not exist.`, taskId: id };
  }
  if (!Number.isInteger(candidate.lagDays) || candidate.lagDays < 0) {
    return { code: "invalid_lag", message: "Lag must be a whole number of days, zero or more." };
  }
  if (candidate.type === "informational" && candidate.lagDays !== 0) {
    return { code: "invalid_lag", message: "Informational dependencies cannot have a lag." };
  }
  if (existing.some((d) => d.predecessorId === predecessorId && d.successorId === successorId)) {
    return { code: "duplicate", message: "This dependency already exists." };
  }
  // Adding pred -> succ creates a cycle iff pred is already reachable from succ.
  const back = findPath(buildAdjacency(existing), successorId, predecessorId);
  if (back) {
    return {
      code: "cycle",
      message: "This dependency would create a circular chain of tasks.",
      path: [predecessorId, ...back],
    };
  }
  return null;
}

/**
 * Topological order (Kahn's algorithm). Throws if the graph has a cycle,
 * which validation should already have prevented.
 */
export function topologicalOrder(taskIds: readonly string[], deps: readonly Dependency[]): string[] {
  const inDegree = new Map(taskIds.map((id) => [id, 0]));
  const adjacency = buildAdjacency(deps);
  for (const dep of deps) {
    if (inDegree.has(dep.successorId) && inDegree.has(dep.predecessorId)) {
      inDegree.set(dep.successorId, inDegree.get(dep.successorId)! + 1);
    }
  }
  const queue = taskIds.filter((id) => inDegree.get(id) === 0).sort();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of adjacency.get(id) ?? []) {
      if (!inDegree.has(edge.successorId)) continue;
      const remaining = inDegree.get(edge.successorId)! - 1;
      inDegree.set(edge.successorId, remaining);
      if (remaining === 0) queue.push(edge.successorId);
    }
  }
  if (order.length !== taskIds.length) throw new Error("Dependency graph contains a cycle.");
  return order;
}

/** Every task reachable downstream of `taskId`, optionally only via blocking edges. */
export function downstreamOf(
  taskId: string,
  deps: readonly Dependency[],
  options: { blockingOnly?: boolean } = {},
): Set<string> {
  const edges = options.blockingOnly ? deps.filter((d) => d.type !== "informational") : deps;
  const adjacency = buildAdjacency(edges);
  const seen = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    for (const edge of adjacency.get(stack.pop()!) ?? []) {
      if (!seen.has(edge.successorId)) {
        seen.add(edge.successorId);
        stack.push(edge.successorId);
      }
    }
  }
  return seen;
}

/**
 * Column layout for drawing the graph left to right: each task sits one
 * column after its furthest predecessor (longest-path depth). Within a
 * column, a few barycentre sweeps order tasks near the tasks they connect
 * to, which keeps edge crossings down without a layout library.
 */
export function layeredLayout(
  taskIds: readonly string[],
  deps: readonly Dependency[],
  tieBreak: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): string[][] {
  const ids = new Set(taskIds);
  const edges = deps.filter((d) => ids.has(d.predecessorId) && ids.has(d.successorId));
  const depth = new Map<string, number>();
  for (const id of topologicalOrder(taskIds, edges)) {
    const preds = edges.filter((d) => d.successorId === id).map((d) => depth.get(d.predecessorId)! + 1);
    depth.set(id, Math.max(0, ...preds));
  }
  const columns: string[][] = [];
  for (const id of [...taskIds].sort(tieBreak)) (columns[depth.get(id)!] ??= []).push(id);

  const position = () => new Map(columns.flatMap((col) => col.map((id, i) => [id, i] as const)));
  const barycentre = (id: string, neighbours: string[], pos: Map<string, number>) =>
    neighbours.length ? neighbours.reduce((s, n) => s + pos.get(n)!, 0) / neighbours.length : pos.get(id)!;
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const pos = position();
    const order = forward ? columns.slice(1) : columns.slice(0, -1).reverse();
    for (const col of order) {
      const key = new Map(col.map((id) => {
        const neighbours = edges
          .filter((d) => (forward ? d.successorId === id : d.predecessorId === id))
          .map((d) => (forward ? d.predecessorId : d.successorId));
        return [id, barycentre(id, neighbours, pos)] as const;
      }));
      col.sort((a, b) => key.get(a)! - key.get(b)! || tieBreak(a, b));
      col.forEach((id, i) => pos.set(id, i));
    }
  }
  return columns;
}
