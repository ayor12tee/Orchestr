"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Landing page for invitation links sent with Supabase's default email
 * template. That template signs the user in through Supabase and redirects
 * here with the session in the URL fragment (#access_token=...), which never
 * reaches the server, so it has to be picked up in the browser.
 *
 * Once custom SMTP is configured, the token_hash template and /auth/confirm
 * can be used instead.
 */
export default function WelcomePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Don't leave tokens in the address bar or browser history.
    window.history.replaceState(null, "", window.location.pathname);

    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      setError(params.get("error_description") ?? "That link has expired or was already used.");
      return;
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { detectSessionInUrl: false } },
    );
    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(({ error }) => {
      if (error) setError("That link has expired or was already used.");
      // Full navigation so the server sees the new session cookie.
      else window.location.replace("/");
    });
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">ConTech Nigeria 2026</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Conference Command Centre</h1>
        {error ? (
          <>
            <p role="alert" className="mt-4 text-sm text-status-red">
              {error}
            </p>
            <a href="/login" className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
              Request a new sign-in link
            </a>
          </>
        ) : (
          <p role="status" className="mt-4 text-sm text-ink-muted">
            Signing you in…
          </p>
        )}
      </div>
    </main>
  );
}
