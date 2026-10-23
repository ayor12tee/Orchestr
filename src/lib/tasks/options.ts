import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Departments and people the current user can see, for pickers. */
export async function getPickerOptions() {
  const access = await getAccess();
  const supabase = await createClient();
  const [{ data: departments }, { data: members }] = await Promise.all([
    supabase.from("departments").select("id, name, slug").eq("conference_id", access.conference.id).order("sort_order"),
    supabase
      .from("conference_memberships")
      .select("user_id, profiles!conference_memberships_user_id_fkey(full_name, email)")
      .eq("conference_id", access.conference.id)
      .eq("status", "active"),
  ]);
  const people = new Map<string, string>();
  for (const m of members ?? []) {
    const p = m.profiles as unknown as { full_name: string | null; email: string } | null;
    if (p) people.set(m.user_id as string, p.full_name ?? p.email);
  }
  return {
    departments: (departments ?? []).map((d) => ({ id: d.id as string, label: d.name as string, slug: d.slug as string })),
    people: [...people].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}
