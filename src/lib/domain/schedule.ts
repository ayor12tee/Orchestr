/**
 * Conference execution engine: forecast dates and downstream impact (brief §6).
 *
 * The forecast is a forward pass over the dependency graph in calendar days
 * with inclusive dates (see dates.ts). It never edits stored dates; callers
 * persist forecasts as recalculable results and keep the baseline untouched.
 *
 * Where an input is missing, the node is reported as "unknown" with the exact
 * inputs needed, and that uncertainty flows to everything blocked behind it.
 */

import {
  addDays,
  diffDays,
  earliestStartAfter,
  finishFromStart,
  inclusiveDuration,
  maxDate,
  type IsoDate,
} from "./dates.ts";
import { topologicalOrder, type Dependency } from "./graph.ts";

export type TaskStatus = "not_started" | "in_progress" | "blocked" | "submitted_for_review" | "completed";

export interface ScheduleNode {
  id: string;
  title: string;
  kind: "task" | "milestone";
  status: TaskStatus;
  /** Current planned dates (the approved plan as revised). */
  plannedStart?: IsoDate | null;
  plannedFinish?: IsoDate | null;
  /** Original approved baseline. Never modified by the engine. */
  baselineFinish?: IsoDate | null;
  durationDays?: number | null;
  actualStart?: IsoDate | null;
  actualFinish?: IsoDate | null;
}

export type MissingInput =
  | { kind: "start_or_due_date"; taskId: string }
  | { kind: "duration"; taskId: string }
  | { kind: "actual_finish"; taskId: string }
  | { kind: "upstream_unknown"; taskId: string; upstreamTaskId: string };

export interface NodeForecast {
  id: string;
  state: "forecast" | "unknown";
  forecastStart: IsoDate | null;
  forecastFinish: IsoDate | null;
  /** Forecast finish minus planned finish. Positive = late. Null if not calculable. */
  varianceToPlanDays: number | null;
  /** Forecast finish minus baseline finish. Positive = late. Null if not calculable. */
  varianceToBaselineDays: number | null;
  /** The predecessor whose finish pushed this start out, if any. */
  drivenBy: string | null;
  /** All non-informational predecessors are complete or have an approved exception. */
  dependenciesSatisfied: boolean;
  /** Blocking predecessors that are not yet complete (exceptions excluded). */
  openBlockers: string[];
  missing: MissingInput[];
}

export interface ScheduleResult {
  today: IsoDate;
  nodes: Map<string, NodeForecast>;
}

function blockingPredecessors(id: string, deps: readonly Dependency[]): Dependency[] {
  return deps.filter((d) => d.successorId === id && d.type !== "informational");
}

export function computeSchedule(
  nodes: readonly ScheduleNode[],
  deps: readonly Dependency[],
  today: IsoDate,
): ScheduleResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const known = deps.filter((d) => byId.has(d.predecessorId) && byId.has(d.successorId));
  const order = topologicalOrder(
    nodes.map((n) => n.id),
    known,
  );
  const result = new Map<string, NodeForecast>();

  for (const id of order) {
    const node = byId.get(id)!;
    const preds = blockingPredecessors(id, known);
    const missing: MissingInput[] = [];

    const openBlockers = preds
      .filter((d) => byId.get(d.predecessorId)!.status !== "completed" && !d.exceptionApproved)
      .map((d) => d.predecessorId);

    // Earliest start allowed by blocking predecessors.
    let constraint: IsoDate | null = null;
    let drivenBy: string | null = null;
    let upstreamUnknown = false;
    for (const dep of preds) {
      const pred = result.get(dep.predecessorId)!;
      if (pred.forecastFinish === null) {
        upstreamUnknown = true;
        missing.push({ kind: "upstream_unknown", taskId: id, upstreamTaskId: dep.predecessorId });
        continue;
      }
      // A milestone is reached at the end of its predecessor's finish day,
      // a task can start the following day.
      const allowed =
        node.kind === "milestone"
          ? addDays(pred.forecastFinish, dep.lagDays)
          : earliestStartAfter(pred.forecastFinish, dep.lagDays);
      if (constraint === null || allowed > constraint) {
        constraint = allowed;
        drivenBy = dep.predecessorId;
      }
    }

    const forecast = forecastNode(node, constraint, upstreamUnknown, today, missing);
    // Only report a driver when it actually moved the date past the plan.
    const plannedAnchor = node.kind === "milestone" ? node.plannedFinish : node.plannedStart;
    if (forecast.start && drivenBy && plannedAnchor && forecast.start <= plannedAnchor) drivenBy = null;

    result.set(id, {
      id,
      state: forecast.finish === null ? "unknown" : "forecast",
      forecastStart: forecast.start,
      forecastFinish: forecast.finish,
      varianceToPlanDays:
        forecast.finish && node.plannedFinish ? diffDays(node.plannedFinish, forecast.finish) : null,
      varianceToBaselineDays:
        forecast.finish && node.baselineFinish ? diffDays(node.baselineFinish, forecast.finish) : null,
      drivenBy: forecast.finish ? drivenBy : null,
      dependenciesSatisfied: openBlockers.length === 0,
      openBlockers,
      missing,
    });
  }

  return { today, nodes: result };
}

