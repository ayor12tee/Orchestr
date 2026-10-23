"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  next: z.string().startsWith("/").default("/"),
});

export async function sendSignInLink(formData: FormData) {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/login?error=Enter+a+valid+email+address");

  const supabase = await createClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  // shouldCreateUser: false makes this invitation-only: unknown emails get no account.
  await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`,
    },
  });
  // Same response whether or not the email was invited, so the form can't be
  // used to discover who has access.
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
