"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";
import { getOrgAccess, getUser, type OrgAccess } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/tasks/types";

/*
 * Organization administration. Writes go through the user's RLS client; the
 * database enforces who may do what (including "no escalation" and "keep an
 * Owner"). The only service-role call is Supabase's invite email, made after
 * the caller's members.manage permission has been checked.
 */

const SLUG = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$/;
const slug = z.string().trim().toLowerCase().regex(SLUG, "Use 2–48 lowercase letters, numbers and hyphens");
const uuid = z.string().uuid();
const NO_ORG: ActionResult = { ok: false, error: "This organization couldn't be found. Reload the page." };

async function orgFromForm(formData: FormData): Promise<OrgAccess | null> {
  const s = formData.get("org");
  if (typeof s !== "string" || !SLUG.test(s)) return null;
  try {
    return await getOrgAccess(s);
  } catch {
    return null;
  }
}

function friendly(error: PostgrestError): string {
  if (error.code === "23505") return "That name is already taken here.";
  if (error.code === "42501") return error.message.includes("row-level security") ? "You don't have permission to do that." : error.message;
  if (error.code === "23503") return error.message.includes("different organization")
    ? error.message
    : "That's still in use. Remove what depends on it first.";
  if (error.code === "23514") return error.message.replace(/^.*?: /, "");
  return "The change couldn't be saved. Please try again.";
}

const done = (access: OrgAccess, message?: string): ActionResult => {
  revalidatePath(access.base, "layout");
  return { ok: true, message };
};

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------
const orgSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  slug,
  timezone: z.string().trim().min(1).max(64),
});

export async function createOrganization(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  await getUser();
  const parsed = orgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
  });
  if (error) return { ok: false, error: error.code === "23505" ? "That web address is taken. Try another." : friendly(error) };
  redirect(`/o/${parsed.data.slug}`);
}

export async function updateOrganization(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), timezone: z.string().trim().min(1).max(64), unit_label: z.string().trim().min(1).max(40) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").update(parsed.data).eq("id", access.org.id).select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to change organization settings." };
  return done(access, "Saved");
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  full_name: z.string().trim().min(1, "Enter their name").max(200),
  title: z.string().trim().max(100).transform((v) => v || null),
  role_id: uuid,
});

export async function inviteMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  // Checked before anything is sent: the invite email itself is a side effect.
  if (!access.can("members.manage")) return { ok: false, error: "You don't have permission to invite people." };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const input = parsed.data;

  const admin = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", input.email).maybeSingle();
  let userId = existing?.id as string | undefined;
  let invited = false;
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${site}/auth/welcome`,
      data: { full_name: input.full_name },
    });
    if (error || !data.user) return { ok: false, error: `The invitation couldn't be sent: ${error?.message ?? "unknown error"}` };
    userId = data.user.id;
    invited = true;
  }

  // From here on, writes go through the inviter's RLS client, so the
  // database checks members.manage again and the escalation guard applies.
  const supabase = await createClient();
  const { error: memErr } = await supabase.from("org_members").upsert(
    { organization_id: access.org.id, user_id: userId, title: input.title, status: "active", invited_by: access.user.id },
    { onConflict: "organization_id,user_id" },
  );
  if (memErr) return { ok: false, error: friendly(memErr) };
  const { error: roleErr } = await supabase
    .from("org_member_roles")
    .upsert({ organization_id: access.org.id, user_id: userId, role_id: input.role_id }, { ignoreDuplicates: true });
  if (roleErr) return { ok: false, error: `Added to the organization, but the role couldn't be given: ${friendly(roleErr)}` };

  return done(access, invited
    ? `Invitation sent to ${input.email}.`
    : `${input.email} already had an account and has been added. They'll see ${access.org.name} next time they sign in.`);
}

