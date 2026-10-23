export interface ActivityRow {
  id: number;
  verb: string;
  task_id: string | null;
  actor_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

const VERBS: Record<string, string> = {
  "task.created": "created",
  "task.completed": "completed",
  "task.status_changed": "updated the status of",
  "task.reassigned": "reassigned",
  "task.rescheduled": "changed the due date of",
  "blocker.raised": "raised a blocker on",
  "blocker.resolved": "resolved the blocker on",
  "dependency.added": "added a dependency to",
  "dependency.removed": "removed a dependency from",
  "dependency.exception_approved": "approved a dependency exception on",
  "dependency.exception_withdrawn": "withdrew a dependency exception on",
};

export function describeActivity(a: ActivityRow): string {
  return VERBS[a.verb] ?? a.verb;
}
