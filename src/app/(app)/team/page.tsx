import { notFound } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPickerOptions } from "@/lib/tasks/options";
import { setDepartmentMembership, setMembershipStatus } from "@/lib/team/actions";
import { InviteForm } from "@/components/invite-form";
import { Badge, Card, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";

export const metadata = { title: "Team & Permissions · ConTech Command Centre" };

export default async function TeamPage() {
  const access = await getAccess();
  if (!access.can("members.manage")) notFound();
  const supabase = await createClient();
  const isLeadership = access.roles.some((r) => r.role_key === "ceo" || r.role_key === "coo");

  const [{ data: memberships }, { data: deptMemberships }, { data: roles }, options] = await Promise.all([
    supabase
      .from("conference_memberships")
      .select("id, user_id, role_key, label, status, profiles!conference_memberships_user_id_fkey(full_name, email)")
      .eq("conference_id", access.conference.id)
      .order("created_at"),
    supabase.from("department_memberships").select("user_id, department_id, department_role, status").eq("status", "active"),
    supabase.from("organisational_roles").select("key, title"),
    getPickerOptions(),
  ]);

  const people = new Map<string, { name: string; email: string; rows: NonNullable<typeof memberships> }>();
  for (const m of memberships ?? []) {
    const p = m.profiles as unknown as { full_name: string | null; email: string };
    const entry = people.get(m.user_id) ?? { name: p.full_name ?? p.email, email: p.email, rows: [] };
    entry.rows.push(m);
    people.set(m.user_id, entry);
  }
  const roleTitle = (k: string) => roles?.find((r) => r.key === k)?.title ?? k;
  const assignable = (roles ?? []).filter((r) => isLeadership || (r.key !== "ceo" && r.key !== "coo"));

  return (
    <>
      <PageHeader
        title="Team & Permissions"
        description="Access is by invitation. The CEO and COO share one permission profile. Revoking a role removes access on the person's next request."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <Card title={`People (${people.size})`}>
          <ul className="divide-y divide-line">
            {[...people].map(([userId, person]) => {
              const depts = (deptMemberships ?? []).filter((d) => d.user_id === userId);
              return (
                <li key={userId} className="py-3 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="font-medium">{person.name}</p>
                      <p className="text-xs text-ink-muted">{person.email}</p>
                    </div>
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {person.rows.map((m) => {
                      const leadershipRole = m.role_key === "ceo" || m.role_key === "coo";
                      return (
                        <li key={m.id} className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs">
                          <Badge tone={m.status === "active" ? "green" : "grey"}>{m.status}</Badge>
                          <span>{m.label ?? roleTitle(m.role_key)}</span>
                          {(!leadershipRole || isLeadership) && m.user_id !== access.userId && (
                            <form action={setMembershipStatus}>
                              <input type="hidden" name="id" value={m.id} />
                              <input type="hidden" name="status" value={m.status === "active" ? "revoked" : "active"} />
                              <button className="text-brand hover:underline">{m.status === "active" ? "Revoke" : "Restore"}</button>
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {depts.map((d) => (
                      <form key={d.department_id} action={setDepartmentMembership} className="flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1">
                        <input type="hidden" name="user_id" value={userId} />
                        <input type="hidden" name="department_id" value={d.department_id} />
                        <input type="hidden" name="op" value="revoke" />
                        <span>{options.departments.find((o) => o.id === d.department_id)?.label} ({d.department_role})</span>
                        <button aria-label="Remove from department" className="text-ink-muted hover:text-status-red">×</button>
                      </form>
                    ))}
                    <form action={setDepartmentMembership} className="flex items-center gap-1">
                      <input type="hidden" name="user_id" value={userId} />
                      <select name="department_id" required defaultValue="" className={`${inputClass} mt-0 py-1 text-xs`}>
                        <option value="" disabled>Add to department…</option>
                        {options.departments.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      <select name="op" defaultValue="member" className={`${inputClass} mt-0 py-1 text-xs`}>
                        <option value="member">Member</option>
                        <option value="lead">Lead</option>
                      </select>
                      <button className={`${secondaryButtonClass} py-1 text-xs`}>Add</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Invite someone">
          <InviteForm roles={assignable.map((r) => ({ key: r.key, title: r.title }))} departments={options.departments} />
        </Card>
      </div>
    </>
  );
}
