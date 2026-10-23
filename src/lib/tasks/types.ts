import type { TaskStatus } from "@/lib/domain/schedule";

export type { TaskStatus };
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "submitted_for_review", label: "Submitted for Review" },
  { value: "completed", label: "Completed" },
];
export const statusLabel = (s: TaskStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;

export const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

export interface TaskRow {
  id: string;
  conference_id: string;
  department_id: string | null;
  workstream: string | null;
  kind: "task" | "milestone";
  title: string;
  description: string | null;
  accountable_owner_id: string | null;
  reviewer_id: string | null;
  priority: TaskPriority;
  is_critical: boolean;
  status: TaskStatus;
  start_date: string | null;
  due_date: string | null;
  duration_days: number | null;
  actual_start: string | null;
  actual_finish: string | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  reported_completion: number;
  acceptance_criteria: string | null;
  requires_evidence: boolean;
  requires_review: boolean;
  blocker_details: string | null;
  next_action: string | null;
  planning_state: "suggested" | "approved";
  source: "manual" | "seed" | "template";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaskListRow extends TaskRow {
  department: { name: string; slug: string } | null;
  owner: { full_name: string | null; email: string } | null;
}

export const TASK_LIST_SELECT =
  "*, department:departments(name, slug), owner:profiles!tasks_accountable_owner_id_fkey(full_name, email)";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; conflict?: boolean; fieldErrors?: Record<string, string[]> };

export interface DependencyRow {
  id: string;
  conference_id: string;
  predecessor_id: string;
  successor_id: string;
  type: "finish_to_start" | "informational";
  lag_days: number;
  exception_approved: boolean;
  exception_reason: string | null;
  exception_approved_by: string | null;
  exception_approved_at: string | null;
  created_at: string;
}
