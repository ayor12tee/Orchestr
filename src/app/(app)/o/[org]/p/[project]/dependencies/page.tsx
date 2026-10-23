import Link from "next/link";
import { layeredLayout } from "@/lib/domain/graph";
import { formatDay } from "@/lib/format";
import { getProjectAccess } from "@/lib/auth";
import { getProjectTeams } from "@/lib/projects/data";
import { loadSchedule } from "@/lib/schedule/data";
import { statusLabel } from "@/lib/tasks/types";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { Card, EmptyState, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";

export const metadata = { title: "Dependency Map · Orchestr" };

const W = 210;
const H = 62;
const COL_GAP = 64;
const ROW_GAP = 14;
const PAD = 12;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export default async function DependencyMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>;
  searchParams: Promise<{ team?: string; task?: string }>;
}) {
  const { org, project } = await params;
  const sp = await searchParams;
  const access = await getProjectAccess(org, project);
  const [schedule, teams] = await Promise.all([loadSchedule(access), getProjectTeams(access)]);
  const base = access.projectBase;
  const { deps, forecast, taskById, hiddenIds } = schedule;

  // Which tasks to draw: everything linked, a team and its direct
  // neighbours, or one task's full upstream and downstream chain.
  let ids = new Set(deps.flatMap((d) => [d.predecessorId, d.successorId]));
  const team = teams.find((t) => t.id === sp.team);
  const focus = sp.task && ids.has(sp.task) ? sp.task : null;
  if (focus) {
    const chain = new Set([focus]);
    for (const dir of ["down", "up"] as const) {
      const stack = [focus];
      const seen = new Set([focus]);
      while (stack.length) {
        const cur = stack.pop()!;
        for (const d of deps) {
          const next = dir === "down" ? (d.predecessorId === cur ? d.successorId : null) : d.successorId === cur ? d.predecessorId : null;
          if (next && !seen.has(next)) { seen.add(next); chain.add(next); stack.push(next); }
        }
      }
    }
    ids = chain;
  } else if (team) {
    const own = new Set([...ids].filter((id) => taskById.get(id)?.team_id === team.id));
    ids = new Set([...own, ...deps.filter((d) => own.has(d.predecessorId) || own.has(d.successorId)).flatMap((d) => [d.predecessorId, d.successorId])]);
  }
  const edges = deps.filter((d) => ids.has(d.predecessorId) && ids.has(d.successorId));
  const teamOrder = new Map(teams.map((t, i) => [t.id, i]));
  const rank = (id: string) => teamOrder.get(taskById.get(id)?.team_id ?? "") ?? 999;
  const columns = layeredLayout([...ids], edges, (a, b) => rank(a) - rank(b) || schedule.titleOf(a).localeCompare(schedule.titleOf(b)));

  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, c) => col.forEach((id, r) => pos.set(id, { x: PAD + c * (W + COL_GAP), y: PAD + r * (H + ROW_GAP) })));
  const width = PAD * 2 + Math.max(1, columns.length) * (W + COL_GAP) - COL_GAP;
  const height = PAD * 2 + Math.max(1, ...columns.map((c) => c.length)) * (H + ROW_GAP) - ROW_GAP;

  return (
    <>
      <RealtimeRefresh tables={["tasks", "task_dependencies"]} filter={`project_id=eq.${access.project.id}`} />
      <PageHeader
        title="Dependency Map"
        description="Which work waits on which. Read left to right: each task sits after everything it waits on."
        actions={focus ? <Link href={`${base}/dependencies`} className={secondaryButtonClass}>Show all</Link> : undefined}
      />

      {!focus && (
        <form className="mb-4 flex flex-wrap items-end gap-3" action={`${base}/dependencies`}>
          <label className="text-sm">
            <span className="text-xs font-medium text-ink-muted">Team</span>
            <select name="team" defaultValue={sp.team ?? ""} className={inputClass}>
              <option value="">All teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <button className={secondaryButtonClass}>Apply</button>
        </form>
      )}
      {focus && (
        <p className="mb-4 text-sm text-ink-muted">
          Showing everything upstream and downstream of <Link href={`${base}/tasks/${focus}`} className="font-medium text-brand hover:underline">{schedule.titleOf(focus)}</Link>.
        </p>
      )}

      {ids.size === 0 ? (
        <EmptyState>
          {sp.task ? "This task has no dependencies yet." : "No dependencies yet. Open a task and use “Add a dependency” to link it to the work it waits on."}
        </EmptyState>
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted" aria-label="Legend">
            <li className="flex items-center gap-1.5"><svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" className="stroke-ink-muted" strokeWidth="1.5" /></svg> Must finish first</li>
            <li className="flex items-center gap-1.5"><svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" className="stroke-ink-muted" strokeWidth="1.5" strokeDasharray="4 3" /></svg> Related, doesn&apos;t block</li>
            <li className="flex items-center gap-1.5"><svg width="28" height="8" aria-hidden><line x1="0" y1="4" x2="28" y2="4" className="stroke-status-amber" strokeWidth="2" /></svg> Exception approved</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border-2 border-status-red" /> Forecast late</li>
            <li className="flex items-center gap-1.5"><span className="inline-block h-3 w-4 rounded-sm border-2 border-dashed border-status-grey" /> Can&apos;t forecast yet</li>
          </ul>
          <div className="overflow-auto rounded-lg border border-line bg-surface">
            <svg width={width} height={height} role="img" aria-label={`Dependency map with ${ids.size} tasks and ${edges.length} links. The same links are listed in the table below.`}>
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="fill-ink-muted" />
                </marker>
                <marker id="arrow-amber" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" className="fill-status-amber" />
                </marker>
              </defs>
              {edges.map((d) => {
                const a = pos.get(d.predecessorId)!;
                const b = pos.get(d.successorId)!;
                const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 2, y2 = b.y + H / 2;
                const mid = (x1 + x2) / 2;
                return (
                  <path
                    key={`${d.predecessorId}-${d.successorId}`}
                    d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                    fill="none"
                    className={d.exceptionApproved ? "stroke-status-amber" : "stroke-ink-muted"}
                    strokeWidth={d.exceptionApproved ? 2 : 1.5}
                    strokeDasharray={d.type === "informational" ? "4 3" : undefined}
                    markerEnd={`url(#${d.exceptionApproved ? "arrow-amber" : "arrow"})`}
                  >
                    <title>{`${schedule.titleOf(d.predecessorId)} → ${schedule.titleOf(d.successorId)}${d.lagDays ? ` (+${d.lagDays} days)` : ""}`}</title>
                  </path>
                );
              })}
              {[...ids].map((id) => {
                const p = pos.get(id)!;
                const t = taskById.get(id);
                const f = forecast.get(id);
                if (!t || hiddenIds.has(id)) {
                  return (
                    <g key={id} transform={`translate(${p.x},${p.y})`}>
                      <rect width={W} height={H} rx="6" className="fill-surface-muted stroke-line" strokeDasharray="4 3" />
                      <text x="10" y="35" className="fill-ink-muted text-[12px] italic">A task outside your view</text>
                    </g>
                  );
                }
                const late = t.status !== "completed" && (f?.varianceToPlanDays ?? 0) > 0;
                const unknown = f?.state === "unknown";
                const border = t.status === "completed" ? "stroke-status-green" : late ? "stroke-status-red" : unknown ? "stroke-status-grey" : "stroke-brand";
                const line3 =
                  t.status === "completed" ? `Done ${formatDay(t.actual_finish)}`
                  : unknown ? "Can't forecast yet"
                  : late ? `${f!.varianceToPlanDays}d late · forecast ${formatDay(f!.forecastFinish)}`
                  : `Forecast ${formatDay(f?.forecastFinish)}`;
                return (
                  <a key={id} href={`${base}/tasks/${id}`} aria-label={`${t.title}: ${statusLabel(t.status)}, ${line3}`}>
                    <g transform={`translate(${p.x},${p.y})`} className="group">
                      <rect width={W} height={H} rx="6" className={`fill-surface ${border} group-hover:fill-brand-soft`} strokeWidth={id === focus ? 3 : late ? 2 : 1.5} strokeDasharray={unknown && t.status !== "completed" ? "5 3" : undefined} />
                      <text x="10" y="20" className="fill-ink text-[12px] font-semibold">{t.kind === "milestone" ? "◆ " : ""}{clip(t.title, 30)}</text>
                      <text x="10" y="36" className="fill-ink-muted text-[11px]">{clip(t.team?.name ?? "No team", 34)}</text>
                      <text x="10" y="52" className={`text-[11px] ${late ? "fill-status-red font-medium" : "fill-ink-muted"}`}>{line3}</text>
                      <title>{t.title}</title>
                    </g>
                  </a>
                );
              })}
            </svg>
          </div>

          <Card title={`Links (${edges.length})`} className="mt-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-ink-muted">
                  <tr><th className="py-1 font-medium">Task</th><th className="font-medium">Waits on</th><th className="font-medium">Kind</th><th className="font-medium">Waiting-on status</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {edges.map((d) => {
                    const pred = taskById.get(d.predecessorId);
                    return (
                      <tr key={`${d.predecessorId}-${d.successorId}`}>
                        <td className="py-1.5"><TaskLink base={base} id={d.successorId} title={schedule.titleOf(d.successorId)} visible={taskById.has(d.successorId)} /></td>
                        <td><TaskLink base={base} id={d.predecessorId} title={schedule.titleOf(d.predecessorId)} visible={!!pred} /></td>
                        <td className="text-ink-muted">
                          {d.type === "informational" ? "Related" : `Must finish first${d.lagDays ? `, +${d.lagDays}d` : ""}`}
                          {d.exceptionApproved && <span className="text-status-amber"> · exception</span>}
                        </td>
                        <td className="text-ink-muted">{pred ? statusLabel(pred.status) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function TaskLink({ base, id, title, visible }: { base: string; id: string; title: string; visible: boolean }) {
  return visible ? <Link href={`${base}/tasks/${id}`} className="hover:text-brand">{title}</Link> : <span className="italic text-ink-muted">{title}</span>;
}
