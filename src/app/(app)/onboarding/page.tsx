import Link from "next/link";
import { getMyOrganizations, getUser } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { CreateOrganizationForm } from "./create-organization-form";

export const metadata = { title: "Create your organization · Orchestr" };

export default async function Onboarding() {
  const user = await getUser();
  const orgs = await getMyOrganizations();
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">Orchestr</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Create your organization</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your organization is your private workspace. You&apos;ll set up its teams, roles and projects next, and invite people when you&apos;re ready.
        </p>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-sm">
          <CreateOrganizationForm />
        </div>
        {orgs.length > 0 && (
          <p className="mt-4 text-sm text-ink-muted">
            Or go back to{" "}
            {orgs.map((o, i) => (
              <span key={o.id}>{i > 0 && ", "}<Link href={`/o/${o.slug}`} className="text-brand hover:underline">{o.name}</Link></span>
            ))}
            .
          </p>
        )}
        <form action={signOut} className="mt-6 text-xs text-ink-muted">
          Signed in as {user.email} · <button className="text-brand hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
