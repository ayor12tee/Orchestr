import Link from "next/link";
import { getProjectAccess } from "@/lib/auth";
import { daysUntil } from "@/lib/domain/dates";
import { taskIndicators } from "@/lib/domain/indicators";
import { describeActivity, type ActivityRow } from "@/lib/activity";
import { formatDate } from "@/lib/format";
import { getMembers } from "@/lib/org/data";
import { getProjectSettings, getProjectTeams } from "@/lib/projects/data";
import { forecastLate, loadSchedule } from "@/lib/schedule/data";
import { createClient } from "@/lib/supabase/server";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { TaskBadges } from "@/components/task-badges";
import { Card, EmptyState, Metric, PageHeader, buttonClass } from "@/components/ui";

export const metadata = { title: "Project overview · Orchestr" };

export default async function ProjectOverview({ params }: { params: Promise<{ org: string; project: string }> }) {
  const { org, project } = await params;
  const access = await getProjectAccess(org, project);
  const supabase = await createClient();
  const [schedule, settings, teams, members, { data: activity }] = await Promise.all([
    loadSchedule(access),
    getProjectSettings(access),
    getProjectTeams(access),
    getMembers(access),
    supabase.from("activity_events").select("*").eq("project_id", access.project.id).order("created_at", { ascending: false }).limit(12).returns<ActivityRow[]>(),
  ]);
  const base = access.projectBase;
  const p = access.project;
  const tasks = schedule.tasks;
  const today = settings.today;
  const countdown = p.target_date ? daysUntil(p.target_date, today) : null;

  const withInd = tasks.map((t) => ({ t, ind: taskIndicators(t, today, { dueSoonDays: settings.dueSoonDays }) }));
  const has = (kind: string) => withInd.filter((x) => x.ind.some((i) => i.kind === kind));
  const overdue = has("overdue");
  const criticalOverdue = overdue.filter((x) => x.t.is_critical);
  const blocked = has("blocked");
  const dueSoon = has("due_soon");
  const review = has("awaiting_review");
  const active = tasks.filter((t) => t.status !== "completed");
  const unowned = active.filter((t) => !t.accountable_owner_id);
  const incomplete = has("planning_incomplete");
  const late = forecastLate(schedule);

  // Attention list, built only from stored facts and forecasts. Each item links to its record.
  const attention = [
    ...criticalOverdue.map((x) => ({ t: x.t, why: "Critical task is overdue" })),
    ...blocked.map((x) => ({ t: x.t, why: `Blocked: ${x.t.blocker_details ?? "no reason recorded"}` })),
    ...late.filter((l) => l.task.is_critical || l.task.kind === "milestone").map((l) => ({
      t: l.task,
      why: `Forecast to finish ${l.days} day${l.days === 1 ? "" : "s"} late${l.drivenBy ? `, pushed out by "${schedule.titleOf(l.drivenBy)}"` : ""}`,
    })),
    ...active.filter((t) => t.is_critical && !t.accountable_owner_id).map((t) => ({ t, why: "Critical task has no accountable owner" })),
    ...overdue.filter((x) => !x.t.is_critical).map((x) => ({ t: x.t, why: "Overdue" })),
  ].filter((v, i, arr) => arr.findIndex((o) => o.t.id === v.t.id) === i).slice(0, 8);

  const byTeam = [...teams, { id: "", label: "No team" }].map((team) => {
    const tt = withInd.filter((x) => (x.t.team_id ?? "") === team.id);
    return {
      ...team,
      total: tt.length,
      done: tt.filter((x) => x.t.status === "completed").length,
      overdue: tt.filter((x) => x.ind.some((i) => i.kind === "overdue")).length,
      blocked: tt.filter((x) => x.t.status === "blocked").length,
      late: late.filter((l) => (l.task.team_id ?? "") === team.id).length,
    };
  }).filter((t) => t.total > 0);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? "Someone" : "System");
  const canCreate = access.canAnywhere("tasks.create");

  return (
    <>
      <RealtimeRefresh tables={["tasks", "activity_events", "task_dependencies"]} filter={`project_id=eq.${p.id}`} />
      <PageHeader
        title="Overview"
        description={p.description ?? undefined}
        actions={canCreate && <Link href={`${base}/tasks/new`} className={buttonClass}>New task</Link>}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        <div className="col-span-2 rounded-lg bg-brand p-4 text-white sm:col-span-1">
          <span className="block text-xs font-medium text-white/80">Target date</span>
          {p.target_date ? (
            <>
              <span className="mt-1 block text-3xl font-semibold tabular-nums">{countdown! > 0 ? countdown : countdown === 0 ? "Today" : "Passed"}</span>
              <span className="block text-xs text-white/80">{countdown! > 0 ? "days to go · " : ""}{formatDate(p.target_date)}</span>
            </>
          ) : (
            <span className="mt-1 block text-sm">Not set</span>
          )}
        </div>
        <Metric label="Overdue" value={overdue.length} tone={overdue.length ? "red" : "green"} href={`${base}/tasks?flag=overdue`} hint={criticalOverdue.length ? `${criticalOverdue.length} critical` : undefined} />
        <Metric label="Blocked" value={blocked.length} tone={blocked.length ? "red" : "green"} href={`${base}/tasks?flag=blocked`} />
        <Metric label="Forecast late" value={late.length} tone={late.length ? "red" : "green"} href={`${base}/tasks?flag=forecast_late`} hint="Includes knock-on delays" />
        <Metric label={`Due in ${settings.dueSoonDays} days`} value={dueSoon.length} tone={dueSoon.length ? "amber" : undefined} href={`${base}/tasks?flag=due_soon`} hint={settings.dueSoonApproved ? undefined : "Window is a suggested default"} />
        <Metric label="Awaiting review" value={review.length} tone={review.length ? "amber" : undefined} href={`${base}/tasks?flag=awaiting_review`} />
        <Metric label="Active without owner" value={unowned.length} tone={unowned.length ? "amber" : "green"} href={`${base}/tasks?flag=unowned`} />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title="Needs attention now">
            {attention.length ? (
              <ul className="divide-y divide-line">
                {attention.map(({ t, why }) => (
                  <li key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link href={`${base}/tasks/${t.id}`} className="font-medium text-ink hover:text-brand">{t.kind === "milestone" && "◆ "}{t.title}</Link>
                    <p className="text-sm text-ink-muted">{why} · Owner: {t.owner ? t.owner.full_name ?? t.owner.email : "not set"}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>{tasks.length ? "Nothing overdue, blocked or forecast late in the tasks you can see." : "No tasks yet."}</EmptyState>
            )}
          </Card>

          {byTeam.length > 0 && (
            <Card title="By team" action={<Link href={`${base}/board`} className="text-xs text-brand hover:underline">Board</Link>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-xs text-ink-muted">
                    <tr><th className="py-1 font-medium">Team</th><th className="font-medium">Done</th><th className="font-medium">Overdue</th><th className="font-medium">Blocked</th><th className="font-medium">Forecast late</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {byTeam.map((t) => (
                      <tr key={t.id || "none"}>
                        <td className="py-1.5">{t.id ? <Link href={`${base}/board?team=${t.id}`} className="hover:text-brand">{t.label}</Link> : <span className="text-ink-muted">{t.label}</span>}</td>
                        <td className="tabular-nums">{t.done}/{t.total}</td>
                        <td className={`tabular-nums ${t.overdue ? "font-semibold text-status-red" : ""}`}>{t.overdue}</td>
                        <td className={`tabular-nums ${t.blocked ? "font-semibold text-status-red" : ""}`}>{t.blocked}</td>
                        <td className={`tabular-nums ${t.late ? "font-semibold text-status-red" : ""}`}>{t.late}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Due soon">
            {dueSoon.length ? (
              <ul className="space-y-2">
                {dueSoon.sort((a, b) => (a.t.due_date ?? "").localeCompare(b.t.due_date ?? "")).slice(0, 8).map(({ t }) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link href={`${base}/tasks/${t.id}`} className="hover:text-brand">{t.title}</Link>
                    <TaskBadges task={t} today={today} dueSoonDays={settings.dueSoonDays} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No tasks due in the next {settings.dueSoonDays} days{incomplete.length ? `, but ${incomplete.length} tasks have no due date yet` : ""}.</EmptyState>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Planning completeness">
            <dl className="space-y-2 text-sm">
              <Row label="Tasks visible to you" value={tasks.length} />
              <Row label="Completed" value={tasks.length - active.length} />
              <Row label="Missing owner, due date or criteria" value={incomplete.length} href={`${base}/tasks?flag=planning_incomplete`} />
              <Row label="Can't be forecast yet" value={active.filter((t) => schedule.forecast.get(t.id)?.state === "unknown").length} />
              <Row label="Still suggested (not approved)" value={tasks.filter((t) => t.planning_state === "suggested").length} />
            </dl>
            <p className="mt-3 text-xs text-ink-muted">
              Overall progress isn&apos;t shown yet: it needs approved deliverable weights (Pace Tracker, a later step). Counting completed tasks would overstate readiness.
            </p>
          </Card>

          <Card title="Recent activity">
            {activity?.length ? (
              <ol className="space-y-2.5 text-sm">
                {activity.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{nameOf(a.actor_id)}</span> {describeActivity(a)}{" "}
                    {a.task_id ? <Link href={`${base}/tasks/${a.task_id}`} className="text-brand hover:underline">{String(a.detail.title ?? "a task")}</Link> : String(a.detail.title ?? "")}
                    <span className="block text-xs text-ink-muted">{new Date(a.created_at).toLocaleString("en-GB", { timeZone: access.timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState>No activity yet.</EmptyState>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, href }: { label: string; value: number; href?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{href && value ? <Link href={href} className="text-brand hover:underline">{value}</Link> : value}</dd>
    </div>
  );
}
