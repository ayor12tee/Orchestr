import { getOrgAccess } from "@/lib/auth";
import { inviteMember, setMemberRole, setMemberStatus } from "@/lib/org/actions";
import { getMembers, getRoles } from "@/lib/org/data";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "People · Orchestr" };

export default async function PeoplePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  const [members, roles] = await Promise.all([getMembers(access), getRoles(access)]);
  const orgRoles = roles.filter((r) => r.scope === "organization");
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const canManage = access.can("members.manage");
  const orgField = <input type="hidden" name="org" value={access.org.slug} />;
  const defaultRole = orgRoles.find((r) => r.system_key === "member")?.id ?? orgRoles[0]?.id;

  return (
    <>
      <PageHeader
        title="People"
        description="Organization roles decide what someone can do across the organization. Project and team roles are given on each project and team."
      />

      {canManage && (
        <Card title="Invite someone" className="mb-6">
          <ActionForm action={inviteMember} submit="Send invitation" pendingLabel="Sending…" reset className="grid gap-3 sm:grid-cols-2">
            {orgField}
            <label className="text-sm font-medium">Full name<input name="full_name" required className={inputClass} /></label>
            <label className="text-sm font-medium">Email<input name="email" type="email" required className={inputClass} /></label>
            <label className="text-sm font-medium">
              Job title <span className="font-normal text-ink-muted">(optional)</span>
              <input name="title" placeholder="e.g. COO, Volunteer Lead" className={inputClass} />
            </label>
            <label className="text-sm font-medium">
              Organization role
              <select name="role_id" defaultValue={defaultRole} className={inputClass}>
                {orgRoles.filter((r) => !r.is_owner).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-muted">New people get an email invitation. People who already use Orchestr are added straight away.</p>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-line bg-surface-muted text-left text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Organization roles</th>
              <th className="px-3 py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {members.map((m) => (
              <tr key={m.user_id} className="align-top">
                <td className="px-3 py-2.5">
                  <span className="font-medium">{m.name}</span>
                  {m.user_id === access.user.id && <span className="ml-1 text-xs text-ink-muted">(you)</span>}
                  <span className="block text-xs text-ink-muted">{m.email}{m.title && ` · ${m.title}`}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.roleIds.length === 0 && <span className="text-xs text-ink-muted">None</span>}
                    {m.roleIds.map((rid) => (
                      <span key={rid} className="inline-flex items-center gap-1">
                        <Badge tone={roles.find((r) => r.id === rid)?.is_owner ? "green" : "grey"}>{roleName.get(rid) ?? "Role"}</Badge>
                        {canManage && (
                          <ActionForm action={setMemberRole} submit="×" pendingLabel="…" secondary inline className="inline-flex" confirm={`Remove the ${roleName.get(rid)} role from ${m.name}?`}>
                            {orgField}
                            <input type="hidden" name="user_id" value={m.user_id} />
                            <input type="hidden" name="role_id" value={rid} />
                            <input type="hidden" name="op" value="remove" />
                          </ActionForm>
                        )}
                      </span>
                    ))}
                  </div>
                  {canManage && orgRoles.some((r) => !m.roleIds.includes(r.id)) && (
                    <ActionForm action={setMemberRole} submit="Give role" secondary inline className="mt-2 flex flex-wrap items-center gap-2">
                      {orgField}
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <input type="hidden" name="op" value="add" />
                      <select name="role_id" className={`${inputClass} mt-0 w-auto`} aria-label={`Role to give ${m.name}`}>
                        {orgRoles.filter((r) => !m.roleIds.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </ActionForm>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={m.status === "active" ? "green" : "red"}>{m.status === "active" ? "Active" : "Suspended"}</Badge>
                  {canManage && m.user_id !== access.user.id && (
                    <ActionForm
                      action={setMemberStatus}
                      submit={m.status === "active" ? "Suspend" : "Restore"}
                      secondary
                      inline
                      className="mt-2 flex items-center gap-2"
                      confirm={m.status === "active" ? `Suspend ${m.name}? They lose access to everything in ${access.org.name} immediately.` : undefined}
                    >
                      {orgField}
                      <input type="hidden" name="user_id" value={m.user_id} />
                      <input type="hidden" name="status" value={m.status === "active" ? "suspended" : "active"} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
