import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { getPickerOptions } from "@/lib/tasks/options";
import { deleteTask, setAssignee, toggleChecklistItem } from "@/lib/tasks/actions";
import { statusLabel, type TaskRow } from "@/lib/tasks/types";
import { TaskForm } from "@/components/task-form";
import { TaskBadges } from "@/components/task-badges";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { DependenciesPanel, SchedulePanel } from "@/components/schedule-panel";
import { loadSchedule } from "@/lib/schedule/data";
import { AttachmentLink, AttachmentUpload, ChecklistAdd, CommentForm, StatusControl } from "@/components/task-interactions";
import { Badge, Card, EmptyState, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";

const FIELD_LABELS: Record<string, string> = {
  title: "Title", description: "Description", department_id: "Department", accountable_owner_id: "Owner",
  reviewer_id: "Reviewer", priority: "Priority", is_critical: "Critical", status: "Status", start_date: "Start date",
  due_date: "Due date", duration_days: "Duration", kind: "Type", baseline_start: "Baseline start", baseline_finish: "Baseline finish", actual_start: "Actual start", actual_finish: "Actual finish",
  reported_completion: "Reported completion", acceptance_criteria: "Acceptance criteria", requires_evidence: "Requires evidence",
  requires_review: "Requires review", blocker_details: "Blocker", next_action: "Next action", planning_state: "Planning state",
};

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error: pageError } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const access = await getAccess();
  const settings = await getSettings();
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle<TaskRow>();
  // RLS returns nothing for tasks this user may not see, so we don't reveal they exist.
  if (!task) notFound();

  const [{ data: assignees }, { data: checklist }, { data: comments }, { data: attachments }, { data: history }, options, schedule] = await Promise.all([
    supabase.from("task_assignees").select("user_id, role, profiles!task_assignees_user_id_fkey(full_name, email)").eq("task_id", id),
    supabase.from("task_checklist_items").select("*").eq("task_id", id).order("sort_order").order("created_at"),
    supabase.from("task_comments").select("id, body, created_at, author:profiles!task_comments_author_id_fkey(full_name, email)").eq("task_id", id).order("created_at"),
    supabase.from("task_attachments").select("*").eq("task_id", id).order("created_at", { ascending: false }),
    supabase.from("task_change_history").select("*").eq("task_id", id).order("changed_at", { ascending: false }).limit(50),
    getPickerOptions(),
    loadSchedule(),
  ]);

  const nameOf = (uid: string | null) => (uid ? options.people.find((p) => p.id === uid)?.label ?? "Former member" : "Not set");
  const deptName = options.departments.find((d) => d.id === task.department_id)?.label ?? null;
  const canEdit = access.can("tasks.edit", task.department_id);
  const canAssign = access.can("tasks.assign", task.department_id);
  const canDelete = access.can("tasks.delete", task.department_id);
  const involved = task.accountable_owner_id === access.userId || task.reviewer_id === access.userId || !!assignees?.some((a) => a.user_id === access.userId);
  const canProgress = canEdit || involved;
  const hasEvidence = !!attachments?.some((a) => a.is_evidence);

  return (
    <>
      <RealtimeRefresh tables={["tasks", "task_comments", "task_checklist_items", "task_dependencies"]} />
      <p className="mb-2 text-sm"><Link href="/tasks" className="text-brand hover:underline">← Tasks</Link></p>
      <PageHeader
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {task.kind === "milestone" && <Badge tone="grey">◆ Milestone</Badge>}
            <Badge tone={task.status === "completed" ? "green" : task.status === "blocked" ? "red" : "grey"}>{statusLabel(task.status)}</Badge>
            <TaskBadges task={task} today={settings.today} dueSoonDays={settings.dueSoonDays} />
            {deptName && <span>{deptName}</span>}
            {task.source === "seed" && <span>· From the initial planning baseline</span>}
          </span>
        }
      />
      {pageError && <p role="alert" className="mb-4 rounded-md bg-status-red-bg p-3 text-sm text-status-red">{pageError}</p>}

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {task.status === "blocked" && (
            <div className="rounded-lg border border-status-red/30 bg-status-red-bg p-4 text-sm text-status-red">
              <p className="font-semibold">Blocked</p>
              <p className="mt-1 whitespace-pre-wrap">{task.blocker_details}</p>
            </div>
          )}

          <Card title="Details">
            {canEdit ? (
              <TaskForm task={task} departments={options.departments} people={options.people} canAssign={canAssign} canApprovePlanning={access.can("baseline.approve")} />
            ) : (
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Info label="Accountable owner" value={nameOf(task.accountable_owner_id)} />
                <Info label="Reviewer" value={task.reviewer_id ? nameOf(task.reviewer_id) : "None"} />
                <Info label="Start date" value={task.start_date ?? "Not set"} />
                <Info label="Due date" value={task.due_date ?? "Not set"} />
                <Info label="Priority" value={task.priority} />
                <Info label="Duration" value={task.duration_days ? `${task.duration_days} days` : "Not set"} />
                <div className="sm:col-span-2"><Info label="Description" value={task.description ?? "—"} /></div>
                <div className="sm:col-span-2"><Info label="Acceptance criteria" value={task.acceptance_criteria ?? "Not set"} /></div>
                <div className="sm:col-span-2"><Info label="Next action" value={task.next_action ?? "—"} /></div>
              </dl>
            )}
          </Card>

          <SchedulePanel task={task} schedule={schedule} access={access} />
          <DependenciesPanel task={task} schedule={schedule} access={access} />

          <Card title={`Discussion (${comments?.length ?? 0})`}>
            {comments?.length ? (
              <ol className="mb-4 space-y-3">
                {comments.map((c) => {
                  const author = c.author as unknown as { full_name: string | null; email: string } | null;
                  return (
                    <li key={c.id} className="text-sm">
                      <p className="text-xs text-ink-muted">
                        <span className="font-medium text-ink">{author?.full_name ?? author?.email ?? "Former member"}</span> · {new Date(c.created_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mb-3 text-sm text-ink-muted">No comments yet.</p>
            )}
            <CommentForm taskId={task.id} />
          </Card>

          <Card title="History">
            {history?.length ? (
              <ol className="space-y-2 text-sm">
                {history.map((h) => (
                  <li key={h.id}>
                    <span className="text-xs text-ink-muted">{new Date(h.changed_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} · {nameOf(h.changed_by)}</span>
                    <p>
                      <span className="font-medium">{FIELD_LABELS[h.field] ?? h.field}</span>: {fmt(h.field, h.old_value, nameOf)} → {fmt(h.field, h.new_value, nameOf)}
                      {h.reason && <span className="text-ink-muted"> · “{h.reason}”</span>}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-muted">No changes since the task was created.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {canProgress && (
            <Card title="Progress">
              <StatusControl
                id={task.id}
                version={task.version}
                status={task.status}
                blockerDetails={task.blocker_details}
                requiresReview={task.requires_review}
                isReviewer={task.reviewer_id === access.userId}
                canEdit={canEdit}
              />
              {task.requires_evidence && !hasEvidence && task.status !== "not_started" && (
                <p className="mt-3 text-xs text-status-amber">Completion needs evidence. Upload it under Files and evidence.</p>
              )}
            </Card>
          )}

          <Card title="People">
            <dl className="space-y-2 text-sm">
              <Info label="Accountable owner" value={nameOf(task.accountable_owner_id)} />
              {task.reviewer_id && <Info label="Reviewer" value={nameOf(task.reviewer_id)} />}
            </dl>
            <p className="mt-3 text-xs font-medium text-ink-muted">Collaborators</p>
            <ul className="mt-1 space-y-1 text-sm">
              {assignees?.length ? assignees.map((a) => (
                <li key={a.user_id} className="flex items-center justify-between gap-2">
                  <span>{nameOf(a.user_id)}</span>
                  {canAssign && (
                    <form action={setAssignee}>
                      <input type="hidden" name="task_id" value={task.id} />
                      <input type="hidden" name="user_id" value={a.user_id} />
                      <input type="hidden" name="op" value="remove" />
                      <button className="text-xs text-ink-muted hover:text-status-red" aria-label={`Remove ${nameOf(a.user_id)}`}>Remove</button>
                    </form>
                  )}
                </li>
              )) : <li className="text-ink-muted">None</li>}
            </ul>
            {canAssign && (
              <form action={setAssignee} className="mt-3 flex gap-2">
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="op" value="add" />
                <select name="user_id" required className={`${inputClass} mt-0`} defaultValue="">
                  <option value="" disabled>Add collaborator…</option>
                  {options.people.filter((p) => !assignees?.some((a) => a.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button className={secondaryButtonClass}>Add</button>
              </form>
            )}
          </Card>

          <Card title={`Checklist ${checklist?.length ? `(${checklist.filter((c) => c.is_done).length}/${checklist.length})` : ""}`}>
            {checklist?.length ? (
              <ul className="space-y-1.5 text-sm">
                {checklist.map((c) => (
                  <li key={c.id}>
                    <form action={toggleChecklistItem} className="flex items-start gap-2">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="task_id" value={task.id} />
                      <input type="hidden" name="done" value={String(!c.is_done)} />
                      <button disabled={!canProgress} aria-label={c.is_done ? `Mark "${c.label}" not done` : `Mark "${c.label}" done`} className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line text-[10px] leading-none text-white disabled:opacity-50" style={{ background: c.is_done ? "var(--color-status-green)" : undefined }}>
                        {c.is_done ? "✓" : ""}
                      </button>
                      <span className={c.is_done ? "text-ink-muted line-through" : ""}>{c.label}</span>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No checklist items.</EmptyState>
            )}
            {canEdit && <ChecklistAdd taskId={task.id} />}
          </Card>

          <Card title="Files and evidence">
            {attachments?.length ? (
              <ul className="space-y-1.5 text-sm">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <AttachmentLink path={a.storage_path} name={a.file_name} />
                    {a.is_evidence && <Badge tone="green">Evidence</Badge>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No files yet.</p>
            )}
            {canProgress && <AttachmentUpload conferenceId={access.conference.id} taskId={task.id} />}
          </Card>

          {canDelete && (
            <form action={deleteTask}>
              <input type="hidden" name="id" value={task.id} />
              <button className="text-sm text-status-red hover:underline">Delete task</button>
              <p className="mt-1 text-xs text-ink-muted">Deletion is recorded in the audit log.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

function fmt(field: string, v: unknown, nameOf: (id: string | null) => string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field.endsWith("owner_id") || field === "reviewer_id") return nameOf(String(v));
  if (field === "status") return statusLabel(v as never);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = String(v);
  return s.length > 80 ? s.slice(0, 80) + "…" : s;
}
