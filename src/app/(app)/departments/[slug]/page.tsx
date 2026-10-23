import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { STATUSES, TASK_LIST_SELECT, type TaskListRow } from "@/lib/tasks/types";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { TaskBadges } from "@/components/task-badges";
import { Card, EmptyState, PageHeader, buttonClass } from "@/components/ui";

export default async function DepartmentWorkspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const access = await getAccess();
  const settings = await getSettings();
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from("departments")
    .select("id, name, slug, objective")
    .eq("conference_id", access.conference.id)
    .eq("slug", slug)
    .maybeSingle();
  if (!dept) notFound();

  const [{ data: tasks }, { data: members }] = await Promise.all([
    supabase.from("tasks").select(TASK_LIST_SELECT).eq("department_id", dept.id).order("due_date", { nullsFirst: false }).returns<TaskListRow[]>(),
    supabase
      .from("department_memberships")
      .select("user_id, department_role, profiles!department_memberships_user_id_fkey(full_name, email)")
      .eq("department_id", dept.id)
      .eq("status", "active"),
  ]);
  const canCreate = access.can("tasks.create", dept.id);
  const canSeeTasks = access.can("tasks.view", dept.id);

  return (
    <>
      <RealtimeRefresh tables={["tasks"]} filter={`department_id=eq.${dept.id}`} />
      <p className="mb-2 text-sm"><Link href="/departments" className="text-brand hover:underline">← Departments</Link></p>
      <PageHeader
        title={dept.name}
        description={dept.objective ?? "Objective not set yet."}
        actions={canCreate && <Link href={`/tasks/new?dept=${dept.slug}`} className={buttonClass}>New task</Link>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <section aria-label="Task board" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {STATUSES.map((s) => {
            const col = (tasks ?? []).filter((t) => t.status === s.value);
            return (
              <div key={s.value} className="rounded-lg border border-line bg-surface">
                <h2 className="flex justify-between border-b border-line px-3 py-2 text-xs font-semibold text-ink-muted">
                  {s.label} <span className="tabular-nums">{col.length}</span>
                </h2>
                <ul className="space-y-2 p-2">
                  {col.map((t) => (
                    <li key={t.id} className="rounded-md border border-line p-2.5 text-sm">
                      <Link href={`/tasks/${t.id}`} className="font-medium hover:text-brand">{t.title}</Link>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {t.owner ? t.owner.full_name ?? t.owner.email : "No owner"} · {t.due_date ?? "No due date"}
                      </p>
                      <div className="mt-1.5"><TaskBadges task={t} today={settings.today} dueSoonDays={settings.dueSoonDays} /></div>
                    </li>
                  ))}
                  {col.length === 0 && <li className="px-1 py-2 text-xs text-ink-muted">None</li>}
                </ul>
              </div>
            );
          })}
        </section>

        <div className="space-y-6">
          <Card title="Team">
            {members?.length ? (
              <ul className="space-y-1 text-sm">
                {members.map((m) => {
                  const p = m.profiles as unknown as { full_name: string | null; email: string };
                  return (
                    <li key={m.user_id} className="flex justify-between gap-2">
                      <span>{p.full_name ?? p.email}</span>
                      <span className="text-xs text-ink-muted">{m.department_role === "lead" ? "Lead" : "Member"}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState>No one assigned yet.{access.can("members.manage") && <> <Link href="/team" className="text-brand hover:underline">Add people</Link></>}</EmptyState>
            )}
          </Card>
          {!canSeeTasks && (
            <p className="text-xs text-ink-muted">You only see this department&apos;s tasks that you&apos;re personally involved in.</p>
          )}
        </div>
      </div>
    </>
  );
}
