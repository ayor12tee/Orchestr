import { sendSignInLink } from "./actions";

export const metadata = { title: "Sign in · ConTech Command Centre" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const { sent, error, next } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">ConTech Nigeria 2026</p>
        <h1 className="mt-1 text-xl font-semibold text-ink">Conference Command Centre</h1>
        <p className="mt-2 text-sm text-ink-muted">Access is by invitation only.</p>

        {sent ? (
          <p role="status" className="mt-6 rounded-md bg-status-green-bg p-3 text-sm text-status-green">
            If this email has been invited, a sign-in link is on its way. Check your inbox.
          </p>
        ) : (
          <form action={sendSignInLink} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={next ?? "/"} />
            <label className="block text-sm font-medium text-ink">
              Work email
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
