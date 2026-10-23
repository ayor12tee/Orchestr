"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { addChecklistItem, addComment, changeStatus, getAttachmentUrl, recordAttachment } from "@/lib/tasks/actions";
import { STATUSES, type ActionResult, type TaskStatus } from "@/lib/tasks/types";
import { getBrowserClient } from "@/lib/supabase/client";
import { ProjectFields, useProject } from "./project-context";
import { buttonClass, inputClass, secondaryButtonClass } from "./ui";

function Feedback({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (state.ok) return state.message ? <p role="status" className="text-sm text-status-green">{state.message}</p> : null;
  return (
    <p role="alert" className={`text-sm ${state.conflict ? "text-status-amber" : "text-status-red"}`}>
      {state.error}
      {state.conflict && <button type="button" onClick={() => location.reload()} className="ml-2 font-semibold underline">Reload</button>}
    </p>
  );
}

export function StatusControl({
  id,
  version,
  status,
  blockerDetails,
  requiresReview,
  isReviewer,
  canEdit,
  openBlockers,
}: {
  id: string;
  version: number;
  status: TaskStatus;
  blockerDetails: string | null;
  requiresReview: boolean;
  isReviewer: boolean;
  canEdit: boolean;
  /** Unfinished tasks this one waits on (without an approved exception). */
  openBlockers: number;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changeStatus, null);
  const [next, setNext] = useState<TaskStatus>(status);
  // Mirrors the database rule so people aren't offered a choice that will be refused.
  const options = STATUSES.filter((s) => s.value !== "completed" || !requiresReview || isReviewer || canEdit || status === "completed");
  const starting = status === "not_started" && next !== "not_started" && next !== "blocked";

  return (
    <form action={action} className="space-y-3">
      <ProjectFields />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <label className="block text-sm font-medium">
        Status
        <select name="status" value={next} onChange={(e) => setNext(e.target.value as TaskStatus)} className={inputClass}>
          {options.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {requiresReview && !isReviewer && !canEdit && (
        <p className="text-xs text-ink-muted">This task needs review. Submit it for review, and the reviewer will complete it.</p>
      )}
      {starting && openBlockers > 0 && (
        <p className="rounded-md bg-status-amber-bg p-2 text-xs text-status-amber">
          This task still waits on {openBlockers} unfinished task{openBlockers === 1 ? "" : "s"}. You can start anyway, but consider asking for an approved exception.
        </p>
      )}
      {next === "blocked" && (
        <label className="block text-sm font-medium">
          What&apos;s blocking it? <span className="text-status-red">*</span>
          <textarea name="blocker_details" required rows={2} defaultValue={blockerDetails ?? ""} className={inputClass} />
        </label>
      )}
      <button disabled={pending || next === status} className={buttonClass}>{pending ? "Updating…" : "Update status"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await addComment(prev, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, null);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <ProjectFields />
      <input type="hidden" name="task_id" value={taskId} />
      <textarea name="body" rows={2} required placeholder="Add an update, question or decision…" className={inputClass} />
      <div className="flex items-center gap-3">
        <button disabled={pending} className={secondaryButtonClass}>{pending ? "Posting…" : "Post comment"}</button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ChecklistAdd({ taskId }: { taskId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await addChecklistItem(prev, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, null);
  return (
    <form ref={ref} action={action} className="mt-3 flex gap-2">
      <ProjectFields />
      <input type="hidden" name="task_id" value={taskId} />
      <input name="label" required placeholder="New checklist item" className={`${inputClass} mt-0`} />
      <button disabled={pending} className={secondaryButtonClass}>Add</button>
      <Feedback state={state} />
    </form>
  );
}

const MAX_BYTES = 25 * 1024 * 1024;

export function AttachmentUpload({ taskId }: { taskId: string }) {
  const ref = useProject();
  const [state, setState] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const evidenceRef = useRef<HTMLInputElement>(null);

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return setState({ ok: false, error: "Choose a file first." });
    if (file.size > MAX_BYTES) return setState({ ok: false, error: "Files must be 25 MB or smaller." });
    start(async () => {
      setState({ ok: true, message: `Uploading ${file.name}…` });
      const safeName = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${ref.orgId}/${ref.projectId}/${taskId}/${crypto.randomUUID()}-${safeName}`;
      const { error } = await getBrowserClient().storage.from("task-evidence").upload(path, file, { contentType: file.type || undefined });
      if (error) return setState({ ok: false, error: "Upload failed. You may not have permission to add files to this task." });
      const r = await recordAttachment({
        org: ref.org,
        project: ref.project,
        task_id: taskId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        is_evidence: !!evidenceRef.current?.checked,
      });
      setState(r);
      if (r.ok && fileRef.current) fileRef.current.value = "";
    });
  }

  return (
    <div className="mt-3 space-y-2">
      <input ref={fileRef} type="file" className="block w-full text-sm" />
      <label className="flex items-center gap-2 text-sm"><input ref={evidenceRef} type="checkbox" /> This is completion evidence</label>
      <button type="button" onClick={upload} disabled={pending} className={secondaryButtonClass}>{pending ? "Uploading…" : "Upload"}</button>
      <Feedback state={state} />
    </div>
  );
}

export function AttachmentLink({ path, name }: { path: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const url = await getAttachmentUrl(path);
          if (url) window.open(url, "_blank", "noopener");
          else alert("You can't open this file.");
        })
      }
      className="text-left text-brand hover:underline"
    >
      {name}
    </button>
  );
}
