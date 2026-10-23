import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Permission =
  | "conference.view"
  | "conference.view_all"
  | "conference.manage"
  | "members.manage"
  | "departments.manage"
  | "tasks.view"
  | "tasks.create"
  | "tasks.edit"
  | "tasks.assign"
  | "tasks.delete"
  | "dependencies.manage"
  | "baseline.approve"
  | "approvals.decide"
  | "pace.view"
  | "reports.view"
  | "finance.view"
  | "finance.manage"
  | "commercial.view"
  | "personal_data.view"
  | "volunteers.manage"
  | "audit.view"
  | "system.configure";

export interface Conference {
  id: string;
  slug: string;
  name: string;
  event_date: string;
  venue: string | null;
  theme: string | null;
}

export interface AccessContext {
  userId: string;
  email: string;
  fullName: string | null;
  conference: Conference;
  roles: { role_key: string; title: string; label: string | null }[];
  /** Conference-wide permissions. */
  permissions: Set<Permission>;
  /** Department-scoped permissions, keyed by department id. */
  departmentPermissions: Map<string, Set<Permission>>;
  can: (p: Permission, departmentId?: string | null) => boolean;
}

/**
 * Resolves who the user is and what they may do, on the server, from the
 * database (brief §4.5). Use it for UI decisions only. RLS and the triggers
 * enforce the real rules, so a hidden button is never the only protection.
 */
export const getAccess = cache(async (): Promise<AccessContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const slug = process.env.CONFERENCE_SLUG ?? "contech-nigeria-2026";
  const { data: conference } = await supabase
    .from("conferences")
    .select("id, slug, name, event_date, venue, theme")
    .eq("slug", slug)
    .maybeSingle<Conference>();
  // RLS hides the conference from anyone without an active membership.
  if (!conference) redirect("/no-access");

  const [{ data: perms }, { data: roles }, { data: profile }] = await Promise.all([
    supabase.rpc("my_permissions", { p_conference: conference.id }),
    supabase
      .from("conference_memberships")
      .select("role_key, label, organisational_roles(title)")
      .eq("conference_id", conference.id)
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  const permissions = new Set<Permission>();
  const departmentPermissions = new Map<string, Set<Permission>>();
  for (const row of (perms ?? []) as { permission: Permission; department_id: string | null }[]) {
    if (row.department_id === null) permissions.add(row.permission);
    else {
      const set = departmentPermissions.get(row.department_id) ?? new Set<Permission>();
      set.add(row.permission);
      departmentPermissions.set(row.department_id, set);
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    conference,
    roles: (roles ?? []).map((r) => ({
      role_key: r.role_key as string,
      label: r.label as string | null,
      title: (r.organisational_roles as unknown as { title: string } | null)?.title ?? r.role_key,
    })),
    permissions,
    departmentPermissions,
    can: (p, departmentId) =>
      permissions.has(p) || (!!departmentId && !!departmentPermissions.get(departmentId)?.has(p)),
  };
});
