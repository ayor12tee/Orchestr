"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function OrgSwitcher({ current, orgs }: { current: { slug: string; name: string }; orgs: { slug: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-muted"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-brand">Orchestr</span>
          <span className="block truncate text-sm font-semibold text-ink">{current.name}</span>
        </span>
        <span aria-hidden className="text-xs text-ink-muted">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute left-0 right-0 z-40 mt-1 rounded-md border border-line bg-surface py-1 shadow-lg">
          {orgs.map((o) => (
            <Link
              key={o.slug}
              role="menuitem"
              href={`/o/${o.slug}`}
              onClick={() => setOpen(false)}
              className={`block truncate px-3 py-1.5 text-sm hover:bg-surface-muted ${o.slug === current.slug ? "font-semibold text-brand" : "text-ink"}`}
            >
              {o.name}
            </Link>
          ))}
          <div className="my-1 border-t border-line" />
          <Link role="menuitem" href="/onboarding" onClick={() => setOpen(false)} className="block px-3 py-1.5 text-sm text-brand hover:bg-surface-muted">
            + Create organization
          </Link>
        </div>
      )}
    </div>
  );
}
