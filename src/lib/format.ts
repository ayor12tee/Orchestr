/** "Sat 21 Nov" for an ISO calendar date. Dates have no time, so format in UTC. */
export function formatDay(iso: string | null | undefined, fallback = "Not set"): string {
  if (!iso) return fallback;
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Sat 21 Nov 2026", for dates that may be in another year. */
export function formatDate(iso: string | null | undefined, fallback = "Not set"): string {
  if (!iso) return fallback;
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A URL-safe handle from a name: "Acme Events Ltd" → "acme-events-ltd". */
export function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
}

/** "+3 days", "−1 day", "on time" */
export function formatShift(days: number): string {
  if (days === 0) return "on time";
  const n = Math.abs(days);
  return `${days > 0 ? "+" : "−"}${n} day${n === 1 ? "" : "s"}`;
}
