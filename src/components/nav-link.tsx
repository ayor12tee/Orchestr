"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-md px-3 py-1.5 text-sm ${
        active ? "bg-brand-soft font-semibold text-brand" : "text-ink hover:bg-surface-muted"
      }`}
    >
      {children}
    </Link>
  );
}
