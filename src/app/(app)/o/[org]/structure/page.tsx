import { getOrgAccess } from "@/lib/auth";
import { deleteTeam, deleteUnit, saveTeam, saveUnit, setTeamMember } from "@/lib/org/actions";
import { getMembers, getRoles, getStructure, type TeamRow, type UnitRow } from "@/lib/org/data";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "Teams & structure · Orchestr" };

export default async function StructurePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  const [{ units, teams }, members, roles] = await Promise.all([getStructure(access), getMembers(access), getRoles(access)]);
  const canStructure = access.can("structure.manage");
  const canPeople = canStructure || access.can("members.manage");
  const unitLabel = access.org.unit_label;
  const teamRoles = roles.filter((r) => r.scope === "team");
  const orgField = <input type="hidden" name="org" value={access.org.slug} />;
  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.name ?? "Former member";
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Role";

  // Units as an indented tree.
  const tree: { unit: UnitRow; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const u of units.filter((x) => x.parent_id === parent)) {
      tree.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  const unitPath = (id: string | null): string => {
    const u = units.find((x) => x.id === id);
    return u ? (u.parent_id ? `${unitPath(u.parent_id)} › ${u.name}` : u.name) : "";
  };
  const unitOptions = tree.map(({ unit }) => ({ id: unit.id, label: unitPath(unit.id) }));
  const activeMembers = members.filter((m) => m.status === "active");

  const TeamCard = ({ team }: { team: TeamRow }) => (
    <Card key={team.id} title={team.name} action={team.org_unit_id ? <span className="text-xs text-ink-muted">{unitPath(team.org_unit_id)}</span> : undefined}>
      {team.description && <p className="mb-3 text-sm text-ink-muted">{team.description}</p>}
      {team.members.length ? (
        <ul className="divide-y divide-line text-sm">
          {team.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>{nameOf(m.user_id)}</span>
              {canPeople ? (
                <span className="flex items-center gap-2">
                  <ActionForm action={setTeamMember} submit="Save" secondary inline className="flex items-center gap-1">
                    {orgField}
                    <input type="hidden" name="team_id" value={team.id} />
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <input type="hidden" name="op" value="set" />
                    <select name="role_id" defaultValue={m.role_id} className={`${inputClass} mt-0 w-auto py-1 text-xs`} aria-label={`Team role for ${nameOf(m.user_id)}`}>
                      {teamRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </ActionForm>
                  <ActionForm action={setTeamMember} submit="Remove" secondary inline className="inline-flex" confirm={`Remove ${nameOf(m.user_id)} from ${team.name}?`}>
                    {orgField}
                    <input type="hidden" name="team_id" value={team.id} />
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <input type="hidden" name="op" value="remove" />
                  </ActionForm>
                </span>
              ) : (
                <span className="text-xs text-ink-muted">{roleName(m.role_id)}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No one in this team yet.</p>
      )}
      {canPeople && activeMembers.some((p) => !team.members.some((m) => m.user_id === p.user_id)) && (
        <ActionForm action={setTeamMember} submit="Add" secondary reset inline className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {orgField}
          <input type="hidden" name="team_id" value={team.id} />
          <input type="hidden" name="op" value="set" />
          <select name="user_id" required defaultValue="" className={`${inputClass} mt-0 w-auto`} aria-label="Person to add">
            <option value="" disabled>Add person…</option>
            {activeMembers.filter((p) => !team.members.some((m) => m.user_id === p.user_id)).map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
          </select>
          <select name="role_id" defaultValue={teamRoles.find((r) => r.system_key === "team_member")?.id} className={`${inputClass} mt-0 w-auto`} aria-label="Team role">
            {teamRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </ActionForm>
      )}
      {canStructure && (
        <details className="mt-3 border-t border-line pt-3 text-sm">
          <summary className="cursor-pointer text-xs text-brand">Edit team</summary>
          <ActionForm action={saveTeam} submit="Save team" className="mt-2 space-y-2">
            {orgField}
            <input type="hidden" name="id" value={team.id} />
            <label className="block text-xs font-medium text-ink-muted">Name<input name="name" required defaultValue={team.name} className={inputClass} /></label>
            <label className="block text-xs font-medium text-ink-muted">
              {unitLabel}
              <select name="org_unit_id" defaultValue={team.org_unit_id ?? ""} className={inputClass}>
                <option value="">None</option>
                {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-medium text-ink-muted">Description<input name="description" defaultValue={team.description ?? ""} className={inputClass} /></label>
          </ActionForm>
          <ActionForm action={deleteTeam} submit="Delete team" secondary className="mt-2" confirm={`Delete ${team.name}? Its tasks stay in their projects without a team.`}>
            {orgField}
            <input type="hidden" name="id" value={team.id} />
          </ActionForm>
        </details>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Teams & structure"
        description={`${unitLabel}s describe how your organization is arranged. Teams do the work: add a team to a project and its team roles apply to its tasks there.`}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">Teams</h2>
          {teams.length === 0 ? <EmptyState>No teams yet.{canStructure && " Add the first one on the right."}</EmptyState> : (
            <div className="grid gap-4 lg:grid-cols-2">{teams.map((t) => <TeamCard key={t.id} team={t} />)}</div>
          )}
        </div>

        <div className="space-y-6">
          {canStructure && (
            <Card title="Add a team">
              <ActionForm action={saveTeam} submit="Add team" reset className="space-y-2">
                {orgField}
                <label className="block text-sm font-medium">Name<input name="name" required placeholder="e.g. Sponsorship, Design, Finance" className={inputClass} /></label>
                <label className="block text-sm font-medium">
                  {unitLabel} <span className="font-normal text-ink-muted">(optional)</span>
                  <select name="org_unit_id" defaultValue="" className={inputClass}>
                    <option value="">None</option>
                    {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium">Description <span className="font-normal text-ink-muted">(optional)</span><input name="description" className={inputClass} /></label>
              </ActionForm>
            </Card>
          )}

          <Card title={`${unitLabel}s`}>
            {tree.length ? (
              <ul className="space-y-1 text-sm">
                {tree.map(({ unit, depth }) => (
                  <li key={unit.id} style={{ paddingLeft: depth * 16 }}>
                    {canStructure ? (
                      <details>
                        <summary className="cursor-pointer">{unit.name}</summary>
                        <ActionForm action={saveUnit} submit="Save" className="mt-2 space-y-2 rounded-md bg-surface-muted p-2">
                          {orgField}
                          <input type="hidden" name="id" value={unit.id} />
                          <input name="name" required defaultValue={unit.name} className={inputClass} aria-label="Name" />
                          <select name="parent_id" defaultValue={unit.parent_id ?? ""} className={inputClass} aria-label="Inside">
                            <option value="">Top level</option>
                            {unitOptions.filter((u) => u.id !== unit.id).map((u) => <option key={u.id} value={u.id}>Inside {u.label}</option>)}
                          </select>
                        </ActionForm>
                        <ActionForm action={deleteUnit} submit="Delete" secondary className="mt-1 pb-2" confirm={`Delete ${unit.name}?`}>
                          {orgField}
                          <input type="hidden" name="id" value={unit.id} />
                        </ActionForm>
                      </details>
                    ) : (
                      unit.name
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">None yet. They&apos;re optional.</p>
            )}
            {canStructure && (
              <ActionForm action={saveUnit} submit={`Add ${unitLabel.toLowerCase()}`} secondary reset className="mt-3 space-y-2 border-t border-line pt-3">
                {orgField}
                <input name="name" required placeholder="Name" className={inputClass} aria-label="Name" />
                <select name="parent_id" defaultValue="" className={inputClass} aria-label="Inside">
                  <option value="">Top level</option>
                  {unitOptions.map((u) => <option key={u.id} value={u.id}>Inside {u.label}</option>)}
                </select>
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
