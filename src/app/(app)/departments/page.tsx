import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Departments · ConTech Command Centre" };

export default async function DepartmentsPage() {
  const access = await getAccess();
  const supabase = await createClient();
  const [{ data: departments }, { data: leads }] = await Promise.all([
    supabase.from("departments").select("id, slug, name, objective").eq("conference_id", access.conference.id).order("sort_order"),
    supabase
      .from("department_memberships")
      .select("department_id, profiles!department_memberships_user_id_fkey(full_name, email)")
      .eq("department_role", "lead")
      .eq("status", "active"),
  ]);
  const leadNames = (id: string) =>
    (leads ?? [])
      .filter((l) => l.department_id === id)
      .map((l) => {
        const p = l.profiles as unknown as { full_name: string | null; email: string };
        return p.full_name ?? p.email;
      });

  return (
    <>
      <PageHeader title="Departments" description="Workstreams from the initial planning baseline. Leads and objectives are set by leadership." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {departments?.map((d) => {
          const names = leadNames(d.id);
          return (
            <li key={d.id}>
              <Link href={`/departments/${d.slug}`} className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-brand">
                <span className="block font-semibold text-ink">{d.name}</span>
                <span className="mt-1 block text-sm text-ink-muted">Lead: {names.length ? names.join(", ") : "Not set"}</span>
                <span className="mt-1 block text-sm text-ink-muted">{d.objective ? d.objective : "Objective not set"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
