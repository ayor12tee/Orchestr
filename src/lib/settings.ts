import { cache } from "react";
import { getAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInLagos } from "@/lib/domain/dates";

export interface ConferenceSettings {
  dueSoonDays: number;
  dueSoonApproved: boolean;
  unverifiedCompleteCredit: number;
  today: string;
}

export const getSettings = cache(async (): Promise<ConferenceSettings> => {
  const access = await getAccess();
  const supabase = await createClient();
  const { data } = await supabase
    .from("conference_settings")
    .select("key, value, approval_state")
    .eq("conference_id", access.conference.id);
  const byKey = new Map((data ?? []).map((r) => [r.key as string, r]));
  const indicators = byKey.get("indicators");
  return {
    dueSoonDays: Number(indicators?.value?.due_soon_days ?? 7),
    dueSoonApproved: indicators?.approval_state === "approved",
    unverifiedCompleteCredit: Number(byKey.get("progress")?.value?.unverified_complete_credit ?? 0),
    today: todayInLagos(),
  };
});
