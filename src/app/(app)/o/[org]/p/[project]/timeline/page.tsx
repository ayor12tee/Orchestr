import Link from "next/link";
import { getProjectAccess } from "@/lib/auth";
import { addDays, diffDays, type IsoDate } from "@/lib/domain/dates";
import { formatDay } from "@/lib/format";
import { getProjectTeams } from "@/lib/projects/data";
import { loadSchedule, type ScheduleData } from "@/lib/schedule/data";
import type { TaskListRow } from "@/lib/tasks/types";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { EmptyState, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";

export const metadata = { title: "Timeline · Orchestr" };

const DAY = 26; // px per calendar day

export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ team?: string; late?: string }>;
}) {
  const { org, project } = await params;
  const sp = await searchParams;
  const access = await getProjectAccess(org, project);
  const [schedule, teams] = await Promise.all([loadSchedule(access), getProjectTeams(access)]);
  const { today, forecast } = schedule;
  const target = access.project.target_date;
  const base = access.projectBase;

  /** Planned span: start..due, or due minus duration, or just the due day. */
  const planned = (t: TaskListRow): [IsoDate, IsoDate] | null => {
    if (!t.due_date) return null;
    if (t.kind === "milestone") return [t.due_date, t.due_date];
    if (t.start_date) return [t.start_date, t.due_date];
    if (t.duration_days) return [addDays(t.due_date, 1 - t.duration_days), t.due_date];
    return [t.due_date, t.due_date];
  };
  const isLate = (t: TaskListRow) => t.status !== "completed" && (forecast.get(t.id)?.varianceToPlanDays ?? 0) > 0;

  const team = teams.find((t) => t.id === sp.team);
  const inScope = schedule.tasks.filter((t) => !team || t.team_id === team.id);
  const dated = inScope.filter((t) => planned(t) || forecast.get(t.id)?.forecastFinish);
  const rows = dated.filter((t) => sp.late !== "1" || isLate(t));
  const undated = inScope.length - dated.length;

  // Visible range: a few days either side of everything shown, always including today and the target date.
  const dates = rows.flatMap((t) => {
    const f = forecast.get(t.id);
    return [...(planned(t) ?? []), f?.forecastStart, f?.forecastFinish, t.baseline_finish].filter((d): d is string => !!d);
  });
  const rangeStart = addDays([today, ...dates].reduce((a, b) => (a < b ? a : b)), -3);
  const rangeEnd = addDays([target ?? today, today, ...dates].reduce((a, b) => (a > b ? a : b)), 3);
  const days = diffDays(rangeStart, rangeEnd) + 1;
  const x = (d: IsoDate) => diffDays(rangeStart, d) * DAY;
  const span = (a: IsoDate, b: IsoDate) => ({ left: x(a), width: (diffDays(a, b) + 1) * DAY });

  const groups = [
    ...teams.map((t) => ({ key: t.id, name: t.label, items: rows.filter((r) => r.team_id === t.id) })),
    { key: "none", name: "No team", items: rows.filter((r) => !r.team_id) },
  ]
    .filter((g) => g.items.length)
    .map((g) => ({ ...g, items: g.items.sort((a, b) => sortKey(a, forecast).localeCompare(sortKey(b, forecast))) }));

  const dayList = Array.from({ length: days }, (_, i) => addDays(rangeStart, i));

  return (
    <>
      <RealtimeRefresh tables={["tasks", "task_dependencies"]} filter={`project_id=eq.${access.project.id}`} />
      <PageHeader
        title="Timeline"
        description={`Planned dates against the forecast${target ? ", up to the target date" : ""}. Forecasts follow dependencies and recalculate as work moves.`}
      />

      <form className="mb-4 flex flex-wrap items-end gap-3" action={`${base}/timeline`}>
        <label className="text-sm">
          <span className="text-xs font-medium text-ink-muted">Team</span>
          <select name="team" defaultValue={sp.team ?? ""} className={inputClass}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="late" value="1" defaultChecked={sp.late === "1"} /> Only forecast late
        </label>
        <button className={secondaryButtonClass}>Apply</button>
      </form>

      <Legend hasTarget={!!target} />

      {rows.length === 0 ? (
        <EmptyState>
          {sp.late === "1" && dated.length
            ? "Nothing here is forecast to finish late."
            : "No tasks have dates yet. Add due dates (and durations) to tasks and they appear here."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <div style={{ width: `calc(var(--label-w) + ${days * DAY}px)` }} className="[--label-w:11rem] sm:[--label-w:17rem]">
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
              <div className="sticky left-0 z-30 w-[var(--label-w)] shrink-0 border-r border-line bg-surface px-3 py-2 text-xs font-medium text-ink-muted">Task</div>
              <div className="relative shrink-0" style={{ width: days * DAY, height: 40 }}>
                {dayList.map((d, i) => {
                  const date = new Date(d + "T00:00:00Z");
                  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
                  const first = i === 0 || date.getUTCDate() === 1;
                  return (
                    <div key={d} className={`absolute top-0 h-full text-center text-[10px] leading-none ${weekend ? "bg-surface-muted" : ""}`} style={{ left: i * DAY, width: DAY }}>
                      {first && <span className="absolute left-1 top-1 whitespace-nowrap font-semibold text-ink">{date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>}
                      <span className={`absolute inset-x-0 bottom-1.5 tabular-nums ${d === today ? "font-bold text-brand" : d === target ? "font-bold text-status-red" : "text-ink-muted"}`}>{date.getUTCDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex border-b border-line bg-surface-muted">
                  <div className="sticky left-0 z-10 w-[var(--label-w)] shrink-0 bg-surface-muted px-3 py-1 text-xs font-semibold text-ink">{g.name}</div>
                </div>
                {g.items.map((t) => {
                  const f = forecast.get(t.id);
                  const p = planned(t);
                  const late = isLate(t);
                  const milestone = t.kind === "milestone";
                  const fc = f?.forecastStart && f.forecastFinish ? ([f.forecastStart, f.forecastFinish] as const) : null;
                  const summary = `${t.title}. Planned ${p ? `${formatDay(p[0])} to ${formatDay(p[1])}` : "not set"}. Forecast ${fc ? `${formatDay(fc[0])} to ${formatDay(fc[1])}` : "unknown"}${late ? `, ${f!.varianceToPlanDays} days late` : ""}.`;
                  return (
                    <div key={t.id} className="flex border-b border-line last:border-b-0 hover:bg-brand-soft/40">
                      <div className="sticky left-0 z-10 w-[var(--label-w)] shrink-0 border-r border-line bg-surface px-3 py-1.5">
                        <Link href={`${base}/tasks/${t.id}`} className="block truncate text-sm hover:text-brand" title={t.title}>
                          {milestone && <span aria-hidden>◆ </span>}{t.title}
                        </Link>
                        <span className={`block truncate text-[11px] ${late ? "font-medium text-status-red" : "text-ink-muted"}`}>
                          {t.status === "completed" ? "Completed" : late ? `${f!.varianceToPlanDays}d late` : f?.state === "unknown" ? "Forecast unknown" : `Due ${formatDay(t.due_date)}`}
                        </span>
                      </div>
                      <div className="relative shrink-0" style={{ width: days * DAY, height: 40 }} role="img" aria-label={summary}>
                        <DayLine left={x(today) + DAY / 2} className="bg-brand/60" />
                        {target && <DayLine left={x(target) + DAY / 2} className="bg-status-red/60" />}
                        {milestone ? (
                          <>
                            {p && <Diamond left={x(p[0]) + DAY / 2} className="border-2 border-ink-muted bg-surface" title={`Planned ${formatDay(p[0])}`} />}
                            {f?.forecastFinish && <Diamond left={x(f.forecastFinish) + DAY / 2} className={late ? "bg-status-red" : t.status === "completed" ? "bg-status-green" : "bg-brand"} title={`Forecast ${formatDay(f.forecastFinish)}`} />}
                          </>
                        ) : (
                          <>
                            {p && <div title={`Planned ${formatDay(p[0])} – ${formatDay(p[1])}`} className="absolute top-[7px] h-[12px] rounded-sm border border-ink-muted/50 bg-status-grey-bg" style={span(p[0], p[1])} />}
                            {fc && <div title={`Forecast ${formatDay(fc[0])} – ${formatDay(fc[1])}`} className={`absolute top-[22px] h-[10px] rounded-sm ${late ? "bg-status-red" : t.status === "completed" ? "bg-status-green" : "bg-brand"}`} style={span(fc[0], fc[1])} />}
                          </>
                        )}
                        {t.baseline_finish && (
                          <div title={`Baseline ${formatDay(t.baseline_finish)}`} className="absolute top-[4px] h-[30px] w-[2px] bg-ink" style={{ left: x(t.baseline_finish) + DAY - 1 }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {undated > 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          {undated} task{undated === 1 ? " has" : "s have"} no dates yet and {undated === 1 ? "isn't" : "aren't"} shown.{" "}
          <Link href={`${base}/tasks?flag=planning_incomplete${team ? `&team=${team.id}` : ""}`} className="text-brand hover:underline">See them</Link>
        </p>
      )}
    </>
  );
}

function sortKey(t: TaskListRow, forecast: ScheduleData["forecast"]) {
  const f = forecast.get(t.id);
  return (f?.forecastStart ?? t.start_date ?? t.due_date ?? "9999") + t.title;
}

function DayLine({ left, className }: { left: number; className: string }) {
  return <div aria-hidden className={`absolute inset-y-0 w-px ${className}`} style={{ left }} />;
}

function Diamond({ left, className, title }: { left: number; className: string; title: string }) {
  return <div title={title} className={`absolute top-[13px] h-3 w-3 -translate-x-1/2 rotate-45 ${className}`} style={{ left }} />;
}

function Legend({ hasTarget }: { hasTarget: boolean }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
      <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-6 rounded-sm border border-ink-muted/50 bg-status-grey-bg" /> Planned</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded-sm bg-brand" /> Forecast</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded-sm bg-status-red" /> Forecast late</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-6 rounded-sm bg-status-green" /> Completed</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-0.5 bg-ink" /> Baseline finish</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rotate-45 bg-brand" /> Milestone</li>
      <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-brand" /> Today</li>
      {hasTarget && <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-status-red" /> Target date</li>}
    </ul>
  );
}
