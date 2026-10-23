import Link from "next/link";
import { getMyOrganizations, getOrgAccess } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";
import { OrgSwitcher } from "@/components/org-switcher";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: orgSlug } = await params;
  const access = await getOrgAccess(orgSlug);
  const orgs = await getMyOrganizations();
  const supabase = await createClient();
  // RLS returns only projects this user can see.
  const { data: projects } = await supabase
    .from("projects")
    .select("slug, name, status")
    .eq("organization_id", access.org.id)
    .neq("status", "archived")
    .order("name");
  const base = access.base;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="px-3 py-3">
          <OrgSwitcher current={{ slug: access.org.slug, name: access.org.name }} orgs={orgs.map((o) => ({ slug: o.slug, name: o.name }))} />
        </div>
        <nav aria-label="Organization" className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          <NavLink href={base} exact>Overview</NavLink>
          <NavLink href={`${base}/people`}>People</NavLink>
          <NavLink href={`${base}/structure`}>Teams &amp; structure</NavLink>
          {(access.can("roles.manage") || access.can("members.manage")) && <NavLink href={`${base}/roles`}>Roles &amp; permissions</NavLink>}
          {access.can("org.manage") && <NavLink href={`${base}/settings`}>Settings</NavLink>}
        </nav>
        <div className="hidden px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted lg:block">Projects</div>
        <nav aria-label="Projects" className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
          {(projects ?? []).map((p) => (
            <NavLink key={p.slug} href={`${base}/p/${p.slug}`}>{p.name}</NavLink>
          ))}
          {access.can("projects.create") && (
            <Link href={`${base}/projects/new`} className="shrink-0 rounded-md px-3 py-1.5 text-sm text-brand hover:bg-surface-muted">+ New project</Link>
          )}
          {!projects?.length && !access.can("projects.create") && (
            <p className="px-3 py-1.5 text-xs text-ink-muted">You haven&apos;t been added to a project yet.</p>
          )}
        </nav>
        <div className="hidden border-t border-line px-4 py-3 text-xs text-ink-muted lg:block">
          <p className="truncate font-medium text-ink">{access.user.fullName ?? access.user.email}</p>
          <form action={signOut} className="mt-1">
            <button className="text-brand hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
