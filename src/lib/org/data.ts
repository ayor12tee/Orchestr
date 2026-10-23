import { cache } from "react";
import type { OrgAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface RoleRow {
  id: string;
  scope: "organization" | "project" | "team";
  name: string;
  description: string | null;
  system_key: string | null;
  is_owner: boolean;
  permissions: string[];
}

export const getRoles = cache(async (access: OrgAccess): Promise<RoleRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("roles")
    .select("id, scope, name, description, system_key, is_owner, role_permissions(permission)")
    .eq("organization_id", access.org.id)
    .order("name");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    scope: r.scope as RoleRow["scope"],
    name: r.name as string,
    description: r.description as string | null,
    system_key: r.system_key as string | null,
    is_owner: r.is_owner as boolean,
    permissions: ((r.role_permissions as { permission: string }[] | null) ?? []).map((p) => p.permission),
  }));
});

export interface MemberRow {
  user_id: string;
  name: string;
  email: string;
  title: string | null;
  status: "active" | "suspended";
  roleIds: string[];
}

export const getMembers = cache(async (access: OrgAccess): Promise<MemberRow[]> => {
  const supabase = await createClient();
  const [{ data: members }, { data: memberRoles }] = await Promise.all([
    supabase
      .from("org_members")
      .select("user_id, title, status, profiles!org_members_user_id_fkey(full_name, email)")
      .eq("organization_id", access.org.id),
    supabase.from("org_member_roles").select("user_id, role_id").eq("organization_id", access.org.id),
  ]);
  return (members ?? [])
    .map((m) => {
      const p = m.profiles as unknown as { full_name: string | null; email: string } | null;
      return {
        user_id: m.user_id as string,
        name: p?.full_name ?? p?.email ?? "Unknown",
        email: p?.email ?? "",
        title: m.title as string | null,
        status: m.status as MemberRow["status"],
        roleIds: (memberRoles ?? []).filter((r) => r.user_id === m.user_id).map((r) => r.role_id as string),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});

export interface PermissionRow {
  key: string;
  scope: "organization" | "project";
  description: string;
}

export const getPermissionCatalogue = cache(async (): Promise<PermissionRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("permissions").select("key, scope, description").order("sort_order");
  return (data ?? []) as PermissionRow[];
});

export interface UnitRow {
  id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
}

export interface TeamRow {
  id: string;
  org_unit_id: string | null;
  name: string;
  description: string | null;
  members: { user_id: string; role_id: string }[];
}

export const getStructure = cache(async (access: OrgAccess): Promise<{ units: UnitRow[]; teams: TeamRow[] }> => {
  const supabase = await createClient();
  const [{ data: units }, { data: teams }, { data: teamMembers }] = await Promise.all([
    supabase.from("org_units").select("id, parent_id, name, description").eq("organization_id", access.org.id).order("sort_order").order("name"),
    supabase.from("teams").select("id, org_unit_id, name, description").eq("organization_id", access.org.id).order("name"),
    supabase.from("team_members").select("team_id, user_id, role_id").eq("organization_id", access.org.id),
  ]);
  return {
    units: (units ?? []) as UnitRow[],
    teams: (teams ?? []).map((t) => ({
      ...(t as Omit<TeamRow, "members">),
      members: (teamMembers ?? []).filter((m) => m.team_id === t.id).map((m) => ({ user_id: m.user_id as string, role_id: m.role_id as string })),
    })),
  };
});
