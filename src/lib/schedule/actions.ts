"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { validateDependency, type Dependency } from "@/lib/domain/graph";
import { describeMissing, impactOfFinishingOn } from "@/lib/domain/schedule";
import { loadSchedule } from "./data";
import type { ActionResult } from "@/lib/tasks/types";

/*
 * Dependency writes go through the user's RLS client. The checks here give
 * readable messages up front; the database re-checks everything (including
 * loops through tasks this user can't see) and has the final say.
 */

function friendly(error: PostgrestError): string {
  if (error.code === "23505") return "These tasks are already linked.";
  if (error.message.includes("circular")) return "That link would create a circular chain of tasks.";
  if (error.message.includes("not_self")) return "A task can't depend on itself.";
  if (error.message.includes("exception_needs_reason")) return "Give a reason for the exception.";
  if (error.code === "42501") return error.message.includes("row-level security")
    ? "You don't have permission to change this task's dependencies."
    : error.message;
  return "The change couldn't be saved. Please try again.";
}

function revalidate(...taskIds: string[]) {
  for (const id of taskIds) revalidatePath(`/tasks/${id}`);
  revalidatePath("/dependencies");
  revalidatePath("/timeline");
  revalidatePath("/");
}

const addSchema = z.object({
  task_id: z.string().uuid(),
  other_id: z.string().uuid({ message: "Choose a task" }),
  direction: z.enum(["waits_on", "blocks"]),
  type: z.enum(["finish_to_start", "informational"]),
  lag_days: z
    .string()
    .transform((v) => (v.trim() === "" ? 0 : Number(v)))
    .pipe(z.number().int("Lag is a whole number of days").min(0, "Lag can't be negative").max(365)),
});

export async function addDependency(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { task_id, other_id, direction, type } = parsed.data;
  const lag_days = type === "informational" ? 0 : parsed.data.lag_days;
  const [predecessor_id, successor_id] = direction === "waits_on" ? [other_id, task_id] : [task_id, other_id];

  const schedule = await loadSchedule();
  const candidate: Dependency = { predecessorId: predecessor_id, successorId: successor_id, type, lagDays: lag_days };
  const known = new Set([...schedule.taskById.keys(), ...schedule.hiddenIds]);
  const problem = validateDependency(candidate, schedule.deps, known);
  if (problem?.code === "cycle") {
    return { ok: false, error: `That would create a loop: ${problem.path.map((id) => `"${schedule.titleOf(id)}"`).join(" → ")}.` };
  }
  if (problem) return { ok: false, error: problem.code === "unknown_task" ? "Choose a task you can see." : problem.message };

  const access = await getAccess();
  const supabase = await createClient();
  const { error } = await supabase
    .from("task_dependencies")
    .insert({ conference_id: access.conference.id, predecessor_id, successor_id, type, lag_days });
  if (error) return { ok: false, error: friendly(error) };
  revalidate(predecessor_id, successor_id);
  return { ok: true, message: "Dependency added" };
}

export async function removeDependency(formData: FormData) {
  const { id, task_id } = z.object({ id: z.string().uuid(), task_id: z.string().uuid() }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  const { data } = await supabase.from("task_dependencies").delete().eq("id", id).select("predecessor_id, successor_id");
  revalidate(task_id, ...(data ?? []).flatMap((d) => [d.predecessor_id as string, d.successor_id as string]));
}

const exceptionSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  approve: z.enum(["true", "false"]),
  reason: z.string().trim().max(1000).optional(),
});

export async function setDependencyException(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = exceptionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "This form is out of date. Reload the page." };
  const approve = parsed.data.approve === "true";
  if (approve && !parsed.data.reason) return { ok: false, error: "Give a reason for the exception." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_dependencies")
    .update({ exception_approved: approve, exception_reason: approve ? parsed.data.reason : null })
    .eq("id", parsed.data.id)
    .select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to record exceptions." };
  revalidate(parsed.data.task_id);
  return { ok: true, message: approve ? "Exception recorded" : "Exception withdrawn" };
}

export interface ImpactPreview {
  ok: true;
  finish: string;
  affected: {
    id: string;
    title: string;
    milestone: boolean;
    before: string | null;
    after: string | null;
    shiftDays: number | null;
    breachesPlan: boolean;
    plannedFinish: string | null;
  }[];
  absorbed: number;
  quantifiable: boolean;
  missing: string[];
}

/** Read-only: forecasts the knock-on effect of a task finishing on `finish`. Saves nothing. */
export async function previewImpact(
  _prev: ImpactPreview | { ok: false; error: string } | null,
  formData: FormData,
): Promise<ImpactPreview | { ok: false; error: string }> {
  const parsed = z
    .object({ task_id: z.string().uuid(), finish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date") })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const schedule = await loadSchedule();
  if (!schedule.taskById.has(parsed.data.task_id)) return { ok: false, error: "Task not found." };

  const report = impactOfFinishingOn(schedule.nodes, schedule.deps, schedule.today, parsed.data.task_id, parsed.data.finish);
  return {
    ok: true,
    finish: parsed.data.finish,
    // Placeholders for hidden tasks are summarised, never named.
    affected: report.affected
      .filter((e) => !schedule.hiddenIds.has(e.id))
      .map((e) => ({
        id: e.id,
        title: e.title,
        milestone: e.kind === "milestone",
        before: e.before,
        after: e.after,
        shiftDays: e.shiftDays,
        breachesPlan: e.breachesPlan,
        plannedFinish: e.plannedFinish,
      })),
    absorbed: report.absorbed.length,
    quantifiable: report.quantifiable,
    missing: report.missing.map((m) => describeMissing(m, schedule.titleOf)),
  };
}
