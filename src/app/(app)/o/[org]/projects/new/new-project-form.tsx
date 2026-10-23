"use client";

import { useState } from "react";
import { createProject } from "@/lib/projects/actions";
import { toSlug } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { TimezoneSelect } from "@/components/timezone-select";
import { inputClass } from "@/components/ui";
import { SlugField } from "@/components/slug-field";

export function NewProjectForm({ org, orgTimezone }: { org: string; orgTimezone: string }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  return (
    <ActionForm action={createProject} submit="Create project" pendingLabel="Creating…" className="space-y-4">
      <input type="hidden" name="org" value={org} />
      <label className="block text-sm font-medium">
        Project name
        <input
          name="name"
          required
          maxLength={160}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!edited) setSlug(toSlug(e.target.value));
          }}
          placeholder="e.g. Annual conference 2027, Office move, Product launch"
          className={inputClass}
        />
      </label>
      <SlugField prefix={`/o/${org}/p/`} value={slug} onChange={(v) => { setSlug(v); setEdited(true); }} />
      <label className="block text-sm font-medium">
        Description <span className="font-normal text-ink-muted">(optional)</span>
        <textarea name="description" rows={2} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Start date <span className="font-normal text-ink-muted">(optional)</span>
          <input type="date" name="start_date" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          Target date <span className="font-normal text-ink-muted">(optional)</span>
          <input type="date" name="target_date" className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-ink-muted">The launch, event day or go-live everything builds towards.</span>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Time zone
        <TimezoneSelect allowInherit={`Same as the organization (${orgTimezone})`} />
      </label>
    </ActionForm>
  );
}
