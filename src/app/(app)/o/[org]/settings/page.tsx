import { redirect } from "next/navigation";
import { getOrgAccess } from "@/lib/auth";
import { updateOrganization } from "@/lib/org/actions";
import { ActionForm } from "@/components/action-form";
import { TimezoneSelect } from "@/components/timezone-select";
import { Card, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "Organization settings · Orchestr" };

export default async function OrgSettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  if (!access.can("org.manage")) redirect(access.base);
  return (
    <>
      <PageHeader title="Organization settings" />
      <Card className="max-w-xl">
        <ActionForm action={updateOrganization} submit="Save" className="space-y-4">
          <input type="hidden" name="org" value={access.org.slug} />
          <label className="block text-sm font-medium">Name<input name="name" required defaultValue={access.org.name} className={inputClass} /></label>
          <label className="block text-sm font-medium">
            Time zone
            <TimezoneSelect defaultValue={access.org.timezone} />
            <span className="mt-1 block text-xs font-normal text-ink-muted">Used for &quot;today&quot; in projects that don&apos;t set their own.</span>
          </label>
          <label className="block text-sm font-medium">
            What do you call your units?
            <input name="unit_label" required maxLength={40} defaultValue={access.org.unit_label} className={inputClass} />
            <span className="mt-1 block text-xs font-normal text-ink-muted">For example Department, Division, Faculty or Region. Shown on the Teams &amp; structure page.</span>
          </label>
          <p className="text-xs text-ink-muted">Web address: /o/{access.org.slug} (fixed, so existing links keep working).</p>
        </ActionForm>
      </Card>
    </>
  );
}
