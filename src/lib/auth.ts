import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type OrgPermission =
  | "org.manage"
  | "members.manage"
  | "roles.manage"
  | "structure.manage"
  | "projects.create"
  | "projects.view_all"
  | "projects.manage_all"
  | "portfolios.manage"
  | "personal_data.view"
  | "audit.view";

export type ProjectPermission =
  | "project.view"
  | "project.manage"
  | "tasks.view"
  | "tasks.create"
  | "tasks.edit"
  | "tasks.assign"
  | "tasks.delete"
  | "dependencies.manage"
  | "baseline.approve"
  | "approvals.decide";

export interface Organization {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  unit_label: string;
}

export interface Project {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  status: "planning" | "active" | "on_hold" | "completed" | "archived";
  start_date: string | null;
  target_date: string | null;
  timezone: string | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
}

/** The signed-in user. Sends signed-out visitors to /login. */
export const getUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return { id: user.id, email: user.email ?? "", fullName: profile?.full_name ?? null };
});

/** Organizations the user is an active member of (RLS hides the rest). */
export const getMyOrganizations = cache(async (): Promise<Organization[]> => {
  const user = await getUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_members")
    .select("organizations(id, slug, name, timezone, unit_label)")
    .eq("user_id", user.id)
    .eq("status", "active");
  return (data ?? [])
    .map((r) => r.organizations as unknown as Organization | null)
    .filter((o): o is Organization => !!o)
    .sort((a, b) => a.name.localeCompare(b.name));
});

export interface OrgAccess {
  user: CurrentUser;
  org: Organization;
  permissions: Set<OrgPermission>;
  can: (p: OrgPermission) => boolean;
  /** Base path for links inside this organization. */
  base: string;
}

/**
 * What the user may do in an organization, resolved on the server from the
 * database. For UI decisions only: RLS and triggers enforce the real rules.
 * An organization the user doesn't belong to is reported as not found, so
 * its existence isn't revealed.
 */
export const getOrgAccess = cache(async (orgSlug: string): Promise<OrgAccess> => {
  const user = await getUser();
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, name, timezone, unit_label")
    .eq("slug", orgSlug)
    .maybeSingle<Organization>();
  if (!org) notFound();
  const { data: perms } = await supabase.rpc("my_org_permissions", { p_org: org.id });
  const permissions = new Set(((perms ?? []) as string[]).map((p) => p as OrgPermission));
  return { user, org, permissions, can: (p) => permissions.has(p), base: `/o/${org.slug}` };
});

export interface ProjectAccess extends OrgAccess {
  project: Project;
  /** Permissions from the project role or organization-wide roles. */
  projectPermissions: Set<ProjectPermission>;
  /** Permissions from team roles, by team id. They apply to that team's tasks. */
  teamPermissions: Map<string, Set<ProjectPermission>>;
  /** Project-wide, or for a task in `teamId` when given. */
  canInProject: (p: ProjectPermission, teamId?: string | null) => boolean;
  /** Granted project-wide or by any team role. */
  canAnywhere: (p: ProjectPermission) => boolean;
  /** IANA time zone used for "today" in this project. */
  timezone: string;
  projectBase: string;
}

export const getProjectAccess = cache(async (orgSlug: string, projectSlug: string): Promise<ProjectAccess> => {
  const orgAccess = await getOrgAccess(orgSlug);
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id, slug, name, description, status, start_date, target_date, timezone")
    .eq("organization_id", orgAccess.org.id)
    .eq("slug", projectSlug)
    .maybeSingle<Project>();
  if (!project) notFound();

  const { data: rows } = await supabase.rpc("my_project_permissions", { p_project: project.id });
  const projectPermissions = new Set<ProjectPermission>();
  const teamPermissions = new Map<string, Set<ProjectPermission>>();
  for (const row of (rows ?? []) as { permission: ProjectPermission; team_id: string | null }[]) {
    if (row.team_id === null) projectPermissions.add(row.permission);
    else {
      const set = teamPermissions.get(row.team_id) ?? new Set<ProjectPermission>();
      set.add(row.permission);
      teamPermissions.set(row.team_id, set);
    }
  }
  return {
    ...orgAccess,
    project,
    projectPermissions,
    teamPermissions,
    canInProject: (p, teamId) => projectPermissions.has(p) || (!!teamId && !!teamPermissions.get(teamId)?.has(p)),
    canAnywhere: (p) => projectPermissions.has(p) || [...teamPermissions.values()].some((s) => s.has(p)),
    timezone: project.timezone ?? orgAccess.org.timezone,
    projectBase: `${orgAccess.base}/p/${project.slug}`,
  };
});
