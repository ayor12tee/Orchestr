import { redirect } from "next/navigation";
import { getOrgAccess } from "@/lib/auth";
import { deleteRole, saveRole, setRolePermissions } from "@/lib/org/actions";
import { getPermissionCatalogue, getRoles, type RoleRow } from "@/lib/org/data";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";

export const metadata = { title: "Roles & permissions · Orchestr" };

const SCOPES = [
  { key: "organization", title: "Organization roles", help: "Given to people in the organization. They apply everywhere in it." },
  { key: "project", title: "Project roles", help: "Given to a person on a specific project. Someone can hold different project roles on different projects." },
  { key: "team", title: "Team roles", help: "Given inside a team. They apply to that team's tasks in every project the team is part of." },
] as const;

export default async function RolesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  if (!access.can("roles.manage") && !access.can("members.manage")) redirect(access.base);
  const [roles, catalogue] = await Promise.all([getRoles(access), getPermissionCatalogue()]);
  const canEdit = access.can("roles.manage");
  const orgField = <input type="hidden" name="org" value={access.org.slug} />;

  const RoleCard = ({ role }: { role: RoleRow }) => {
    const perms = catalogue.filter((p) => p.scope === (role.scope === "organization" ? "organization" : "project"));
    // You can only add organization permissions you hold yourself; the database enforces this too.
    const grantable = (key: string) => role.scope !== "organization" || access.permissions.has(key as never);
    return (
      <Card title={<span className="flex items-center gap-2">{role.name}{role.is_owner && <Badge tone="green">Built-in</Badge>}</span>}>
        {role.description && <p className="mb-3 text-sm text-ink-muted">{role.description}</p>}
        {canEdit && !role.is_owner ? (
          <ActionForm action={setRolePermissions} submit="Save permissions" secondary className="space-y-1.5">
            {orgField}
            <input type="hidden" name="role_id" value={role.id} />
            {perms.map((p) => (
              <label key={p.key} className={`flex items-start gap-2 text-sm ${grantable(p.key) || role.permissions.includes(p.key) ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  name="permission"
                  value={p.key}
                  defaultChecked={role.permissions.includes(p.key)}
                  disabled={!grantable(p.key) && !role.permissions.includes(p.key)}
                  className="mt-0.5"
                />
                <span>{p.description}</span>
              </label>
            ))}
          </ActionForm>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {role.is_owner ? <li>Every organization permission, always</li> : null}
            {!role.is_owner && perms.filter((p) => role.permissions.includes(p.key)).map((p) => <li key={p.key}>{p.description}</li>)}
            {!role.is_owner && role.permissions.length === 0 && <li className="text-ink-muted">No permissions beyond membership</li>}
          </ul>
        )}
        {canEdit && (
          <details className="mt-3 border-t border-line pt-3 text-sm">
            <summary className="cursor-pointer text-xs text-brand">Rename or delete</summary>
            <ActionForm action={saveRole} submit="Save" className="mt-2 space-y-2">
              {orgField}
              <input type="hidden" name="id" value={role.id} />
              <label className="block text-xs font-medium text-ink-muted">Name<input name="name" required defaultValue={role.name} className={inputClass} /></label>
              <label className="block text-xs font-medium text-ink-muted">Description<input name="description" defaultValue={role.description ?? ""} className={inputClass} /></label>
            </ActionForm>
            {!role.is_owner && (
              <ActionForm action={deleteRole} submit="Delete role" secondary className="mt-2" confirm={`Delete the ${role.name} role?`}>
                {orgField}
                <input type="hidden" name="id" value={role.id} />
              </ActionForm>
            )}
          </details>
        )}
      </Card>
    );
  };

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description={canEdit ? "Every role is yours to edit. Changes apply immediately to everyone who holds the role." : "Read-only: you need the roles permission to change these."}
      />
      <div className="space-y-8">
        {SCOPES.map((s) => (
          <section key={s.key}>
            <h2 className="text-base font-semibold text-ink">{s.title}</h2>
            <p className="mb-3 text-sm text-ink-muted">{s.help}</p>
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {roles.filter((r) => r.scope === s.key).map((r) => <RoleCard key={r.id} role={r} />)}
            </div>
          </section>
        ))}
        {canEdit && (
          <Card title="Create a role" className="max-w-xl">
            <ActionForm action={saveRole} submit="Create role" reset className="space-y-2">
              {orgField}
              <label className="block text-sm font-medium">Name<input name="name" required placeholder="e.g. Finance reviewer" className={inputClass} /></label>
              <label className="block text-sm font-medium">
                Applies to
                <select name="scope" defaultValue="project" className={inputClass}>
                  <option value="organization">The whole organization</option>
                  <option value="project">A project</option>
                  <option value="team">A team</option>
                </select>
              </label>
              <label className="block text-sm font-medium">Description <span className="font-normal text-ink-muted">(optional)</span><input name="description" className={inputClass} /></label>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
