"use client";

/** The "web address" part of a name: /o/<slug> or /o/<org>/p/<slug>. */
export function SlugField({ prefix, value, onChange }: { prefix: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      Web address
      <span className="mt-1 flex items-center rounded-md border border-line bg-surface-muted text-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
        <span className="whitespace-nowrap pl-2.5 text-ink-muted">{prefix}</span>
        <input
          name="slug"
          required
          pattern="[a-z0-9]([a-z0-9\-]{0,46}[a-z0-9])?"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="w-full rounded-r-md bg-surface px-1 py-1.5 focus:outline-none"
        />
      </span>
      <span className="mt-1 block text-xs font-normal text-ink-muted">Lowercase letters, numbers and hyphens.</span>
    </label>
  );
}
