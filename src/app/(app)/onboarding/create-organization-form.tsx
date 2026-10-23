"use client";

import { useState } from "react";
import { createOrganization } from "@/lib/org/actions";
import { toSlug } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { SlugField } from "@/components/slug-field";
import { TimezoneSelect } from "@/components/timezone-select";
import { inputClass } from "@/components/ui";

export function CreateOrganizationForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <ActionForm action={createOrganization} submit="Create organization" pendingLabel="Creating…" className="space-y-4">
      <label className="block text-sm font-medium">
        Organization name
        <input
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(toSlug(e.target.value));
          }}
          placeholder="e.g. Acme Events Ltd"
          className={inputClass}
        />
      </label>
      <SlugField prefix="/o/" value={slug} onChange={(v) => { setSlug(v); setSlugEdited(true); }} />
      <label className="block text-sm font-medium">
        Time zone
        <TimezoneSelect detect />
        <span className="mt-1 block text-xs font-normal text-ink-muted">Decides when work becomes &quot;overdue&quot;. Projects can use their own.</span>
      </label>
    </ActionForm>
  );
}
