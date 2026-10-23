/**
 * One-time bootstrap: invite the CEO/Convener and COO and give them their
 * leadership roles. Everyone else is invited from inside the app.
 *
 *   node --env-file=.env.local scripts/bootstrap-leadership.ts <ceo-email> <coo-email>
 *
 * Safe to rerun: existing accounts and roles are reused, not duplicated.
 */
import { createClient } from "@supabase/supabase-js";

const [ceoEmail, cooEmail] = process.argv.slice(2).map((e) => e?.trim().toLowerCase());
if (!ceoEmail || !cooEmail || !ceoEmail.includes("@") || !cooEmail.includes("@")) {
  console.error("Usage: node --env-file=.env.local scripts/bootstrap-leadership.ts <ceo-email> <coo-email>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const slug = process.env.CONFERENCE_SLUG ?? "contech-nigeria-2026";
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: conference, error: confErr } = await admin.from("conferences").select("id").eq("slug", slug).single();
if (confErr || !conference) {
  console.error(`Conference "${slug}" not found. Run the migrations and supabase/seed.sql first.`);
  process.exit(1);
}

async function ensureUser(email: string): Promise<string> {
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/welcome` });
  if (error || !data.user) throw new Error(`Invite to ${email} failed: ${error?.message}`);
  console.log(`Invitation sent to ${email}`);
  return data.user.id;
}

for (const [role, email] of [["ceo", ceoEmail], ["coo", cooEmail]] as const) {
  const userId = await ensureUser(email);
  const { error } = await admin
    .from("conference_memberships")
    .upsert(
      { conference_id: conference.id, user_id: userId, role_key: role, status: "active" },
      { onConflict: "conference_id,user_id,role_key", ignoreDuplicates: true },
    );
  if (error) throw error;
  console.log(`${role.toUpperCase()}: ${email} ✔`);
}
