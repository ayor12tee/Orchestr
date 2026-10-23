import Link from "next/link";
import type { ProjectAccess } from "@/lib/auth";
import { describeMissing } from "@/lib/domain/schedule";
import { formatDay, formatShift } from "@/lib/format";
import { removeDependency } from "@/lib/schedule/actions";
import type { ScheduleData } from "@/lib/schedule/data";
import { statusLabel, type DependencyRow, type TaskRow } from "@/lib/tasks/types";
import { ProjectFields } from "./project-context";
import { AddDependencyForm, ExceptionForm, ImpactPreviewForm, RebaselineForm } from "./schedule-interactions";
import { Badge, Card } from "./ui";

export function SchedulePanel({ task, schedule, access }: { task: TaskRow; schedule: ScheduleData; access: ProjectAccess }) {
  const f = schedule.forecast.get(task.id);
  const milestone = task.kind === "milestone";
  const late = f?.varianceToPlanDays ?? null;
  const vsBaseline = f?.varianceToBaselineDays ?? null;
  const base = access.projectBase;

  return (
    <Card title={milestone ? "Milestone forecast" : "Schedule"}>
      {!f || f.state === "unknown" ? (
        <div className="rounded-md bg-status-grey-bg p-3 text-sm">
          <p className="font-medium">Can&apos;t forecast this {milestone ? "milestone" : "task"} yet.</p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {(f?.missing ?? []).map((m, i) => <li key={i}>{describeMissing(m, schedule.titleOf)}</li>)}
          </ul>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {!milestone && <Item label="Forecast start" value={formatDay(f.forecastStart)} />}
            <Item label={task.status === "completed" ? "Finished" : milestone ? "Forecast date" : "Forecast finish"} value={<strong>{formatDay(f.forecastFinish)}</strong>} />
            <Item label={milestone ? "Planned date" : "Due date"} value={formatDay(task.due_date)} />
            <Item label="Baseline" value={task.baseline_finish ? formatDay(task.baseline_finish) : "Not approved yet"} />
          </dl>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {late !== null && task.status !== "completed" && (
              <Badge tone={late > 0 ? "red" : "green"}>{late > 0 ? `${late} day${late === 1 ? "" : "s"} late` : "On track for due date"}</Badge>
            )}
            {vsBaseline !== null && vsBaseline !== 0 && (
              <Badge tone={vsBaseline > 0 ? "amber" : "green"} title="Compared with the first approved plan">Baseline {formatShift(vsBaseline)}</Badge>
            )}
            {!f.dependenciesSatisfied && task.status !== "completed" && (
              <Badge tone="amber">Waiting on {f.openBlockers.length} unfinished task{f.openBlockers.length === 1 ? "" : "s"}</Badge>
            )}
          </div>
          {f.drivenBy && (
            <p className="mt-2 text-sm text-ink-muted">
              Pushed out by{" "}
              {schedule.taskById.has(f.drivenBy)
                ? <Link href={`${base}/tasks/${f.drivenBy}`} className="text-brand hover:underline">{schedule.titleOf(f.drivenBy)}</Link>
                : schedule.titleOf(f.drivenBy)}
            </p>
          )}
        </>
      )}
      {access.canInProject("baseline.approve") && task.due_date && task.planning_state === "approved" && (
        <div className="mt-3"><RebaselineForm id={task.id} version={task.version} /></div>
      )}
      {task.status !== "completed" && <ImpactPreviewForm taskId={task.id} defaultDate={f?.forecastFinish ?? task.due_date} />}
    </Card>
  );
}

export function DependenciesPanel({ task, schedule, access }: { task: TaskRow; schedule: ScheduleData; access: ProjectAccess }) {
  const waitsOn = schedule.dependencyRows.filter((d) => d.successor_id === task.id);
  const blocks = schedule.dependencyRows.filter((d) => d.predecessor_id === task.id);
  const canManage = access.canInProject("dependencies.manage", task.team_id);
  const canApprove = access.canInProject("approvals.decide");
  const base = access.projectBase;
  const linked = new Set([...waitsOn.map((d) => d.predecessor_id), ...blocks.map((d) => d.successor_id), task.id]);
  const options = schedule.tasks
    .filter((t) => !linked.has(t.id))
    .sort((a, b) => (a.team?.name ?? "").localeCompare(b.team?.name ?? "") || a.title.localeCompare(b.title))
    .map((t) => ({ id: t.id, label: `${t.kind === "milestone" ? "◆ " : ""}${t.title}${t.team ? ` — ${t.team.name}` : ""}` }));

  const row = (d: DependencyRow, otherId: string, removable: boolean, waiting: boolean) => {
    const other = schedule.taskById.get(otherId);
    const blocking = d.type === "finish_to_start";
    return (
      <li key={d.id} className="py-2 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            {other ? <Link href={`${base}/tasks/${other.id}`} className="font-medium hover:text-brand">{other.kind === "milestone" && "◆ "}{other.title}</Link> : <span className="italic text-ink-muted">A task outside your view</span>}
            {other && <span className="ml-2"><Badge tone={other.status === "completed" ? "green" : other.status === "blocked" ? "red" : "grey"}>{statusLabel(other.status)}</Badge></span>}
          </span>
          {removable && (
            <form action={removeDependency}>
              <ProjectFields />
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="task_id" value={task.id} />
              <button className="text-xs text-ink-muted hover:text-status-red" aria-label={`Remove link with ${other?.title ?? "hidden task"}`}>Remove</button>
            </form>
          )}
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {blocking ? "Blocking" : "Related, doesn't block"}
          {d.lag_days > 0 && ` · ${d.lag_days} day${d.lag_days === 1 ? "" : "s"} gap after it finishes`}
        </p>
        {d.exception_approved && <p className="mt-1 text-xs text-status-amber">Exception approved: “{d.exception_reason}”</p>}
        {waiting && blocking && canApprove && (d.exception_approved || other?.status !== "completed") && (
          <div className="mt-1"><ExceptionForm id={d.id} taskId={task.id} approved={d.exception_approved} /></div>
        )}
      </li>
    );
  };

  return (
    <Card title="Dependencies" action={<Link href={`${base}/dependencies?task=${task.id}`} className="text-xs text-brand hover:underline">View on map</Link>}>
      <p className="text-xs font-medium text-ink-muted">Waits on</p>
      {waitsOn.length ? (
        <ul className="mt-1 divide-y divide-line text-sm">{waitsOn.map((d) => row(d, d.predecessor_id, canManage, true))}</ul>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">Nothing. This task can start on its own dates.</p>
      )}
      <p className="mt-4 text-xs font-medium text-ink-muted">Must finish before</p>
      {blocks.length ? (
        <ul className="mt-1 divide-y divide-line text-sm">
          {blocks.map((d) => row(d, d.successor_id, access.canInProject("dependencies.manage", schedule.taskById.get(d.successor_id)?.team_id), false))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-ink-muted">No tasks wait on this one.</p>
      )}
      {canManage && options.length > 0 && <AddDependencyForm taskId={task.id} options={options} />}
    </Card>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
