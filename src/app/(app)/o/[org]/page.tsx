import Link from "next/link";
import { getOrgAccess } from "@/lib/auth";
import { daysUntil } from "@/lib/domain/dates";
import { formatDate, formatDay } from "@/lib/format";
import { projectHealth, type ProjectHealth } from "@/lib/projects/health";
import { createClient } from "@/lib/supabase/server";
import { Badge, EmptyState, PageHeader, buttonClass } from "@/components/ui";

export const metadata = { title: "Overview · Orchestr" };

const STATUS_LABEL = { planning: "Planning", active: "Active", on_hold: "On hold", completed: "Completed", archived: "Archived" } as const;

export default async function OrgOverview({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await getOrgAccess(org);
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("slug")
    .eq("organization_id", access.org.id)
    .neq("status", "archived")
    .order("target_date", { ascending: true, nullsFirst: false });
  const health = await Promise.all((projects ?? []).map((p) => projectHealth(org, p.slug as string)));

  return (
    <>
      <PageHeader
        title={access.org.name}
        description="Every project you can see, with figures calculated from its tasks and dependencies."
        actions={access.can("projects.create") && <Link href={`${access.base}/projects/new`} className={buttonClass}>New project</Link>}
      />
      {health.length === 0 ? (
        <EmptyState>
          {access.can("projects.create") ? (
            <>No projects yet. <Link href={`${access.base}/projects/new`} className="text-brand hover:underline">Create the first one</Link>, then add its teams and people.</>
          ) : (
            "You haven't been added to any projects yet. Ask an administrator to add you."
          )}
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {health.map((h) => <ProjectCard key={h.access.project.id} h={h} />)}
        </div>
      )}
    </>
  );
}

function ProjectCard({ h }: { h: ProjectHealth }) {
  const p = h.access.project;
  const base = h.access.projectBase;
  const remaining = p.target_date ? daysUntil(p.target_date, h.today) : null;
  return (
    <section className="flex flex-col rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={base} className="text-base font-semibold text-ink hover:text-brand">{p.name}</Link>
          <Badge tone={p.status === "on_hold" ? "amber" : p.status === "completed" ? "green" : "grey"}>{STATUS_LABEL[p.status]}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {p.target_date
            ? <>Target {formatDate(p.target_date)}{remaining !== null && remaining >= 0 && ` · ${remaining} day${remaining === 1 ? "" : "s"} to go`}</>
            : "No target date"}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-px bg-line text-center">
        <Figure label="Overdue" value={h.overdue} tone={h.overdue ? "red" : undefined} href={`${base}/tasks?flag=overdue`} />
        <Figure label="Blocked" value={h.blocked} tone={h.blocked ? "red" : undefined} href={`${base}/tasks?flag=blocked`} />
        <Figure label="Forecast late" value={h.forecastLate} tone={h.forecastLate ? "red" : undefined} href={`${base}/tasks?flag=forecast_late`} />
      </div>
      <div className="flex-1 space-y-1.5 px-4 py-3 text-sm">
        <p className="text-ink-muted">
          {h.total === 0 ? "No tasks yet." : <>{h.completed} of {h.total} tasks completed</>}
          {h.unknownForecast > 0 && <> · <Link href={`${base}/tasks?flag=planning_incomplete`} className="text-status-amber hover:underline">{h.unknownForecast} can&apos;t be forecast yet</Link></>}
        </p>
        {h.nextMilestone && (
          <p>
            <span className="text-ink-muted">Next milestone: </span>
            <Link href={`${base}/tasks/${h.nextMilestone.id}`} className="hover:text-brand">◆ {h.nextMilestone.title}</Link>
            <span className={`ml-1 text-xs ${h.nextMilestone.lateDays && h.nextMilestone.lateDays > 0 ? "font-medium text-status-red" : "text-ink-muted"}`}>
              {h.nextMilestone.forecast ? `forecast ${formatDay(h.nextMilestone.forecast)}` : "not forecastable yet"}
              {h.nextMilestone.lateDays && h.nextMilestone.lateDays > 0 ? `, ${h.nextMilestone.lateDays}d late` : ""}
            </span>
          </p>
        )}
      </div>
    </section>
  );
}

function Figure({ label, value, tone, href }: { label: string; value: number; tone?: "red"; href: string }) {
  return (
    <Link href={href} className="block bg-surface px-2 py-3 hover:bg-surface-muted">
      <span className={`block text-xl font-semibold tabular-nums ${tone === "red" ? "text-status-red" : "text-ink"}`}>{value}</span>
      <span className="block text-xs text-ink-muted">{label}</span>
    </Link>
  );
}
