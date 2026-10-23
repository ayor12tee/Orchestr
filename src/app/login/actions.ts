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
  // Self-serve: a new email gets an account and lands on "create your
  // organization". An account on its own grants nothing; access to any
  // organization still comes only from membership.
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${site}/auth/callback?next=${encodeURIComponent(parsed.data.next)}`,
    },
  });
  if (error?.status === 429) redirect("/login?error=Too+many+sign-in+emails.+Wait+a+minute+and+try+again.");
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
