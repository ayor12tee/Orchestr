import Link from "next/link";
import { getProjectAccess } from "@/lib/auth";
import { getMembers, getRoles, getStructure } from "@/lib/org/data";
import { setProjectMember, setProjectTeam } from "@/lib/projects/actions";
import { getProjectTeams } from "@/lib/projects/data";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { ProjectFields } from "@/components/project-context";
import { Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "People & teams · Orchestr" };

export default async function ProjectPeoplePage({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const access = await getProjectAccess(org, project);
  const supabase = await createClient();
  const [{ data: projectMembers }, attached, members, roles, { teams }] = await Promise.all([
    supabase.from("project_members").select("user_id, role_id").eq("project_id", access.project.id),
    getProjectTeams(access),
    getMembers(access),
    getRoles(access),
    getStructure(access),
  ]);
  const canManage = access.canInProject("project.manage");
  const projectRoles = roles.filter((r) => r.scope === "project");
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Former member";
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Role";
  const inProject = new Set((projectMembers ?? []).map((m) => m.user_id as string));
  const candidates = members.filter((m) => m.status === "active" && !inProject.has(m.user_id));
  const attachedIds = new Set(attached.map((t) => t.id));

  return (
    <>
      <PageHeader
        title="People & teams"
        description="People get a project role here. Teams added to the project bring their members, whose team roles then apply to that team's tasks."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`People (${projectMembers?.length ?? 0})`}>
          {projectMembers?.length ? (
            <ul className="divide-y divide-line text-sm">
              {projectMembers.map((m) => (
                <li key={m.user_id as string} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{nameOf(m.user_id as string)}{m.user_id === access.user.id && <span className="ml-1 text-xs text-ink-muted">(you)</span>}</span>
                  {canManage ? (
                    <span className="flex items-center gap-2">
                      <ActionForm action={setProjectMember} submit="Save" secondary inline className="flex items-center gap-1">
                        <ProjectFields />
                        <input type="hidden" name="user_id" value={m.user_id as string} />
                        <input type="hidden" name="op" value="set" />
                        <select name="role_id" defaultValue={m.role_id as string} className={`${inputClass} mt-0 w-auto py-1 text-xs`} aria-label={`Project role for ${nameOf(m.user_id as string)}`}>
                          {projectRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </ActionForm>
                      <ActionForm action={setProjectMember} submit="Remove" secondary inline className="inline-flex" confirm={`Remove ${nameOf(m.user_id as string)} from this project?`}>
                        <ProjectFields />
                        <input type="hidden" name="user_id" value={m.user_id as string} />
                        <input type="hidden" name="op" value="remove" />
                      </ActionForm>
                    </span>
                  ) : (
                    <span className="text-xs text-ink-muted">{roleName(m.role_id as string)}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>No one has a project role yet.</EmptyState>
          )}
          {canManage && candidates.length > 0 && (
            <ActionForm action={setProjectMember} submit="Add to project" secondary reset inline className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <ProjectFields />
              <input type="hidden" name="op" value="set" />
              <select name="user_id" required defaultValue="" className={`${inputClass} mt-0 w-auto`} aria-label="Person">
                <option value="" disabled>Choose a person…</option>
                {candidates.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
              <select name="role_id" defaultValue={projectRoles.find((r) => r.system_key === "contributor")?.id} className={`${inputClass} mt-0 w-auto`} aria-label="Project role">
                {projectRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </ActionForm>
          )}
          {canManage && candidates.length === 0 && (
            <p className="mt-3 text-xs text-ink-muted">Everyone in the organization is already on this project. <Link href={`${access.base}/people`} className="text-brand hover:underline">Invite more people</Link>.</p>
          )}
        </Card>

        <Card title={`Teams (${attached.length})`}>
          {attached.length ? (
            <ul className="divide-y divide-line text-sm">
              {attached.map((t) => {
                const team = teams.find((x) => x.id === t.id);
                return (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <Link href={`${access.projectBase}/board?team=${t.id}`} className="font-medium hover:text-brand">{t.label}</Link>
                      <span className="ml-2 text-xs text-ink-muted">{team?.members.length ?? 0} member{team?.members.length === 1 ? "" : "s"}</span>
                    </span>
                    {canManage && (
                      <ActionForm action={setProjectTeam} submit="Remove" secondary inline className="inline-flex" confirm={`Remove ${t.label} from this project? Its tasks stay, without a team.`}>
                        <ProjectFields />
                        <input type="hidden" name="team_id" value={t.id} />
                        <input type="hidden" name="op" value="detach" />
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>No teams in this project yet.</EmptyState>
          )}
          {canManage && teams.some((t) => !attachedIds.has(t.id)) && (
            <ActionForm action={setProjectTeam} submit="Add team" secondary reset inline className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <ProjectFields />
              <input type="hidden" name="op" value="attach" />
              <select name="team_id" required defaultValue="" className={`${inputClass} mt-0 w-auto`} aria-label="Team">
                <option value="" disabled>Choose a team…</option>
                {teams.filter((t) => !attachedIds.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </ActionForm>
          )}
          {canManage && teams.length === 0 && (
            <p className="mt-3 text-xs text-ink-muted">Your organization has no teams yet. <Link href={`${access.base}/structure`} className="text-brand hover:underline">Create teams</Link>.</p>
          )}
        </Card>
      </div>
    </>
  );
}
