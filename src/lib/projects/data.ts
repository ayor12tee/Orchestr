import { cache } from "react";
import type { ProjectAccess } from "@/lib/auth";
import { todayIn } from "@/lib/domain/dates";
import { createClient } from "@/lib/supabase/server";

export interface ProjectSettings {
  dueSoonDays: number;
  dueSoonApproved: boolean;
  unverifiedCompleteCredit: number;
  unverifiedCreditApproved: boolean;
  /** Today in the project's time zone. */
  today: string;
}

export const getProjectSettings = cache(async (access: ProjectAccess): Promise<ProjectSettings> => {
  const supabase = await createClient();
  const { data } = await supabase.from("project_settings").select("key, value, approval_state").eq("project_id", access.project.id);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r]));
  const indicators = byKey.get("indicators");
  const progress = byKey.get("progress");
  return {
    dueSoonDays: Number(indicators?.value?.due_soon_days ?? 7),
    dueSoonApproved: indicators?.approval_state === "approved",
    unverifiedCompleteCredit: Number(progress?.value?.unverified_complete_credit ?? 0),
    unverifiedCreditApproved: progress?.approval_state === "approved",
    today: todayIn(access.timezone),
  };
});

export interface Option {
  id: string;
  label: string;
}

/** Teams attached to the project. */
export const getProjectTeams = cache(async (access: ProjectAccess): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("project_teams").select("team_id, teams(name)").eq("project_id", access.project.id);
  return (data ?? [])
    .map((r) => ({ id: r.team_id as string, label: (r.teams as unknown as { name: string } | null)?.name ?? "Team" }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

/**
 * People who can be given work in this project: its members and the members
 * of its teams. Owners outside this set wouldn't be able to see the task.
 */
export const getProjectPeople = cache(async (access: ProjectAccess): Promise<Option[]> => {
  const supabase = await createClient();
  const teams = await getProjectTeams(access);
  const [{ data: members }, { data: teamMembers }] = await Promise.all([
    supabase.from("project_members").select("user_id, profiles!project_members_user_id_fkey(full_name, email)").eq("project_id", access.project.id),
    teams.length
      ? supabase.from("team_members").select("user_id, profiles!team_members_user_id_fkey(full_name, email)").in("team_id", teams.map((t) => t.id))
      : Promise.resolve({ data: [] as { user_id: string; profiles: unknown }[] }),
  ]);
  const people = new Map<string, string>();
  for (const m of [...(members ?? []), ...(teamMembers ?? [])]) {
    const p = m.profiles as { full_name: string | null; email: string } | null;
    if (p) people.set(m.user_id as string, p.full_name ?? p.email);
  }
  return [...people].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
});
