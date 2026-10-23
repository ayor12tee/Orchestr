"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { projectFromForm, revalidateProject } from "@/lib/projects/context";
import type { ActionResult } from "./types";

/*
 * Every write goes through the user's own RLS-bound Supabase client. These
 * actions validate input and turn database refusals into readable messages.
 * The database (RLS + triggers) makes the actual permission decision, so a
 * crafted request can't do more than the UI allows.
 */

const NO_PROJECT: ActionResult = { ok: false, error: "This project couldn't be found. Reload the page." };

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable())
  .optional();
const optionalUuid = z
  .string()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().uuid().nullable())
  .optional();

const taskFields = z
  .object({
    title: z.string().trim().min(1, "A title is required").max(300),
    kind: z.enum(["task", "milestone"]).default("task"),
    description: optionalText,
    team_id: optionalUuid,
    workstream: optionalText,
    accountable_owner_id: optionalUuid,
    reviewer_id: optionalUuid,
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    is_critical: z.coerce.boolean().default(false),
    start_date: optionalDate,
    due_date: optionalDate,
    duration_days: z
      .string()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number().int().min(1, "Duration is at least 1 day").nullable())
      .optional(),
    acceptance_criteria: optionalText,
    requires_evidence: z.coerce.boolean().default(false),
    requires_review: z.coerce.boolean().default(false),
    next_action: optionalText,
    planning_state: z.enum(["suggested", "approved"]).optional(),
    change_reason: optionalText,
  })
  .refine((v) => v.kind === "milestone" || !v.start_date || !v.due_date || v.start_date <= v.due_date, {
    message: "The start date must be on or before the due date",
    path: ["due_date"],
  })
  // A milestone is a single date: its due date.
  .transform((v) => (v.kind === "milestone" ? { ...v, start_date: null, duration_days: null } : v));

function formObject(formData: FormData) {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && k !== "org" && k !== "project") obj[k] = v;
  // Unchecked checkboxes are absent from FormData.
  for (const box of ["is_critical", "requires_evidence", "requires_review"]) obj[box] = formData.get(box) === "on";
  return obj;
}

function friendly(error: PostgrestError): string {
  if (error.code === "42501") return error.message.includes("row-level security")
    ? "You don't have permission to make this change."
    : error.message;
  if (error.code === "23514") {
    if (error.message.includes("blocked_needs_reason")) return "Describe what's blocking the task.";
    if (error.message.includes("dates_ordered")) return "The start date must be on or before the due date.";
    return "That change isn't allowed by the task rules.";
  }
  if (error.code === "23503") return "One of the selected people or teams isn't part of this project.";
  return "The change couldn't be saved. Please try again.";
}

export async function createTask(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = taskFields.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  // A reason only means something on a change, not on creation.
  const fields = { ...parsed.data, change_reason: undefined };
  const { data, error } = await supabase
    .from("tasks")
    .insert({ ...fields, project_id: access.project.id, source: "manual" })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error) };
  revalidateProject(access);
  redirect(`${access.projectBase}/tasks/${data.id}`);
}

/**
 * Optimistic concurrency: the update only applies if the row is still at the
 * version the user loaded. Otherwise it reports a conflict, not an overwrite.
 */
async function guardedUpdate(
  access: NonNullable<Awaited<ReturnType<typeof projectFromForm>>>,
  id: string,
  version: number,
  patch: Record<string, unknown>,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .eq("project_id", access.project.id)
    .eq("version", version)
    .select("id, version")
    .maybeSingle();
  if (error) return { ok: false, error: friendly(error) };
  if (!data) {
    const { data: current } = await supabase.from("tasks").select("version").eq("id", id).maybeSingle();
    if (current && current.version !== version) {
      return {
        ok: false,
        conflict: true,
        error: "Someone else changed this task while you were editing. Reload to see their changes, then reapply yours.",
      };
    }
    return { ok: false, error: "You don't have permission to change this task, or it no longer exists." };
  }
  revalidateProject(access);
  return { ok: true, message: "Saved" };
}

const idVersion = z.object({ id: z.string().uuid(), version: z.coerce.number().int().min(1) });

export async function updateTask(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const keys = idVersion.safeParse({ id: formData.get("id"), version: formData.get("version") });
  const fields = formObject(formData);
  delete fields.id;
  delete fields.version;
  const parsed = taskFields.safeParse(fields);
  if (!keys.success) return { ok: false, error: "This form is out of date. Reload the page." };
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  return guardedUpdate(access, keys.data.id, keys.data.version, parsed.data);
}

const statusSchema = idVersion.extend({
  status: z.enum(["not_started", "in_progress", "blocked", "submitted_for_review", "completed"]),
  blocker_details: optionalText,
  next_action: optionalText,
});

