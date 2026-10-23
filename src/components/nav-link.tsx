"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, exact = false, children, tab = false }: { href: string; exact?: boolean; children: React.ReactNode; tab?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  if (tab) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={`shrink-0 border-b-2 px-3 py-2 text-sm ${active ? "border-brand font-semibold text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 truncate rounded-md px-3 py-1.5 text-sm ${active ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-surface-muted"}`}
    >
      {children}
    </Link>
  );
}
