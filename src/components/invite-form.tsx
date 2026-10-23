"use client";

import { useActionState, useRef } from "react";
import { inviteMember } from "@/lib/team/actions";
import type { ActionResult } from "@/lib/tasks/types";
import { buttonClass, inputClass } from "./ui";

export function InviteForm({
  roles,
  departments,
}: {
  roles: { key: string; title: string }[];
  departments: { id: string; label: string }[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const r = await inviteMember(prev, fd);
    if (r.ok) ref.current?.reset();
    return r;
  }, null);
  const err = (f: string) => (state && !state.ok ? state.fieldErrors?.[f]?.[0] : undefined);

  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">
        Full name
        <input name="full_name" required className={inputClass} />
        {err("full_name") && <span className="text-xs text-status-red">{err("full_name")}</span>}
      </label>
      <label className="text-sm font-medium">
        Email
        <input name="email" type="email" required className={inputClass} />
        {err("email") && <span className="text-xs text-status-red">{err("email")}</span>}
      </label>
      <label className="text-sm font-medium">
        Role
        <select name="role_key" defaultValue="team_member" className={inputClass}>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">
        Label <span className="font-normal text-ink-muted">(optional, e.g. &quot;Volunteer Lead – Registration&quot;)</span>
        <input name="label" className={inputClass} />
      </label>
      <label className="text-sm font-medium">
        Department <span className="font-normal text-ink-muted">(optional)</span>
        <select name="department_id" defaultValue="" className={inputClass}>
          <option value="">None</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">
        Department role
        <select name="department_role" defaultValue="member" className={inputClass}>
          <option value="member">Member</option>
          <option value="lead">Lead</option>
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={buttonClass}>{pending ? "Sending…" : "Send invitation"}</button>
        {state && <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-status-green" : "text-status-red"}`}>{state.ok ? state.message : state.error}</p>}
      </div>
    </form>
  );
}
