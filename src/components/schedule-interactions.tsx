"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addDependency, previewImpact, setDependencyException, type ImpactPreview } from "@/lib/schedule/actions";
import { rebaseline } from "@/lib/tasks/actions";
import type { ActionResult } from "@/lib/tasks/types";
import { formatDay, formatShift } from "@/lib/format";
import { buttonClass, inputClass, secondaryButtonClass } from "./ui";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm text-status-green">{state.message ?? "Saved"}</p>
  ) : (
    <p role="alert" className="text-sm text-status-red">{state.error}</p>
  );
}

export function AddDependencyForm({ taskId, options }: { taskId: string; options: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addDependency, null);
  const [type, setType] = useState("finish_to_start");
  return (
    <form action={action} className="mt-4 space-y-3 border-t border-line pt-4">
      <input type="hidden" name="task_id" value={taskId} />
      <p className="text-sm font-medium text-ink">Add a dependency</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-xs font-medium text-ink-muted">This task</span>
          <select name="direction" defaultValue="waits_on" className={inputClass}>
            <option value="waits_on">waits on…</option>
            <option value="blocks">must finish before…</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-ink-muted">Other task</span>
          <select name="other_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Choose a task…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-medium text-ink-muted">Kind of link</span>
          <select name="type" value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            <option value="finish_to_start">Blocking: must finish first</option>
            <option value="informational">Related: for information, never blocks</option>
          </select>
        </label>
        {type === "finish_to_start" && (
          <label className="block text-sm">
            <span className="text-xs font-medium text-ink-muted">Gap after it finishes (days)</span>
            <input name="lag_days" type="number" min={0} step={1} defaultValue={0} className={inputClass} />
          </label>
        )}
      </div>
      <Result state={state} />
      <button disabled={pending} className={secondaryButtonClass}>{pending ? "Adding…" : "Add dependency"}</button>
    </form>
  );
}

export function ExceptionForm({ id, taskId, approved }: { id: string; taskId: string; approved: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(setDependencyException, null);
  const [open, setOpen] = useState(false);
  if (approved) {
    return (
      <form action={action} className="inline">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="task_id" value={taskId} />
        <input type="hidden" name="approve" value="false" />
        <button disabled={pending} className="text-xs text-ink-muted hover:text-status-red">Withdraw exception</button>
        {state && !state.ok && <span className="ml-2 text-xs text-status-red">{state.error}</span>}
      </form>
    );
  }
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand hover:underline">Approve exception…</button>;
  }
  return (
    <form action={action} className="mt-2 space-y-2 rounded-md bg-surface-muted p-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="approve" value="true" />
      <label className="block text-xs font-medium text-ink-muted">
        Why may this task go ahead before the other finishes?
        <input name="reason" required className={inputClass} />
      </label>
      <Result state={state} />
      <div className="flex gap-2">
        <button disabled={pending} className={secondaryButtonClass}>Record exception</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:underline">Cancel</button>
      </div>
    </form>
  );
}

export function ImpactPreviewForm({ taskId, defaultDate }: { taskId: string; defaultDate: string | null }) {
  const [state, action, pending] = useActionState<ImpactPreview | { ok: false; error: string } | null, FormData>(previewImpact, null);
  return (
    <div className="mt-4 border-t border-line pt-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="task_id" value={taskId} />
        <label className="block text-sm">
          <span className="text-xs font-medium text-ink-muted">What if this finishes on…</span>
          <input type="date" name="finish" required defaultValue={defaultDate ?? ""} className={inputClass} />
        </label>
        <button disabled={pending} className={secondaryButtonClass}>{pending ? "Checking…" : "Check impact"}</button>
      </form>
      <p className="mt-1 text-xs text-ink-muted">A preview only. Nothing is saved.</p>
      {state && !state.ok && <p role="alert" className="mt-2 text-sm text-status-red">{state.error}</p>}
      {state?.ok && (
        <div role="status" className="mt-3 space-y-2 text-sm">
          {state.affected.length === 0 ? (
            <p>No other task you can see would move{state.absorbed ? ` (${state.absorbed} downstream absorbed by slack)` : ""}.</p>
          ) : (
            <>
              <p>
                Finishing on <strong>{formatDay(state.finish)}</strong> moves {state.affected.length} task{state.affected.length === 1 ? "" : "s"}
                {state.absorbed ? `; ${state.absorbed} more absorb it in their slack` : ""}.
              </p>
              <ul className="divide-y divide-line rounded-md border border-line">
                {state.affected.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <Link href={`/tasks/${e.id}`} className="hover:text-brand">
                      {e.milestone && <span aria-label="Milestone">◆ </span>}{e.title}
                    </Link>
                    <span className="text-xs tabular-nums">
                      {e.shiftDays === null
                        ? "Can't be forecast"
                        : <>{formatDay(e.before, "?")} → <strong>{formatDay(e.after, "?")}</strong> ({formatShift(e.shiftDays)})</>}
                      {e.breachesPlan && <span className="ml-2 font-semibold text-status-red">misses {formatDay(e.plannedFinish)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!state.quantifiable && state.missing.length > 0 && (
            <div className="rounded-md bg-status-amber-bg p-3 text-status-amber">
              <p className="font-medium">Some impact can&apos;t be measured yet:</p>
              <ul className="mt-1 list-disc pl-5">{state.missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RebaselineForm({ id, version }: { id: string; version: number }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(rebaseline, null);
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-brand hover:underline">Re-baseline to current plan…</button>;
  return (
    <form action={action} className="mt-2 space-y-2 rounded-md bg-surface-muted p-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <label className="block text-xs font-medium text-ink-muted">
        Reason (kept in the task history)
        <input name="change_reason" required className={inputClass} />
      </label>
      <Result state={state} />
      <div className="flex gap-2">
        <button disabled={pending} className={buttonClass}>Set baseline</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted hover:underline">Cancel</button>
      </div>
    </form>
  );
}