export async function setMemberRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z.object({ user_id: uuid, role_id: uuid, op: z.enum(["add", "remove"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Choose a role." };
  const supabase = await createClient();
  const { user_id, role_id, op } = parsed.data;
  const { error } = op === "add"
    ? await supabase.from("org_member_roles").upsert({ organization_id: access.org.id, user_id, role_id }, { ignoreDuplicates: true })
    : await supabase.from("org_member_roles").delete().eq("organization_id", access.org.id).eq("user_id", user_id).eq("role_id", role_id);
  if (error) return { ok: false, error: friendly(error) };
  return done(access, op === "add" ? "Role given" : "Role removed");
}

export async function setMemberStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z.object({ user_id: uuid, status: z.enum(["active", "suspended"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .update({ status: parsed.data.status })
    .eq("organization_id", access.org.id)
    .eq("user_id", parsed.data.user_id)
    .select("user_id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to change this person's access." };
  return done(access, parsed.data.status === "suspended" ? "Access suspended" : "Access restored");
}

// ---------------------------------------------------------------------------
// Units and teams
// ---------------------------------------------------------------------------
const optionalUuid = z.string().transform((v) => v || null).pipe(uuid.nullable());

export async function saveUnit(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z
    .object({
      id: z.string().optional().transform((v) => v || null),
      name: z.string().trim().min(1, "Enter a name").max(120),
      parent_id: optionalUuid,
      description: z.string().trim().max(1000).optional().transform((v) => v || null),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("org_units").update(fields).eq("id", id).eq("organization_id", access.org.id)
    : await supabase.from("org_units").insert({ ...fields, organization_id: access.org.id });
  if (error) return { ok: false, error: friendly(error) };
  return done(access, id ? "Saved" : `${access.org.unit_label} added`);
}

export async function deleteUnit(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("org_units").delete().eq("id", id.data).eq("organization_id", access.org.id);
  if (error) return { ok: false, error: error.code === "23503" ? "Move or remove what's inside it first." : friendly(error) };
  return done(access, "Removed");
}

export async function saveTeam(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z
    .object({
      id: z.string().optional().transform((v) => v || null),
      name: z.string().trim().min(1, "Enter a name").max(120),
      org_unit_id: optionalUuid,
      description: z.string().trim().max(1000).optional().transform((v) => v || null),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("teams").update(fields).eq("id", id).eq("organization_id", access.org.id)
    : await supabase.from("teams").insert({ ...fields, organization_id: access.org.id });
  if (error) return { ok: false, error: friendly(error) };
  return done(access, id ? "Saved" : "Team added");
}

export async function deleteTeam(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("teams").delete().eq("id", id.data).eq("organization_id", access.org.id).select("id");
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to remove teams." };
  return done(access, "Team removed. Its tasks stay in their projects without a team.");
}

export async function setTeamMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z
    .object({ team_id: uuid, user_id: uuid, role_id: z.string().optional(), op: z.enum(["set", "remove"]) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Choose a person and a role." };
  const { team_id, user_id, role_id, op } = parsed.data;
  const supabase = await createClient();
  if (op === "remove") {
    const { error } = await supabase.from("team_members").delete().eq("team_id", team_id).eq("user_id", user_id);
    if (error) return { ok: false, error: friendly(error) };
    return done(access, "Removed from team");
  }
  if (!role_id || !uuid.safeParse(role_id).success) return { ok: false, error: "Choose a team role." };
  const { error } = await supabase
    .from("team_members")
    .upsert({ team_id, organization_id: access.org.id, user_id, role_id }, { onConflict: "team_id,user_id" });
  if (error) return { ok: false, error: friendly(error) };
  return done(access, "Team updated");
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------
export async function saveRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const parsed = z
    .object({
      id: z.string().optional().transform((v) => v || null),
      scope: z.enum(["organization", "project", "team"]).optional(),
      name: z.string().trim().min(1, "Enter a name").max(60),
      description: z.string().trim().max(500).optional().transform((v) => v || null),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, scope, ...fields } = parsed.data;
  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase.from("roles").update(fields).eq("id", id).eq("organization_id", access.org.id).select("id");
    if (error) return { ok: false, error: friendly(error) };
    if (!data?.length) return { ok: false, error: "You don't have permission to edit roles." };
    return done(access, "Saved");
  }
  if (!scope) return { ok: false, error: "Choose where the role applies." };
  const { error } = await supabase.from("roles").insert({ ...fields, scope, organization_id: access.org.id });
  if (error) return { ok: false, error: friendly(error) };
  return done(access, "Role created. Now choose what it allows.");
}

export async function deleteRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("roles").delete().eq("id", id.data).eq("organization_id", access.org.id).select("id");
  if (error) return { ok: false, error: error.code === "23503" ? "People still hold this role. Give them another role first." : friendly(error) };
  if (!data?.length) return { ok: false, error: "You don't have permission to delete roles." };
  return done(access, "Role deleted");
}

/** Saves a role's full permission set from a checkbox form. */
export async function setRolePermissions(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await orgFromForm(formData);
  if (!access) return NO_ORG;
  const id = uuid.safeParse(formData.get("role_id"));
  if (!id.success) return { ok: false, error: "Invalid request." };
  const wanted = new Set(formData.getAll("permission").filter((p): p is string => typeof p === "string"));
  const supabase = await createClient();
  const { data: current, error: readErr } = await supabase.from("role_permissions").select("permission").eq("role_id", id.data);
  if (readErr) return { ok: false, error: friendly(readErr) };
  const have = new Set((current ?? []).map((r) => r.permission as string));
  const add = [...wanted].filter((p) => !have.has(p));
  const remove = [...have].filter((p) => !wanted.has(p));
  if (add.length) {
    const { error } = await supabase.from("role_permissions").insert(add.map((permission) => ({ role_id: id.data, permission })));
    if (error) return { ok: false, error: friendly(error) };
  }
  if (remove.length) {
    const { error } = await supabase.from("role_permissions").delete().eq("role_id", id.data).in("permission", remove);
    if (error) return { ok: false, error: friendly(error) };
  }
  return done(access, add.length || remove.length ? "Permissions saved" : "No changes");
}
