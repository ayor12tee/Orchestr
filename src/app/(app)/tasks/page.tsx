import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { indicatorsFor, TaskBadges } from "@/components/task-badges";
import { Badge, EmptyState, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { forecastLate, loadSchedule } from "@/lib/schedule/data";
import { STATUSES, statusLabel, TASK_LIST_SELECT, type TaskListRow, type TaskStatus } from "@/lib/tasks/types";

export const metadata = { title: "Tasks · ConTech Command Centre" };

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
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; status?: string; flag?: string; mine?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const access = await getAccess();
  const settings = await getSettings();
  const supabase = await createClient();

  const { data: departments } = await supabase
    .from("departments")
    .select("id, name, slug")
    .eq("conference_id", access.conference.id)
    .order("sort_order");

  let query = supabase
    .from("tasks")
    .select(TASK_LIST_SELECT)
    .eq("conference_id", access.conference.id)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("title");
  const dept = departments?.find((d) => d.slug === sp.dept);
  if (dept) query = query.eq("department_id", dept.id);
  if (sp.status && STATUSES.some((s) => s.value === sp.status)) query = query.eq("status", sp.status as TaskStatus);
  if (sp.mine === "1") query = query.eq("accountable_owner_id", access.userId);
  if (sp.q) query = query.ilike("title", `%${sp.q.replace(/[%_]/g, "")}%`);

  const { data, error } = await query.returns<TaskListRow[]>();
  const flag = (sp.flag && sp.flag in FLAGS ? sp.flag : null) as Flag | null;
  const lateIds = flag === "forecast_late" ? new Set(forecastLate(await loadSchedule()).map((l) => l.task.id)) : null;
  const tasks = (data ?? []).filter((t) => {
    if (!flag) return true;
    if (flag === "unowned") return !t.accountable_owner_id && t.status !== "completed";
    if (flag === "critical") return t.is_critical && t.status !== "completed";
    if (lateIds) return lateIds.has(t.id);
    return indicatorsFor(t, settings.today, settings.dueSoonDays).some((i) => i.kind === flag);
  });

  const qs = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    const s = next.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };
  const canCreate = access.can("tasks.create") || [...access.departmentPermissions.values()].some((s) => s.has("tasks.create"));

  return (
    <>
      <RealtimeRefresh tables={["tasks"]} />
      <PageHeader
        title="Tasks"
        description={`${tasks.length} task${tasks.length === 1 ? "" : "s"}${flag ? ` · ${FLAGS[flag]}` : ""}. You see the tasks your role and departments allow.`}
        actions={canCreate && <Link href="/tasks/new" className={buttonClass}>New task</Link>}
      />

      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3" action="/tasks">
        <label className="text-xs font-medium text-ink-muted">
          Search
          <input name="q" defaultValue={sp.q} className={inputClass} placeholder="Task title" />
        </label>
        <label className="text-xs font-medium text-ink-muted">
          Department
          <select name="dept" defaultValue={sp.dept ?? ""} className={inputClass}>
            <option value="">All visible</option>
            {departments?.map((d) => <option key={d.id} value={d.slug}>{d.name}</option>)}
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
        {Object.values(sp).some(Boolean) && <Link href="/tasks" className="pb-2 text-sm text-brand hover:underline">Clear</Link>}
      </form>

      {error && <p role="alert" className="mb-4 text-sm text-status-red">Tasks couldn&apos;t be loaded: {error.message}</p>}

      {tasks.length === 0 ? (
        <EmptyState>
          No tasks match these filters.{" "}
          {canCreate && <Link href="/tasks/new" className="text-brand hover:underline">Create a task</Link>}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-surface-muted text-left text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tasks.map((t) => (
                <tr key={t.id} className="align-top hover:bg-surface-muted">
                  <td className="px-3 py-2">
                    <Link href={`/tasks/${t.id}`} className="font-medium text-ink hover:text-brand">{t.title}</Link>
                    <div className="mt-1"><TaskBadges task={t} today={settings.today} dueSoonDays={settings.dueSoonDays} /></div>
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {t.department ? <Link href={qs({ dept: t.department.slug })} className="hover:text-brand">{t.department.name}</Link> : "—"}
                  </td>
                  <td className="px-3 py-2">{t.owner ? t.owner.full_name ?? t.owner.email : <span className="text-ink-muted">Not set</span>}</td>
                  <td className="px-3 py-2 tabular-nums">{t.due_date ?? <span className="text-ink-muted">Not set</span>}</td>
                  <td className="px-3 py-2"><Badge tone={t.status === "completed" ? "green" : t.status === "blocked" ? "red" : "grey"}>{statusLabel(t.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
