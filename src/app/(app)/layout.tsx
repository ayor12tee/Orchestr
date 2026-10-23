import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { visibleNav } from "@/lib/navigation";
import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const access = await getAccess();
  const nav = visibleNav(access);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="px-4 py-4">
          <Link href="/" className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-brand">ConTech Nigeria 2026</span>
            <span className="block text-sm font-semibold text-ink">Command Centre</span>
          </Link>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
          {nav.map((item) =>
            item.phase ? (
              <span
                key={item.href}
                className="flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-ink-muted/60"
                title={`Arrives in phase ${item.phase}`}
              >
                {item.label}
                <span className="text-[10px] uppercase tracking-wide">P{item.phase}</span>
              </span>
            ) : (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="hidden border-t border-line px-4 py-3 text-xs text-ink-muted lg:block">
          <p className="truncate font-medium text-ink">{access.fullName ?? access.email}</p>
          <p className="truncate">{access.roles.map((r) => r.label ?? r.title).join(", ") || "Department member"}</p>
          <form action={signOut} className="mt-2">
            <button className="text-brand hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
