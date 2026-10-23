import { signOut } from "@/app/login/actions";

export default function NoAccess() {
  return (
    <main className="min-h-screen grid place-items-center bg-surface-muted px-4">
      <div className="max-w-md rounded-xl border border-line bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">No active conference access</h1>
        <p className="mt-2 text-sm text-ink-muted">
          You&apos;re signed in, but you don&apos;t have an active role on ConTech Nigeria 2026. Your access may have
          been revoked, or your invitation hasn&apos;t been completed. Contact the COO or CEO.
        </p>
        <form action={signOut} className="mt-6">
          <button className="rounded-md border border-line px-4 py-2 text-sm font-medium">Sign out</button>
        </form>
      </div>
    </main>
  );
}
