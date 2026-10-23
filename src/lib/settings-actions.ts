"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/tasks/types";

/**
 * Settings leadership may edit here, each with its own validation. The
 * date convention and notification channel were confirmed by leadership
 * and are shown read-only: changing them would change the meaning of every
 * stored date, so that needs a deliberate migration, not a form.
 */
const EDITABLE = {
  indicators: z.object({ due_soon_days: z.coerce.number().int().min(1, "At least 1 day").max(60, "At most 60 days") }),
  progress: z.object({
    unverified_complete_credit: z.coerce.number().min(0, "Between 0 and 100%").max(1, "Between 0 and 100%"),
  }),
} as const;
export type EditableSettingKey = keyof typeof EDITABLE;

export async function updateSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = formData.get("key");
  if (typeof key !== "string" || !(key in EDITABLE)) return { ok: false, error: "That setting can't be edited here." };
  const raw = Object.fromEntries([...formData.entries()].filter(([k]) => !["key", "approval_state"].includes(k)));
  if (key === "progress" && typeof raw.unverified_complete_credit === "string") {
    raw.unverified_complete_credit = String(Number(raw.unverified_complete_credit) / 100); // the form asks for a percentage
  }
  const parsed = EDITABLE[key as EditableSettingKey].safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const approval_state = formData.get("approval_state") === "approved" ? "approved" : "suggested";

  const access = await getAccess();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conference_settings")
    .upsert({
      conference_id: access.conference.id,
      key,
      value: parsed.data,
      approval_state,
      updated_by: access.userId,
      updated_at: new Date().toISOString(),
    })
    .select("key");
  if (error || !data?.length) return { ok: false, error: "Only conference leadership can change settings." };
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/tasks");
  return { ok: true, message: approval_state === "approved" ? "Saved and approved" : "Saved as a suggestion" };
}
