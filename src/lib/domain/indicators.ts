/**
 * Computed task indicators (brief §5 C, §6.5). These are derived, never
 * stored as statuses, so a task can be Blocked and Overdue at once.
 */
import { diffDays, type IsoDate } from "./dates.ts";
import type { TaskStatus } from "./schedule.ts";

export interface IndicatorInput {
  status: TaskStatus;
  due_date: IsoDate | null;
  accountable_owner_id: string | null;
  acceptance_criteria: string | null;
  planning_state: "suggested" | "approved";
  is_critical: boolean;
}

export type Indicator =
  | { kind: "overdue"; days: number }
  | { kind: "due_soon"; days: number }
  | { kind: "blocked" }
  | { kind: "awaiting_review" }
  | { kind: "planning_incomplete"; missing: ("owner" | "due_date" | "acceptance_criteria")[] }
  | { kind: "suggested" };

export interface IndicatorOptions {
  /** Days ahead that count as "due soon". Set by leadership in conference settings. */
  dueSoonDays: number;
}

export function taskIndicators(t: IndicatorInput, today: IsoDate, options: IndicatorOptions): Indicator[] {
  const out: Indicator[] = [];
  const done = t.status === "completed";

  if (t.due_date && !done) {
    // Inclusive due dates: work due today isn't overdue until tomorrow.
    const remaining = diffDays(today, t.due_date);
    if (remaining < 0) out.push({ kind: "overdue", days: -remaining });
    else if (remaining <= options.dueSoonDays) out.push({ kind: "due_soon", days: remaining });
  }
  if (t.status === "blocked") out.push({ kind: "blocked" });
  if (t.status === "submitted_for_review") out.push({ kind: "awaiting_review" });

  if (!done) {
    const missing: ("owner" | "due_date" | "acceptance_criteria")[] = [];
    if (!t.accountable_owner_id) missing.push("owner");
    if (!t.due_date) missing.push("due_date");
    if (!t.acceptance_criteria?.trim()) missing.push("acceptance_criteria");
    if (missing.length) out.push({ kind: "planning_incomplete", missing });
  }
  if (t.planning_state === "suggested") out.push({ kind: "suggested" });
  return out;
}

export type Tone = "green" | "amber" | "red" | "grey";

/** One consistent mapping from indicator to colour (brief §9.1). */
export function indicatorTone(i: Indicator, isCritical: boolean): Tone {
  switch (i.kind) {
    case "overdue":
    case "blocked":
      return "red";
    case "due_soon":
      return isCritical ? "red" : "amber";
    case "awaiting_review":
    case "planning_incomplete":
      return "amber";
    case "suggested":
      return "grey";
  }
}

export function indicatorLabel(i: Indicator): string {
  switch (i.kind) {
    case "overdue":
      return `Overdue ${i.days}d`;
    case "due_soon":
      return i.days === 0 ? "Due today" : `Due in ${i.days}d`;
    case "blocked":
      return "Blocked";
    case "awaiting_review":
      return "Awaiting review";
    case "planning_incomplete":
      return `Needs ${i.missing.map((m) => m.replace("_", " ")).join(", ")}`;
    case "suggested":
      return "Suggested";
  }
}
