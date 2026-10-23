import Link from "next/link";
import type { Tone } from "@/lib/domain/indicators";

const TONE: Record<Tone, string> = {
  green: "bg-status-green-bg text-status-green",
  amber: "bg-status-amber-bg text-status-amber",
  red: "bg-status-red-bg text-status-red",
  grey: "bg-status-grey-bg text-status-grey",
};

export function Badge({ tone = "grey", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {title && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A metric that always opens the records behind it (brief §5 A, §9.3). */
export function Metric({ label, value, href, tone, hint }: { label: string; value: React.ReactNode; href: string; tone?: Tone; hint?: string }) {
  const color = tone ? { green: "text-status-green", amber: "text-status-amber", red: "text-status-red", grey: "text-status-grey" }[tone] : "text-ink";
  return (
    <Link href={href} className="block rounded-lg border border-line bg-surface p-4 hover:border-brand focus-visible:outline-2 focus-visible:outline-brand">
      <span className="block text-xs font-medium text-ink-muted">{label}</span>
      <span className={`mt-1 block text-2xl font-semibold tabular-nums ${color}`}>{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}
    </Link>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">{children}</p>;
}

export const buttonClass =
  "inline-flex items-center justify-center rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-50";
export const inputClass =
  "mt-1 block w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";