function forecastNode(
  node: ScheduleNode,
  constraint: IsoDate | null,
  upstreamUnknown: boolean,
  today: IsoDate,
  missing: MissingInput[],
): { start: IsoDate | null; finish: IsoDate | null } {
  if (node.status === "completed") {
    if (!node.actualFinish) {
      missing.push({ kind: "actual_finish", taskId: node.id });
      return { start: node.actualStart ?? null, finish: null };
    }
    // Completed work is fact, not forecast. Upstream uncertainty is irrelevant.
    missing.length = 0;
    return { start: node.actualStart ?? node.plannedStart ?? null, finish: node.actualFinish };
  }

  if (node.kind === "milestone") {
    if (upstreamUnknown) return { start: null, finish: null };
    let date = constraint ?? node.plannedFinish ?? null;
    if (date === null) {
      missing.push({ kind: "start_or_due_date", taskId: node.id });
      return { start: null, finish: null };
    }
    // A milestone with no blocking inputs stays on its planned date. One with
    // inputs is reached when they are, never earlier than planned.
    if (node.plannedFinish) date = maxDate(date, node.plannedFinish);
    // An unachieved milestone cannot be reached in the past.
    date = maxDate(date, today);
    return { start: date, finish: date };
  }

  const duration =
    node.durationDays ??
    (node.plannedStart && node.plannedFinish ? inclusiveDuration(node.plannedStart, node.plannedFinish) : null);
  if (duration === null || duration < 1) missing.push({ kind: "duration", taskId: node.id });

  let start: IsoDate | null;
  if (node.actualStart) {
    // Work already began. Predecessor constraints no longer move the start.
    start = node.actualStart;
  } else {
    const ownStart =
      node.plannedStart ??
      (node.plannedFinish && duration && duration >= 1 ? addDays(node.plannedFinish, 1 - duration) : null);
    const candidates = [ownStart, constraint].filter((d): d is IsoDate => d !== null);
    if (candidates.length === 0 && !upstreamUnknown) {
      missing.push({ kind: "start_or_due_date", taskId: node.id });
    }
    // Unstarted work can't start in the past, and must wait for every blocker.
    start = upstreamUnknown || candidates.length === 0 ? null : [...candidates, today].reduce(maxDate);
  }

  if (start === null || duration === null || duration < 1) return { start, finish: null };
  // Unfinished work cannot finish before today.
  return { start, finish: maxDate(finishFromStart(start, duration), today) };
}

export interface ImpactEntry {
  id: string;
  title: string;
  kind: ScheduleNode["kind"];
  before: IsoDate | null;
  after: IsoDate | null;
  /** Days later (positive) or earlier (negative). Null if either side unknown. */
  shiftDays: number | null;
  becameUnknown: boolean;
  plannedFinish: IsoDate | null;
  /** True when the new forecast misses the current planned finish. */
  breachesPlan: boolean;
}

export interface ImpactReport {
  changedTaskId: string;
  affected: ImpactEntry[];
  /** Downstream nodes whose forecast didn't move because they had slack. */
  absorbed: string[];
  quantifiable: boolean;
  /** Inputs needed to quantify impacts reported as unknown. */
  missing: MissingInput[];
}

/**
 * Compares the schedule before and after a proposed change to one task and
 * reports only the downstream nodes whose forecast actually moves. Parallel
 * and independent work is untouched, and slack is absorbed rather than
 * shifting every successor by the same number of days.
 */
