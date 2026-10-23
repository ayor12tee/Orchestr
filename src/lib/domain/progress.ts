/**
 * Evidence-aware weighted progress (brief §5 B5).
 *
 *   Weighted progress = Σ wᵢ·cᵢ / Σ wᵢ × 100
 *
 * wᵢ is a deliverable's approved weight and cᵢ its verified completion (0..1).
 * A deliverable marked completed only earns credit if its workflow
 * requirements (evidence, review) are met. Unapproved or missing weights make
 * the result provisional, never silently precise.
 */

export interface DeliverableProgressInput {
  id: string;
  title: string;
  /** Approved weight. Null means no weight has been set. */
  weight: number | null;
  weightApproved: boolean;
  /** Self-reported completion fraction, 0..1. */
  reportedCompletion: number;
  requiresEvidence: boolean;
  hasEvidence: boolean;
  requiresReview: boolean;
  reviewApproved: boolean;
}

export type ProgressGap =
  | { kind: "missing_weight"; deliverableId: string }
  | { kind: "unapproved_weight"; deliverableId: string }
  | { kind: "awaiting_evidence"; deliverableId: string }
  | { kind: "awaiting_review"; deliverableId: string };

export interface WeightedProgress {
  /** 0..100, or null when nothing can be calculated. */
  percent: number | null;
  /** Further progress reported as done but not yet verified, shown separately. */
  awaitingVerificationPercent: number | null;
  status: "approved" | "provisional" | "unavailable";
  /** Per-deliverable credit actually counted, for the drill-down view. */
  breakdown: { id: string; title: string; weight: number | null; reported: number; verified: number }[];
  gaps: ProgressGap[];
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

export interface ProgressOptions {
  /**
   * Credit (0..1) given to a deliverable reported as complete whose evidence
   * or review gate isn't satisfied yet. Leadership sets this in conference
   * settings. Defaults to 0: unverified work earns nothing until verified.
   */
  unverifiedCompleteCredit?: number;
}

/** Completion credit after applying the evidence/review gates. */
export function verifiedCompletion(
  d: DeliverableProgressInput,
  options: ProgressOptions = {},
): { value: number; gaps: ProgressGap[] } {
  const reported = clamp01(d.reportedCompletion);
  const gaps: ProgressGap[] = [];
  if (reported < 1) return { value: reported, gaps };
  if (d.requiresEvidence && !d.hasEvidence) gaps.push({ kind: "awaiting_evidence", deliverableId: d.id });
  if (d.requiresReview && !d.reviewApproved) gaps.push({ kind: "awaiting_review", deliverableId: d.id });
  return { value: gaps.length > 0 ? clamp01(options.unverifiedCompleteCredit ?? 0) : 1, gaps };
}

export function weightedProgress(
  deliverables: readonly DeliverableProgressInput[],
  options: ProgressOptions = {},
): WeightedProgress {
  const gaps: ProgressGap[] = [];
  const breakdown: WeightedProgress["breakdown"] = [];
  let num = 0;
  let den = 0;
  let pendingNum = 0;

  for (const d of deliverables) {
    const v = verifiedCompletion(d, options);
    gaps.push(...v.gaps);
    breakdown.push({ id: d.id, title: d.title, weight: d.weight, reported: clamp01(d.reportedCompletion), verified: v.value });
    if (d.weight === null || !(d.weight > 0)) {
      gaps.push({ kind: "missing_weight", deliverableId: d.id });
      continue;
    }
    if (!d.weightApproved) gaps.push({ kind: "unapproved_weight", deliverableId: d.id });
    num += d.weight * v.value;
    den += d.weight;
    pendingNum += d.weight * (clamp01(d.reportedCompletion) - v.value);
  }

  if (den === 0) return { percent: null, awaitingVerificationPercent: null, status: "unavailable", breakdown, gaps };
  const provisional = gaps.some((g) => g.kind === "missing_weight" || g.kind === "unapproved_weight");
  const pct = (x: number) => Math.round((x / den) * 1000) / 10;
  return {
    percent: pct(num),
    awaitingVerificationPercent: pct(pendingNum),
    status: provisional ? "provisional" : "approved",
    breakdown,
    gaps,
  };
}
