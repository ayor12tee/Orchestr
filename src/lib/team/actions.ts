"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/tasks/types";

const ROLE_KEYS = ["ceo", "coo", "volunteer_lead", "team_member", "volunteer", "observer", "system_admin"] as const;
const LEADERSHIP = new Set(["ceo", "coo"]);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  full_name: z.string().trim().min(1, "Enter their name").max(200),
  role_key: z.enum(ROLE_KEYS),
  label: z.string().trim().max(100).transform((v) => v || null),
  department_id: z.string().transform((v) => v || null).pipe(z.string().uuid().nullable()),
  department_role: z.enum(["lead", "member"]).default("member"),
});

export async function inviteMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await getAccess();
  // Checked before anything is sent: the invite email itself is a side effect.
  if (!access.can("members.manage")) return { ok: false, error: "You don't have permission to invite people." };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const input = parsed.data;
  if (LEADERSHIP.has(input.role_key) && !access.roles.some((r) => LEADERSHIP.has(r.role_key))) {
    return { ok: false, error: "Only the CEO or COO can grant a leadership role." };
  }

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

  // From here on, writes go through the inviter's RLS client, so the database
  // checks members.manage again and the leadership guard applies.
  const supabase = await createClient();
  const { error: memErr } = await supabase.from("conference_memberships").upsert(
    { conference_id: access.conference.id, user_id: userId, role_key: input.role_key, label: input.label, status: "active", invited_by: access.userId },
    { onConflict: "conference_id,user_id,role_key" },
  );
  if (memErr) return { ok: false, error: memErr.code === "42501" ? memErr.message : "The role couldn't be assigned." };

  if (input.department_id) {
    const { error: depErr } = await supabase.from("department_memberships").upsert(
      { department_id: input.department_id, user_id: userId, department_role: input.department_role, status: "active" },
      { onConflict: "department_id,user_id" },
    );
    if (depErr) return { ok: false, error: "Role assigned, but the department membership couldn't be saved." };
  }

  revalidatePath("/team");
  return { ok: true, message: invited ? `Invitation sent to ${input.email}.` : `${input.email} already had an account; access updated.` };
}

export async function setMembershipStatus(formData: FormData) {
  const { id, status } = z.object({ id: z.string().uuid(), status: z.enum(["active", "revoked"]) }).parse(Object.fromEntries(formData));
  const supabase = await createClient();
  await supabase.from("conference_memberships").update({ status }).eq("id", id);
  revalidatePath("/team");
}

export async function setDepartmentMembership(formData: FormData) {
  const input = z
    .object({
      user_id: z.string().uuid(),
      department_id: z.string().uuid(),
      op: z.enum(["lead", "member", "revoke"]),
    })
    .parse(Object.fromEntries(formData));
  const supabase = await createClient();
  if (input.op === "revoke") {
    await supabase.from("department_memberships").update({ status: "revoked" }).eq("user_id", input.user_id).eq("department_id", input.department_id);
  } else {
    await supabase
      .from("department_memberships")
      .upsert({ user_id: input.user_id, department_id: input.department_id, department_role: input.op, status: "active" }, { onConflict: "department_id,user_id" });
  }
  revalidatePath("/team");
}