export function impactOfChange(
  nodes: readonly ScheduleNode[],
  deps: readonly Dependency[],
  today: IsoDate,
  changedTaskId: string,
  patch: Partial<Omit<ScheduleNode, "id" | "kind">>,
): ImpactReport {
  const before = computeSchedule(nodes, deps, today).nodes;
  const afterNodes = nodes.map((n) => (n.id === changedTaskId ? { ...n, ...patch } : n));
  const after = computeSchedule(afterNodes, deps, today).nodes;
  const byId = new Map(afterNodes.map((n) => [n.id, n]));

  const affected: ImpactEntry[] = [];
  const absorbed: string[] = [];
  const missing: MissingInput[] = [];

  for (const [id, a] of after) {
    if (id === changedTaskId) continue;
    const b = before.get(id)!;
    if (a.forecastFinish === b.forecastFinish && a.state === b.state) {
      if (isDownstream(id, changedTaskId, deps)) absorbed.push(id);
      continue;
    }
    const node = byId.get(id)!;
    const becameUnknown = a.state === "unknown" && b.state === "forecast";
    if (a.state === "unknown") missing.push(...a.missing);
    affected.push({
      id,
      title: node.title,
      kind: node.kind,
      before: b.forecastFinish,
      after: a.forecastFinish,
      shiftDays: a.forecastFinish && b.forecastFinish ? diffDays(b.forecastFinish, a.forecastFinish) : null,
      becameUnknown,
      plannedFinish: node.plannedFinish ?? null,
      breachesPlan: !!(a.forecastFinish && node.plannedFinish && a.forecastFinish > node.plannedFinish),
    });
  }

  affected.sort((x, y) => (y.shiftDays ?? Infinity) - (x.shiftDays ?? Infinity));
  return {
    changedTaskId,
    affected,
    absorbed,
    quantifiable: affected.every((e) => e.shiftDays !== null),
    missing: dedupeMissing(missing),
  };
}

function isDownstream(id: string, from: string, deps: readonly Dependency[]): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    for (const d of deps) {
      if (d.predecessorId !== cur || d.type === "informational" || seen.has(d.successorId)) continue;
      if (d.successorId === id) return true;
      seen.add(d.successorId);
      stack.push(d.successorId);
    }
  }
  return false;
}

function dedupeMissing(list: MissingInput[]): MissingInput[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    const key = JSON.stringify(m);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Human-readable explanation of what's needed before impact can be quantified. */
export function describeMissing(m: MissingInput, titleOf: (id: string) => string): string {
  switch (m.kind) {
    case "start_or_due_date":
      return `"${titleOf(m.taskId)}" needs a start date or a due date.`;
    case "duration":
      return `"${titleOf(m.taskId)}" needs an estimated duration (or both a start and a due date).`;
    case "actual_finish":
      return `"${titleOf(m.taskId)}" is marked completed but has no actual finish date.`;
    case "upstream_unknown":
      return `"${titleOf(m.taskId)}" waits on "${titleOf(m.upstreamTaskId)}", whose dates can't be forecast yet.`;
  }
}

/**
 * "What if this task finishes on `finish` instead?" Keeps the task's forecast
 * start and stretches or shrinks its duration to land on `finish`, so the
 * plan itself is untouched and only the knock-on effect is measured. A
 * milestone simply moves to the new date.
 */
export function impactOfFinishingOn(
  nodes: readonly ScheduleNode[],
  deps: readonly Dependency[],
  today: IsoDate,
  taskId: string,
  finish: IsoDate,
): ImpactReport {
  const node = nodes.find((n) => n.id === taskId);
  if (!node) throw new Error(`Unknown task ${taskId}`);
  if (node.kind === "milestone") return impactOfChange(nodes, deps, today, taskId, { plannedFinish: finish });
  const start = computeSchedule(nodes, deps, today).nodes.get(taskId)?.forecastStart ?? null;
  const patch: Partial<ScheduleNode> =
    start && start <= finish
      ? { durationDays: inclusiveDuration(start, finish) }
      : { plannedStart: finish, durationDays: 1, actualStart: null };
  return impactOfChange(nodes, deps, today, taskId, patch);
}