export async function changeStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = statusSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "Choose a valid status." };
  const { id, version, status, blocker_details, next_action } = parsed.data;
  if (status === "blocked" && !blocker_details) return { ok: false, error: "Describe what's blocking the task." };
  const patch: Record<string, unknown> = { status };
  if (status === "blocked") patch.blocker_details = blocker_details;
  if (next_action !== undefined) patch.next_action = next_action;
  return guardedUpdate(access, id, version, patch);
}

export async function deleteTask(formData: FormData) {
  const access = await projectFromForm(formData);
  if (!access) return;
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).eq("project_id", access.project.id).select("id");
  if (error || !data?.length) redirect(`${access.projectBase}/tasks/${id}?error=${encodeURIComponent("You can't delete this task.")}`);
  revalidateProject(access);
  redirect(`${access.projectBase}/tasks`);
}

export async function addComment(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = z
    .object({ task_id: z.string().uuid(), body: z.string().trim().min(1, "Write a comment first").max(5000) })
    .safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("task_comments").insert(parsed.data);
  if (error) return { ok: false, error: friendly(error) };
  revalidateProject(access);
  return { ok: true };
}

export async function addChecklistItem(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = z
    .object({ task_id: z.string().uuid(), label: z.string().trim().min(1, "Enter an item").max(500) })
    .safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.from("task_checklist_items").insert(parsed.data);
  if (error) return { ok: false, error: friendly(error) };
  revalidateProject(access);
  return { ok: true };
}

export async function toggleChecklistItem(formData: FormData) {
  const access = await projectFromForm(formData);
  if (!access) return;
  const { id, done } = z
    .object({ id: z.string().uuid(), task_id: z.string().uuid(), done: z.enum(["true", "false"]) })
    .parse(formObject(formData));
  const supabase = await createClient();
  const isDone = done === "true";
  await supabase
    .from("task_checklist_items")
    .update({ is_done: isDone, done_by: isDone ? access.user.id : null, done_at: isDone ? new Date().toISOString() : null })
    .eq("id", id);
  revalidateProject(access);
}

export async function setAssignee(formData: FormData) {
  const access = await projectFromForm(formData);
  if (!access) return;
  const { task_id, user_id, op } = z
    .object({ task_id: z.string().uuid(), user_id: z.string().uuid(), op: z.enum(["add", "remove"]) })
    .parse(formObject(formData));
  const supabase = await createClient();
  if (op === "add") {
    await supabase.from("task_assignees").upsert({ task_id, user_id, added_by: access.user.id }, { ignoreDuplicates: true });
  } else {
    await supabase.from("task_assignees").delete().eq("task_id", task_id).eq("user_id", user_id);
  }
  revalidateProject(access);
}

/** Records metadata after the browser uploaded the file to private storage. */
export async function recordAttachment(input: {
  org: string;
  project: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  is_evidence: boolean;
}): Promise<ActionResult> {
  const fd = new FormData();
  fd.set("org", input.org);
  fd.set("project", input.project);
  const access = await projectFromForm(fd);
  if (!access) return NO_PROJECT;
  const parsed = z
    .object({
      task_id: z.string().uuid(),
      storage_path: z.string().min(1),
      file_name: z.string().min(1).max(255),
      mime_type: z.string().nullable(),
      size_bytes: z.number().int().min(0),
      is_evidence: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  // The path must sit under this task's folder, matching the storage policy.
  if (!parsed.data.storage_path.startsWith(`${access.org.id}/${access.project.id}/${parsed.data.task_id}/`)) {
    return { ok: false, error: "Invalid upload location." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("task_attachments").insert(parsed.data);
  if (error) return { ok: false, error: friendly(error) };
  revalidateProject(access);
  return { ok: true, message: "Uploaded" };
}

export async function getAttachmentUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient();
  // Signed URL creation is itself subject to the storage read policy.
  const { data } = await supabase.storage.from("task-evidence").createSignedUrl(storagePath, 60);
  return data?.signedUrl ?? null;
}

/**
 * Resets the approved baseline to the current plan. The reason is recorded
 * in the task history next to the old and new baseline dates.
 */
export async function rebaseline(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = idVersion
    .extend({ change_reason: z.string().trim().min(3, "Explain why the baseline is changing").max(1000) })
    .safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: task } = await supabase.from("tasks").select("start_date, due_date").eq("id", parsed.data.id).maybeSingle();
  if (!task) return { ok: false, error: "Task not found." };
  if (!task.due_date) return { ok: false, error: "Set a due date before baselining." };
  return guardedUpdate(access, parsed.data.id, parsed.data.version, {
    baseline_start: task.start_date,
    baseline_finish: task.due_date,
    change_reason: parsed.data.change_reason,
  });
}
