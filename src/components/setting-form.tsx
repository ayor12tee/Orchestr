"use client";

import { useActionState } from "react";
import { updateSetting } from "@/lib/settings-actions";
import type { ActionResult } from "@/lib/tasks/types";
import { buttonClass, inputClass } from "./ui";

export function SettingForm({
  settingKey,
  field,
  label,
  hint,
  unit,
  value,
  min,
  max,
  approved,
}: {
  settingKey: string;
  field: string;
  label: string;
  hint: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  approved: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateSetting, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="key" value={settingKey} />
      <label className="block text-sm font-medium text-ink">
        {label}
        <span className="mt-1 flex items-center gap-2">
          <input name={field} type="number" min={min} max={max} step={1} defaultValue={value} required className={`${inputClass} mt-0 w-28`} />
          <span className="text-sm font-normal text-ink-muted">{unit}</span>
        </span>
        <span className="mt-1 block text-xs font-normal text-ink-muted">{hint}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="approval_state" value="approved" defaultChecked={approved} /> Approved by leadership
      </label>
      {state && (
        <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-status-green" : "text-status-red"}`}>
          {state.ok ? state.message : state.error}
        </p>
      )}
      <button disabled={pending} className={buttonClass}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
