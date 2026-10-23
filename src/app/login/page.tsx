import { sendSignInLink } from "./actions";

export const metadata = { title: "Sign in · Orchestr" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const { sent, error, next } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Orchestr</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Turn plans into coordinated execution</h1>
        <p className="mt-2 text-sm text-ink-muted">Sign in, or create an account, with a link sent to your email. No password needed.</p>

        {sent ? (
          <p role="status" className="mt-6 rounded-md bg-status-green-bg p-3 text-sm text-status-green">
            A sign-in link is on its way. Check your inbox, and open the link in this browser.
          </p>
        ) : (
          <form action={sendSignInLink} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next ?? "/"} />
            <label className="block text-sm font-medium text-ink">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 block w-full rounded-md border border-line px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-status-red">
                {error}
              </p>
            )}
            <button className="w-full rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong">
              Email me a sign-in link
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
