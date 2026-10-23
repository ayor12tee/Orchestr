import { redirect } from "next/navigation";
import { getProjectAccess } from "@/lib/auth";
import { updateProject, updateProjectSetting } from "@/lib/projects/actions";
import { getProjectSettings } from "@/lib/projects/data";
import { ActionForm } from "@/components/action-form";
import { ProjectFields } from "@/components/project-context";
import { TimezoneSelect } from "@/components/timezone-select";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "Project settings · Orchestr" };

export default async function ProjectSettingsPage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const access = await getProjectAccess(org, project);
  if (!access.canInProject("project.manage")) redirect(access.projectBase);
  const settings = await getProjectSettings(access);
  const p = access.project;

  return (
    <>
      <PageHeader title="Project settings" description="Suggested values are defaults until someone who manages the project approves them." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Project">
          <ActionForm action={updateProject} submit="Save" className="space-y-3">
            <ProjectFields />
            <label className="block text-sm font-medium">Name<input name="name" required defaultValue={p.name} className={inputClass} /></label>
            <label className="block text-sm font-medium">Description<textarea name="description" rows={2} defaultValue={p.description ?? ""} className={inputClass} /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Start date<input type="date" name="start_date" defaultValue={p.start_date ?? ""} className={inputClass} /></label>
              <label className="block text-sm font-medium">Target date<input type="date" name="target_date" defaultValue={p.target_date ?? ""} className={inputClass} /></label>
            </div>
            <label className="block text-sm font-medium">
              Status
              <select name="status" defaultValue={p.status} className={inputClass}>
                <option value="planning">Planning</option>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived (hidden from lists)</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Time zone
              <TimezoneSelect defaultValue={p.timezone} allowInherit={`Same as the organization (${access.org.timezone})`} />
            </label>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card title="“Due soon” window" action={<State approved={settings.dueSoonApproved} />}>
            <ActionForm action={updateProjectSetting} submit="Save" className="space-y-3">
              <ProjectFields />
              <input type="hidden" name="key" value="indicators" />
              <label className="block text-sm font-medium">
                Flag tasks as due soon
                <span className="mt-1 flex items-center gap-2">
                  <input name="due_soon_days" type="number" min={1} max={60} defaultValue={settings.dueSoonDays} required className={`${inputClass} mt-0 w-24`} />
                  <span className="text-sm font-normal text-ink-muted">days before the due date</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="approval_state" value="approved" defaultChecked={settings.dueSoonApproved} /> Approved</label>
            </ActionForm>
          </Card>
          <Card title="Credit for unverified work" action={<State approved={settings.unverifiedCreditApproved} />}>
            <ActionForm action={updateProjectSetting} submit="Save" className="space-y-3">
              <ProjectFields />
              <input type="hidden" name="key" value="progress" />
              <label className="block text-sm font-medium">
                Credit for work marked complete without the required evidence
                <span className="mt-1 flex items-center gap-2">
                  <input name="unverified_complete_credit" type="number" min={0} max={100} defaultValue={Math.round(settings.unverifiedCompleteCredit * 100)} required className={`${inputClass} mt-0 w-24`} />
                  <span className="text-sm font-normal text-ink-muted">%</span>
                </span>
                <span className="mt-1 block text-xs font-normal text-ink-muted">0% means it counts for nothing until evidence is attached. Used by the Pace Tracker (a later step).</span>
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="approval_state" value="approved" defaultChecked={settings.unverifiedCreditApproved} /> Approved</label>
            </ActionForm>
          </Card>
          <Card title="Scheduling rules">
            <p className="text-sm">Calendar days (weekends count). Due dates are inclusive: work is due by the end of that day. A task that waits on another can start the day after it finishes, plus any gap.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function State({ approved }: { approved: boolean }) {
  return approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Suggested</Badge>;
}
