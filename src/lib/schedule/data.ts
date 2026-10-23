import { cache } from "react";
import { getAccess } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import type { Dependency } from "@/lib/domain/graph";
import { computeSchedule, type NodeForecast, type ScheduleNode } from "@/lib/domain/schedule";
import { TASK_LIST_SELECT, type DependencyRow, type TaskListRow, type TaskRow } from "@/lib/tasks/types";

export const HIDDEN_TASK_TITLE = "a task outside your view";

export function toScheduleNode(t: TaskRow): ScheduleNode {
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    status: t.status,
    plannedStart: t.start_date,
    plannedFinish: t.due_date,
    baselineFinish: t.baseline_finish,
    durationDays: t.kind === "milestone" ? null : t.duration_days,
    actualStart: t.actual_start,
    actualFinish: t.actual_finish,
  };
}

export function toDependency(d: DependencyRow): Dependency {
  return {
    id: d.id,
    predecessorId: d.predecessor_id,
    successorId: d.successor_id,
    type: d.type,
    lagDays: d.lag_days,
    exceptionApproved: d.exception_approved,
  };
}

export interface ScheduleData {
  today: string;
  tasks: TaskListRow[];
  taskById: Map<string, TaskListRow>;
  dependencyRows: DependencyRow[];
  deps: Dependency[];
  /** Nodes for the scheduler, including placeholders for tasks the user can't see. */
  nodes: ScheduleNode[];
  hiddenIds: Set<string>;
  forecast: Map<string, NodeForecast>;
  titleOf: (id: string) => string;
}

/**
 * Loads every task and dependency the user can see and forecasts them.
 * Forecasts are recalculated on each request from stored facts, never saved.
 *
 * A dependency can point at a task the user isn't allowed to see. That task
 * becomes a dateless placeholder, so anything waiting on it is reported as
 * "unknown" instead of being forecast as if the hidden work were on time.
 */
export const loadSchedule = cache(async (): Promise<ScheduleData> => {
  const access = await getAccess();
  const settings = await getSettings();
  const supabase = await createClient();
  const [{ data: taskData }, { data: depData }] = await Promise.all([
    supabase.from("tasks").select(TASK_LIST_SELECT).eq("conference_id", access.conference.id).returns<TaskListRow[]>(),
    supabase.from("task_dependencies").select("*").eq("conference_id", access.conference.id).returns<DependencyRow[]>(),
  ]);
  const tasks = taskData ?? [];
  const dependencyRows = depData ?? [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const hiddenIds = new Set<string>();
  for (const d of dependencyRows) {
    for (const id of [d.predecessor_id, d.successor_id]) if (!taskById.has(id)) hiddenIds.add(id);
  }
  const nodes: ScheduleNode[] = [
    ...tasks.map(toScheduleNode),
    ...[...hiddenIds].map((id): ScheduleNode => ({ id, title: HIDDEN_TASK_TITLE, kind: "task", status: "not_started" })),
  ];
  const deps = dependencyRows.map(toDependency);

  return {
    today: settings.today,
    tasks,
    taskById,
    dependencyRows,
    deps,
    nodes,
    hiddenIds,
    forecast: computeSchedule(nodes, deps, settings.today).nodes,
    titleOf: (id) => taskById.get(id)?.title ?? HIDDEN_TASK_TITLE,
  };
});

/** Tasks forecast to finish after their due date (not completed). */
export function forecastLate(data: ScheduleData): { task: TaskListRow; days: number; drivenBy: string | null }[] {
  return data.tasks
    .filter((t) => t.status !== "completed")
    .map((t) => ({ t, f: data.forecast.get(t.id) }))
    .filter(({ f }) => f && f.varianceToPlanDays !== null && f.varianceToPlanDays > 0)
    .map(({ t, f }) => ({ task: t, days: f!.varianceToPlanDays!, drivenBy: f!.drivenBy }))
    .sort((a, b) => b.days - a.days);
}
