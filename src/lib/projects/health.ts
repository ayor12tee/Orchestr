import { getProjectAccess, type ProjectAccess } from "@/lib/auth";
import { taskIndicators } from "@/lib/domain/indicators";
import { getProjectSettings } from "./data";
import { forecastLate, loadSchedule } from "@/lib/schedule/data";

export interface ProjectHealth {
  access: ProjectAccess;
  today: string;
  total: number;
  completed: number;
  overdue: number;
  blocked: number;
  forecastLate: number;
  /** Open tasks whose finish can't be forecast (missing dates or durations). */
  unknownForecast: number;
  planningIncomplete: number;
  nextMilestone: { id: string; title: string; planned: string | null; forecast: string | null; lateDays: number | null } | null;
}

/**
 * Health figures for one project, computed from its tasks, dependencies and
 * forecasts as the current user can see them. Nothing here is stored or
 * estimated: every number links back to records.
 */
export async function projectHealth(orgSlug: string, projectSlug: string): Promise<ProjectHealth> {
  const access = await getProjectAccess(orgSlug, projectSlug);
  const [schedule, settings] = await Promise.all([loadSchedule(access), getProjectSettings(access)]);
  const open = schedule.tasks.filter((t) => t.status !== "completed");
  const ind = schedule.tasks.map((t) => taskIndicators(t, settings.today, { dueSoonDays: settings.dueSoonDays }));
  const count = (kind: string) => ind.filter((list) => list.some((i) => i.kind === kind)).length;

  const milestones = open
    .filter((t) => t.kind === "milestone")
    .map((t) => ({ t, f: schedule.forecast.get(t.id) }))
    .sort((a, b) => (a.f?.forecastFinish ?? a.t.due_date ?? "9999").localeCompare(b.f?.forecastFinish ?? b.t.due_date ?? "9999"));
  const next = milestones[0];

  return {
    access,
    today: settings.today,
    total: schedule.tasks.length,
    completed: schedule.tasks.length - open.length,
    overdue: count("overdue"),
    blocked: count("blocked"),
    forecastLate: forecastLate(schedule).length,
    unknownForecast: open.filter((t) => schedule.forecast.get(t.id)?.state === "unknown").length,
    planningIncomplete: count("planning_incomplete"),
    nextMilestone: next
      ? {
          id: next.t.id,
          title: next.t.title,
          planned: next.t.due_date,
          forecast: next.f?.forecastFinish ?? null,
          lateDays: next.f?.varianceToPlanDays ?? null,
        }
      : null,
  };
}
