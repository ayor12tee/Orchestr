/** "Sat 21 Nov" for an ISO calendar date. Dates have no time, so format in UTC. */
export function formatDay(iso: string | null | undefined, fallback = "Not set"): string {
  if (!iso) return fallback;
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** "+3 days", "−1 day", "on time" */
export function formatShift(days: number): string {
  if (days === 0) return "on time";
  const n = Math.abs(days);
  return `${days > 0 ? "+" : "−"}${n} day${n === 1 ? "" : "s"}`;
}
