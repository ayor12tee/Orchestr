import Link from "next/link";
import { getProjectAccess } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { getProjectSettings, getProjectTeams } from "@/lib/projects/data";
import { loadSchedule } from "@/lib/schedule/data";
import { STATUSES } from "@/lib/tasks/types";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { TaskBadges } from "@/components/task-badges";
import { PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export const metadata = { title: "Board · Orchestr" };

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { org, project } = await params;
  const { team } = await searchParams;
  const access = await getProjectAccess(org, project);
  const [schedule, settings, teams] = await Promise.all([loadSchedule(access), getProjectSettings(access), getProjectTeams(access)]);
  const base = access.projectBase;
  const current = teams.find((t) => t.id === team);
  const tasks = schedule.tasks.filter((t) => !current || t.team_id === current.id);
  const canCreate = current ? access.canInProject("tasks.create", current.id) : access.canAnywhere("tasks.create");

  return (
    <>
      <RealtimeRefresh tables={["tasks"]} filter={`project_id=eq.${access.project.id}`} />
      <PageHeader
        title={current ? current.label : "Board"}
        description={current ? "This team's tasks in the project, by status." : "Every task you can see, by status."}
        actions={canCreate && <Link href={`${base}/tasks/new${current ? `?team=${current.id}` : ""}`} className={buttonClass}>New task</Link>}
      />
      {teams.length > 0 && (
        <form className="mb-4 flex flex-wrap items-end gap-3" action={`${base}/board`}>
          <label className="text-xs font-medium text-ink-muted">
            Team
            <select name="team" defaultValue={current?.id ?? ""} className={inputClass}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <button className={secondaryButtonClass}>Show</button>
        </form>
      )}

      <section aria-label="Task board" className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
        {STATUSES.map((s) => {
          const col = tasks.filter((t) => t.status === s.value);
          return (
            <div key={s.value} className="rounded-lg border border-line bg-surface">
              <h2 className="flex justify-between border-b border-line px-3 py-2 text-xs font-semibold text-ink-muted">
                {s.label} <span className="tabular-nums">{col.length}</span>
              </h2>
              <ul className="space-y-2 p-2">
                {col.map((t) => (
                  <li key={t.id} className="rounded-md border border-line p-2.5 text-sm">
                    <Link href={`${base}/tasks/${t.id}`} className="font-medium hover:text-brand">{t.kind === "milestone" && "◆ "}{t.title}</Link>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {t.owner ? t.owner.full_name ?? t.owner.email : "No owner"} · {t.due_date ? formatDay(t.due_date) : "No due date"}
                      {!current && t.team && ` · ${t.team.name}`}
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
    </>
  );
}
