"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { getOrgAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/tasks/types";
import { projectFromForm, revalidateProject } from "./context";

const SLUG = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/;
const uuid = z.string().uuid();
const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullable());
const NO_PROJECT: ActionResult = { ok: false, error: "This project couldn't be found. Reload the page." };

function friendly(error: PostgrestError): string {
  if (error.code === "23505") return "That's already taken in this organization.";
  if (error.code === "42501") return error.message.includes("row-level security") ? "You don't have permission to do that." : error.message;
  if (error.code === "23514") {
    if (error.message.includes("project_dates_ordered")) return "The start date must be on or before the target date.";
    return error.message.replace(/^.*?: /, "");
  }
  if (error.code === "23503") return error.message.includes("different organization") ? error.message : "That person or team isn't part of this organization.";
  return "The change couldn't be saved. Please try again.";
}

const projectFields = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(160),
    description: z.string().trim().max(2000).transform((v) => v || null),
    start_date: optionalDate,
    target_date: optionalDate,
    timezone: z.string().trim().max(64).transform((v) => v || null),
  })
  .refine((v) => !v.start_date || !v.target_date || v.start_date <= v.target_date, {
    message: "The start date must be on or before the target date",
    path: ["target_date"],
  });

export async function createProject(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const orgSlug = formData.get("org");
  if (typeof orgSlug !== "string" || !SLUG.test(orgSlug)) return { ok: false, error: "Reload the page and try again." };
  const access = await getOrgAccess(orgSlug);
  const slug = z.string().trim().toLowerCase().regex(SLUG, "Use 2–48 lowercase letters, numbers and hyphens").safeParse(formData.get("slug"));
  if (!slug.success) return { ok: false, error: slug.error.issues[0].message };
  const parsed = projectFields.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project", {
    p_org: access.org.id,
    p_name: p.name,
    p_slug: slug.data,
    p_description: p.description,
    p_start: p.start_date,
    p_target: p.target_date,
    p_timezone: p.timezone,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "A project with that web address already exists." : friendly(error) };
  redirect(`${access.base}/p/${slug.data}`);
}

export async function updateProject(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = projectFields
    .and(z.object({ status: z.enum(["planning", "active", "on_hold", "completed", "archived"]) }))
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update(parsed.data).eq("id", access.project.id).select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to change this project." };
  revalidateProject(access);
  return { ok: true, message: "Saved" };
}

export async function setProjectMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = z
    .object({ user_id: uuid, role_id: z.string().optional(), op: z.enum(["set", "remove"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person." };
  const { user_id, role_id, op } = parsed.data;
  const supabase = await createClient();
  if (op === "remove") {
    const { data, error } = await supabase.from("project_members").delete().eq("project_id", access.project.id).eq("user_id", user_id).select("user_id");
    if (error) return { ok: false, error: friendly(error) };
    if (!data?.length) return { ok: false, error: "You don't have permission to remove people from this project." };
  } else {
    if (!role_id || !uuid.safeParse(role_id).success) return { ok: false, error: "Choose a project role." };
    const { error } = await supabase
      .from("project_members")
      .upsert({ project_id: access.project.id, organization_id: access.org.id, user_id, role_id }, { onConflict: "project_id,user_id" });
    if (error) return { ok: false, error: friendly(error) };
  }
  revalidateProject(access);
  return { ok: true, message: op === "remove" ? "Removed from project" : "Project role saved" };
}

export async function setProjectTeam(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const parsed = z.object({ team_id: uuid, op: z.enum(["attach", "detach"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Choose a team." };
  const supabase = await createClient();
  const { team_id, op } = parsed.data;
  const { error } = op === "attach"
    ? await supabase.from("project_teams").insert({ project_id: access.project.id, organization_id: access.org.id, team_id })
    : await supabase.from("project_teams").delete().eq("project_id", access.project.id).eq("team_id", team_id);
  if (error) return { ok: false, error: friendly(error) };
  revalidateProject(access);
  return { ok: true, message: op === "attach" ? "Team added to the project" : "Team removed. Its tasks stay, without a team." };
}

const SETTINGS = {
  indicators: z.object({ due_soon_days: z.coerce.number().int().min(1, "At least 1 day").max(60, "At most 60 days") }),
  progress: z.object({ unverified_complete_credit: z.coerce.number().min(0, "Between 0 and 100%").max(1, "Between 0 and 100%") }),
} as const;

export async function updateProjectSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await projectFromForm(formData);
  if (!access) return NO_PROJECT;
  const key = formData.get("key");
  if (typeof key !== "string" || !(key in SETTINGS)) return { ok: false, error: "That setting can't be edited here." };
  const raw = Object.fromEntries([...formData.entries()].filter(([k]) => !["key", "approval_state", "org", "project"].includes(k)));
  if (key === "progress" && typeof raw.unverified_complete_credit === "string") {
    raw.unverified_complete_credit = String(Number(raw.unverified_complete_credit) / 100); // the form asks for a percentage
  }
  const parsed = SETTINGS[key as keyof typeof SETTINGS].safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const approval_state = formData.get("approval_state") === "approved" ? "approved" : "suggested";
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_settings")
    .upsert({
      project_id: access.project.id,
      organization_id: access.org.id,
      key,
      value: parsed.data,
      approval_state,
      updated_by: access.user.id,
      updated_at: new Date().toISOString(),
    })
    .select("key");
  if (error || !data?.length) return { ok: false, error: "Only people who manage this project can change its settings." };
  revalidateProject(access);
  return { ok: true, message: approval_state === "approved" ? "Saved and approved" : "Saved as a suggestion" };
}
