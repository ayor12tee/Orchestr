"use client";

import { useActionState, useState } from "react";
import { createTask, updateTask } from "@/lib/tasks/actions";
import type { ActionResult, TaskRow } from "@/lib/tasks/types";
import { PRIORITIES } from "@/lib/tasks/types";
import { ProjectFields } from "./project-context";
import { buttonClass, inputClass } from "./ui";

interface Option {
  id: string;
  label: string;
}

export function TaskForm({
  task,
  teams,
  people,
  canAssign,
  canApprovePlanning,
  allowNoTeam,
  defaultTeamId,
}: {
  task?: TaskRow;
  /** Teams the user may put this task in. */
  teams: Option[];
  people: Option[];
  canAssign: boolean;
  canApprovePlanning: boolean;
  /** Whether the user may create or keep project-wide tasks with no team. */
  allowNoTeam: boolean;
  defaultTeamId?: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(task ? updateTask : createTask, null);
  const err = (f: string) => (state && !state.ok ? state.fieldErrors?.[f]?.[0] : undefined);
  const [kind, setKind] = useState<"task" | "milestone">(task?.kind ?? "task");
  const milestone = kind === "milestone";

  return (
    <form action={action} className="space-y-4">
      <ProjectFields />
      {task && (
        <>
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="version" value={task.version} />
        </>
      )}

      {state && !state.ok && (
        <p role="alert" className={`rounded-md p-3 text-sm ${state.conflict ? "bg-status-amber-bg text-status-amber" : "bg-status-red-bg text-status-red"}`}>
          {state.error}
          {state.conflict && (
            <button type="button" onClick={() => location.reload()} className="ml-2 font-semibold underline">Reload</button>
          )}
        </p>
      )}
      {state?.ok && <p role="status" className="text-sm text-status-green">{state.message ?? "Saved"}</p>}

      <Field label="Title" error={err("title")}>
        <input name="title" required defaultValue={task?.title} className={inputClass} />
      </Field>
      <Field label="Description">
        <textarea name="description" rows={3} defaultValue={task?.description ?? ""} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Team" error={err("team_id")} hint="The team responsible. Team roles apply to its tasks.">
          <select name="team_id" defaultValue={task?.team_id ?? defaultTeamId ?? (allowNoTeam ? "" : teams[0]?.id)} className={inputClass}>
            {allowNoTeam && <option value="">No team (project-wide)</option>}
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Workstream" hint="Optional grouping, e.g. 'Outreach' or 'Venue'.">
          <input name="workstream" defaultValue={task?.workstream ?? ""} className={inputClass} />
        </Field>
        <Field label="Accountable owner" hint={canAssign ? "One person is accountable." : "Only people who can assign tasks may change this."}>
          <select name="accountable_owner_id" defaultValue={task?.accountable_owner_id ?? ""} disabled={!canAssign} className={inputClass}>
            <option value="">Not set</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {!canAssign && <input type="hidden" name="accountable_owner_id" value={task?.accountable_owner_id ?? ""} />}
        </Field>
        <Field label="Reviewer">
          <select name="reviewer_id" defaultValue={task?.reviewer_id ?? ""} disabled={!canAssign} className={inputClass}>
            <option value="">None</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {!canAssign && <input type="hidden" name="reviewer_id" value={task?.reviewer_id ?? ""} />}
        </Field>
        <Field label="Type" hint={milestone ? "A checkpoint with a single date, such as 'Contract signed'." : undefined}>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as "task" | "milestone")} className={inputClass}>
            <option value="task">Task</option>
            <option value="milestone">Milestone</option>
          </select>
        </Field>
        <Field label="Priority">
          <select name="priority" defaultValue={task?.priority ?? "medium"} className={inputClass}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </Field>
        {!milestone && (
          <Field label="Start date" error={err("start_date")}>
            <input type="date" name="start_date" defaultValue={task?.start_date ?? ""} className={inputClass} />
          </Field>
        )}
        <Field label={milestone ? "Date" : "Due date"} hint={milestone ? "The day this milestone should be reached." : "Inclusive: the task is due by the end of this day."} error={err("due_date")}>
          <input type="date" name="due_date" defaultValue={task?.due_date ?? ""} className={inputClass} />
        </Field>
        {!milestone && (
          <Field label="Estimated duration (calendar days)" hint="Needed to forecast downstream impact." error={err("duration_days")}>
            <input type="number" min={1} step={1} name="duration_days" defaultValue={task?.duration_days ?? ""} className={inputClass} />
          </Field>
        )}
        {canApprovePlanning && (
          <Field label="Planning values" hint="Approve once owner, dates and criteria are confirmed. The first approval sets the baseline.">
            <select name="planning_state" defaultValue={task?.planning_state ?? "approved"} className={inputClass}>
              <option value="suggested">Suggested (not yet confirmed)</option>
              <option value="approved">Approved</option>
            </select>
          </Field>
        )}
      </div>

      <Field label="Acceptance criteria" hint="What must be true for this to count as done?">
        <textarea name="acceptance_criteria" rows={2} defaultValue={task?.acceptance_criteria ?? ""} className={inputClass} />
      </Field>
      <Field label="Next action">
        <input name="next_action" defaultValue={task?.next_action ?? ""} className={inputClass} />
      </Field>

      <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="is_critical" defaultChecked={task?.is_critical} /> Critical task</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="requires_evidence" defaultChecked={task?.requires_evidence} /> Completion requires evidence</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="requires_review" defaultChecked={task?.requires_review} /> Completion requires review</label>
      </fieldset>

      {task && (
        <Field label="Reason for change" hint="Recorded in the task history, especially for date or owner changes.">
          <input name="change_reason" className={inputClass} />
        </Field>
      )}

      <button disabled={pending} className={buttonClass}>{pending ? "Saving…" : task ? "Save changes" : "Create task"}</button>
    </form>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {children}
      {hint && !error && <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>}
      {error && <span role="alert" className="mt-1 block text-xs font-normal text-status-red">{error}</span>}
    </label>
  );
}
