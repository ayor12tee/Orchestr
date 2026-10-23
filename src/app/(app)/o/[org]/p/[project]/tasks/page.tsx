import Link from "next/link";
import { getProjectAccess } from "@/lib/auth";
import { formatDay } from "@/lib/format";
import { getProjectSettings, getProjectTeams } from "@/lib/projects/data";
import { forecastLate, loadSchedule } from "@/lib/schedule/data";
import { STATUSES, statusLabel } from "@/lib/tasks/types";
import { indicatorsFor, TaskBadges } from "@/components/task-badges";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Badge, EmptyState, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

export const metadata = { title: "Tasks · Orchestr" };

const FLAGS = {
  overdue: "Overdue",
  due_soon: "Due soon",
  blocked: "Blocked",
  awaiting_review: "Awaiting review",
  planning_incomplete: "Planning incomplete",
  unowned: "No owner",
  critical: "Critical",
  forecast_late: "Forecast late",
} as const;
type Flag = keyof typeof FLAGS;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ team?: string; status?: string; flag?: string; mine?: string; q?: string }>;
}) {
  const { org, project } = await params;
  const sp = await searchParams;
  const access = await getProjectAccess(org, project);
  const [schedule, settings, teams] = await Promise.all([loadSchedule(access), getProjectSettings(access), getProjectTeams(access)]);
  const base = access.projectBase;

  const flag = (sp.flag && sp.flag in FLAGS ? sp.flag : null) as Flag | null;
  const lateIds = flag === "forecast_late" ? new Set(forecastLate(schedule).map((l) => l.task.id)) : null;
  const q = sp.q?.trim().toLowerCase();
  const tasks = schedule.tasks
    .filter((t) => !sp.team || (sp.team === "none" ? !t.team_id : t.team_id === sp.team))
    .filter((t) => !sp.status || t.status === sp.status)
    .filter((t) => sp.mine !== "1" || t.accountable_owner_id === access.user.id)
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .filter((t) => {
      if (!flag) return true;
      if (flag === "unowned") return !t.accountable_owner_id && t.status !== "completed";
      if (flag === "critical") return t.is_critical && t.status !== "completed";
      if (lateIds) return lateIds.has(t.id);
      return indicatorsFor(t, settings.today, settings.dueSoonDays).some((i) => i.kind === flag);
    })
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.title.localeCompare(b.title));

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = next.toString();
    return s ? `${base}/tasks?${s}` : `${base}/tasks`;
  };
  const canCreate = access.canAnywhere("tasks.create");

  return (
    <>
      <RealtimeRefresh tables={["tasks"]} filter={`project_id=eq.${access.project.id}`} />
      <PageHeader
        title="Tasks"
        description={`${tasks.length} task${tasks.length === 1 ? "" : "s"}${flag ? ` · ${FLAGS[flag]}` : ""}. You see the tasks your project and team roles allow, plus any you're involved in.`}
        actions={canCreate && <Link href={`${base}/tasks/new`} className={buttonClass}>New task</Link>}
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3" action={`${base}/tasks`}>
        <label className="text-xs font-medium text-ink-muted">
          Search
          <input name="q" defaultValue={sp.q} className={inputClass} placeholder="Task title" />
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Team
          <select name="team" defaultValue={sp.team ?? ""} className={inputClass}>
            <option value="">All visible</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value="none">No team</option>
          </select>
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Status
          <select name="status" defaultValue={sp.status ?? ""} className={inputClass}>
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Indicator
          <select name="flag" defaultValue={flag ?? ""} className={inputClass}>
            <option value="">Any</option>
            {Object.entries(FLAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink">
          <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> Owned by me
        </label>
        <button className={secondaryButtonClass}>Apply</button>
        {Object.values(sp).some(Boolean) && <Link href={`${base}/tasks`} className="pb-2 text-sm text-brand hover:underline">Clear</Link>}
      </form>

      {tasks.length === 0 ? (
        <EmptyState>
          {schedule.tasks.length ? "No tasks match these filters." : "No tasks yet."}{" "}
          {canCreate && <Link href={`${base}/tasks/new`} className="text-brand hover:underline">Create a task</Link>}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-surface-muted text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tasks.map((t) => {
                const lateBy = schedule.forecast.get(t.id)?.varianceToPlanDays ?? 0;
                return (
                  <tr key={t.id} className="align-top hover:bg-surface-muted">
                    <td className="px-3 py-2">
                      <Link href={`${base}/tasks/${t.id}`} className="font-medium text-ink hover:text-brand">{t.kind === "milestone" && "◆ "}{t.title}</Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <TaskBadges task={t} today={settings.today} dueSoonDays={settings.dueSoonDays} />
                        {t.status !== "completed" && lateBy > 0 && <Badge tone="red">Forecast {lateBy}d late</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {t.team ? <Link href={qs({ team: t.team.id })} className="hover:text-brand">{t.team.name}</Link> : "—"}
                    </td>
                    <td className="px-3 py-2">{t.owner ? t.owner.full_name ?? t.owner.email : <span className="text-ink-muted">Not set</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{t.due_date ? formatDay(t.due_date) : <span className="text-ink-muted">Not set</span>}</td>
                    <td className="px-3 py-2"><Badge tone={t.status === "completed" ? "green" : t.status === "blocked" ? "red" : "grey"}>{statusLabel(t.status)}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
