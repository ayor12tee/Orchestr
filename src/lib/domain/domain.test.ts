// Run with: npm run test:domain  (Node's built-in runner, TypeScript stripped natively)
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { addDays, diffDays, earliestStartAfter, finishFromStart, isIsoDate, todayInLagos } from "./dates.ts";
import { downstreamOf, layeredLayout, validateDependency, type Dependency } from "./graph.ts";
import { computeSchedule, impactOfChange, impactOfFinishingOn, type ScheduleNode } from "./schedule.ts";
import { weightedProgress, type DeliverableProgressInput } from "./progress.ts";

const fs = (a: string, b: string, lagDays = 0): Dependency => ({
  predecessorId: a,
  successorId: b,
  type: "finish_to_start",
  lagDays,
});
const info = (a: string, b: string): Dependency => ({ predecessorId: a, successorId: b, type: "informational", lagDays: 0 });
const task = (id: string, extra: Partial<ScheduleNode> = {}): ScheduleNode => ({
  id,
  title: id,
  kind: "task",
  status: "not_started",
  ...extra,
});

describe("dates: calendar days, inclusive", () => {
  it("a 1-day task finishes the day it starts", () => {
    assert.equal(finishFromStart("2026-11-01", 1), "2026-11-01");
    assert.equal(finishFromStart("2026-11-01", 5), "2026-11-05");
  });
  it("FS successor starts the day after the predecessor finishes, plus lag", () => {
    assert.equal(earliestStartAfter("2026-11-05", 0), "2026-11-06");
    assert.equal(earliestStartAfter("2026-11-05", 2), "2026-11-08");
  });
  it("crosses month boundaries and counts weekends (calendar days)", () => {
    assert.equal(addDays("2026-10-30", 3), "2026-11-02");
    assert.equal(diffDays("2026-10-16", "2026-11-21"), 36);
  });
  it("rejects impossible dates", () => {
    assert.equal(isIsoDate("2026-02-30"), false);
    assert.equal(isIsoDate("2026-11-21"), true);
  });
  it("uses Lagos time for 'today'", () => {
    assert.equal(todayInLagos(new Date("2026-11-20T23:30:00Z")), "2026-11-21");
  });
});

describe("graph validation", () => {
  const ids = new Set(["A", "B", "C"]);
  it("rejects circular dependencies and reports the loop", () => {
    const err = validateDependency(fs("C", "A"), [fs("A", "B"), fs("B", "C")], ids);
    assert.equal(err?.code, "cycle");
    assert.deepEqual(err?.code === "cycle" && err.path, ["C", "A", "B", "C"]);
  });
  it("rejects self, duplicate, unknown and negative-lag edges", () => {
    assert.equal(validateDependency(fs("A", "A"), [], ids)?.code, "self_dependency");
    assert.equal(validateDependency(fs("A", "B"), [fs("A", "B")], ids)?.code, "duplicate");
    assert.equal(validateDependency(fs("A", "Z"), [], ids)?.code, "unknown_task");
    assert.equal(validateDependency(fs("A", "B", -1), [], ids)?.code, "invalid_lag");
  });
  it("accepts a valid edge", () => {
    assert.equal(validateDependency(fs("A", "C"), [fs("A", "B"), fs("B", "C")], ids), null);
  });
  it("downstream traversal can ignore informational links", () => {
    const deps = [fs("A", "B"), info("B", "C")];
    assert.deepEqual([...downstreamOf("A", deps)].sort(), ["B", "C"]);
    assert.deepEqual([...downstreamOf("A", deps, { blockingOnly: true })], ["B"]);
  });
});

describe("schedule forecast", () => {
  const today = "2026-10-16";

  it("FS dependency respects predecessor finish and lag", () => {
    const nodes = [
      task("A", { plannedStart: "2026-10-20", durationDays: 3 }), // 20..22
      task("B", { plannedStart: "2026-10-21", durationDays: 2 }),
    ];
    const r = computeSchedule(nodes, [fs("A", "B", 2)], today).nodes;
    assert.equal(r.get("A")!.forecastFinish, "2026-10-22");
    assert.equal(r.get("B")!.forecastStart, "2026-10-25"); // 22 + 1 + 2
    assert.equal(r.get("B")!.drivenBy, "A");
  });

  it("informational dependencies never block or move a task", () => {
    const nodes = [
      task("A", { plannedStart: "2026-10-20", durationDays: 10 }),
      task("B", { plannedStart: "2026-10-21", durationDays: 2 }),
    ];
    const r = computeSchedule(nodes, [info("A", "B")], today).nodes;
    assert.equal(r.get("B")!.forecastStart, "2026-10-21");
    assert.equal(r.get("B")!.dependenciesSatisfied, true);
  });

  it("a successor isn't ready until its FS predecessor completes, unless an exception is approved", () => {
    const nodes = [task("A", { plannedStart: "2026-10-20", durationDays: 1 }), task("B", { plannedStart: "2026-10-22", durationDays: 1 })];
    assert.equal(computeSchedule(nodes, [fs("A", "B")], today).nodes.get("B")!.dependenciesSatisfied, false);
    const waived = [{ ...fs("A", "B"), exceptionApproved: true }];
    assert.equal(computeSchedule(nodes, waived, today).nodes.get("B")!.dependenciesSatisfied, true);
  });

  it("multiple predecessors: start satisfies all of them", () => {
    const nodes = [
      task("A", { plannedStart: "2026-10-20", durationDays: 2 }), // ends 21
      task("B", { plannedStart: "2026-10-20", durationDays: 6 }), // ends 25
      task("C", { plannedStart: "2026-10-20", durationDays: 1 }),
    ];
    const r = computeSchedule(nodes, [fs("A", "C"), fs("B", "C")], today).nodes;
    assert.equal(r.get("C")!.forecastStart, "2026-10-26");
    assert.equal(r.get("C")!.drivenBy, "B");
  });

  it("unfinished overdue work is forecast to finish no earlier than today", () => {
    const nodes = [task("A", { status: "in_progress", actualStart: "2026-10-01", plannedFinish: "2026-10-05", durationDays: 5 })];
    const a = computeSchedule(nodes, [], today).nodes.get("A")!;
    assert.equal(a.forecastFinish, today);
    assert.equal(a.varianceToPlanDays, 11);
  });

  it("completed tasks use the actual finish date", () => {
    const nodes = [task("A", { status: "completed", actualStart: "2026-10-01", actualFinish: "2026-10-03", plannedFinish: "2026-10-02" })];
    assert.equal(computeSchedule(nodes, [], today).nodes.get("A")!.forecastFinish, "2026-10-03");
  });

  it("missing estimates give an explicit unknown state that flows downstream", () => {
    const nodes = [task("A", { plannedStart: "2026-10-20" }), task("B", { plannedStart: "2026-10-25", durationDays: 1 })];
    const r = computeSchedule(nodes, [fs("A", "B")], today).nodes;
    assert.equal(r.get("A")!.state, "unknown");
    assert.deepEqual(r.get("A")!.missing, [{ kind: "duration", taskId: "A" }]);
    assert.equal(r.get("B")!.state, "unknown");
    assert.equal(r.get("B")!.missing[0].kind, "upstream_unknown");
  });

  it("baseline variance is reported without touching the baseline", () => {
    const n = task("A", { plannedStart: "2026-10-20", durationDays: 3, plannedFinish: "2026-10-24", baselineFinish: "2026-10-21" });
    const r = computeSchedule([n], [], today).nodes.get("A")!;
    assert.equal(r.varianceToBaselineDays, 1);
    assert.equal(r.varianceToPlanDays, -2);
    assert.equal(n.baselineFinish, "2026-10-21");
  });
});

describe("impact of a change", () => {
  const today = "2026-10-16";
  // A -> B -> M (milestone), A -> C (has 5 days slack), D independent.
  const nodes: ScheduleNode[] = [
    task("A", { plannedStart: "2026-10-20", durationDays: 3, plannedFinish: "2026-10-22" }),
    task("B", { plannedStart: "2026-10-23", durationDays: 2, plannedFinish: "2026-10-24" }),
    task("C", { plannedStart: "2026-10-28", durationDays: 1, plannedFinish: "2026-10-28" }),
    task("D", { plannedStart: "2026-10-20", durationDays: 2, plannedFinish: "2026-10-21" }),
    { id: "M", title: "Programme published", kind: "milestone", status: "not_started", plannedFinish: "2026-10-24" },
  ];
  const deps = [fs("A", "B"), fs("B", "M"), fs("A", "C")];

  it("propagates only through dependent work, absorbs slack, leaves parallel work alone", () => {
    const r = impactOfChange(nodes, deps, today, "A", { durationDays: 6 }); // A now ends 25, +3
    const byId = Object.fromEntries(r.affected.map((e) => [e.id, e]));
    assert.equal(byId.B.shiftDays, 3);
    assert.equal(byId.M.shiftDays, 3);
    assert.equal(byId.M.breachesPlan, true);
    assert.equal(byId.C, undefined, "C had slack and shouldn't move");
    assert.ok(r.absorbed.includes("C"));
    assert.equal(byId.D, undefined, "independent work isn't postponed");
    assert.equal(r.quantifiable, true);
  });

  it("removing an estimate reports impact as not yet quantifiable, with the inputs needed", () => {
    const r = impactOfChange(nodes, deps, today, "A", { durationDays: null, plannedFinish: null });
    assert.equal(r.quantifiable, false);
    assert.ok(r.affected.every((e) => e.becameUnknown));
    assert.ok(r.missing.some((m) => m.kind === "upstream_unknown"));
  });
});

describe("weighted progress", () => {
  const d = (over: Partial<DeliverableProgressInput>): DeliverableProgressInput => ({
    id: "x",
    title: "x",
    weight: 1,
    weightApproved: true,
    reportedCompletion: 0,
    requiresEvidence: false,
    hasEvidence: false,
    requiresReview: false,
    reviewApproved: false,
    ...over,
  });

  it("computes Σwc/Σw", () => {
    const r = weightedProgress([d({ id: "a", weight: 3, reportedCompletion: 1 }), d({ id: "b", weight: 1, reportedCompletion: 0 })]);
    assert.equal(r.percent, 75);
    assert.equal(r.status, "approved");
  });

  it("'Completed' without the required evidence earns no credit by default", () => {
    const r = weightedProgress([d({ reportedCompletion: 1, requiresEvidence: true })]);
    assert.equal(r.percent, 0);
    assert.equal(r.awaitingVerificationPercent, 100);
    assert.deepEqual(r.gaps, [{ kind: "awaiting_evidence", deliverableId: "x" }]);
  });

  it("is provisional with unapproved weights and unavailable with none", () => {
    assert.equal(weightedProgress([d({ weightApproved: false })]).status, "provisional");
    const none = weightedProgress([d({ weight: null })]);
    assert.equal(none.status, "unavailable");
    assert.equal(none.percent, null);
  });
});

import { taskIndicators } from "./indicators.ts";

describe("task indicators", () => {
  const base = {
    status: "in_progress" as const,
    due_date: "2026-10-20",
    accountable_owner_id: "u1",
    acceptance_criteria: "Signed letter on file",
    planning_state: "approved" as const,
    is_critical: false,
  };
  const kinds = (over: Partial<typeof base> | Record<string, unknown>, today = "2026-10-16") =>
    taskIndicators({ ...base, ...over } as never, today, { dueSoonDays: 7 }).map((i) => i.kind);

  it("due today is not overdue (inclusive due dates); the day after is", () => {
    assert.deepEqual(kinds({}, "2026-10-20"), ["due_soon"]);
    assert.deepEqual(kinds({}, "2026-10-21"), ["overdue"]);
  });
  it("blocked and overdue can both apply", () => {
    assert.deepEqual(kinds({ status: "blocked" }, "2026-10-25"), ["overdue", "blocked"]);
  });
  it("completed work is never overdue or incomplete", () => {
    assert.deepEqual(kinds({ status: "completed", accountable_owner_id: null }, "2026-10-25"), []);
  });
  it("flags missing planning information and suggested values", () => {
    const [i] = taskIndicators({ ...base, accountable_owner_id: null, due_date: null, acceptance_criteria: "" }, "2026-10-16", { dueSoonDays: 7 });
    assert.deepEqual(i, { kind: "planning_incomplete", missing: ["owner", "due_date", "acceptance_criteria"] });
    assert.ok(kinds({ planning_state: "suggested" }).includes("suggested"));
  });
});

describe("what-if: finishing on a different date", () => {
  const today = "2026-10-16";
  const nodes: ScheduleNode[] = [
    task("A", { plannedStart: "2026-10-20", durationDays: 3, plannedFinish: "2026-10-22" }),
    task("B", { plannedStart: "2026-10-23", durationDays: 2, plannedFinish: "2026-10-24" }),
    { id: "M", title: "Programme published", kind: "milestone", status: "not_started", plannedFinish: "2026-10-26" },
  ];
  const deps = [fs("A", "B"), fs("B", "M")];

  it("a 3-day slip moves the successor 3 days and is absorbed by the milestone's slack", () => {
    const r = impactOfFinishingOn(nodes, deps, today, "A", "2026-10-25");
    const byId = Object.fromEntries(r.affected.map((e) => [e.id, e]));
    assert.equal(byId.B.shiftDays, 3);
    assert.equal(byId.B.after, "2026-10-27");
    assert.equal(byId.M.shiftDays, 1, "M was planned 2 days after B, so only 1 of the 3 days reaches it");
    assert.equal(byId.M.breachesPlan, true);
  });
  it("finishing earlier never pulls a dependent task before its own plan", () => {
    const r = impactOfFinishingOn(nodes, deps, today, "A", "2026-10-20");
    assert.equal(r.affected.length, 0);
  });
});

describe("dependency map layout", () => {
  it("places each task one column after its furthest predecessor", () => {
    const deps = [fs("A", "B"), fs("B", "C"), fs("A", "C"), info("D", "C")];
    const cols = layeredLayout(["A", "B", "C", "D", "E"], deps);
    assert.deepEqual(cols.map((c) => [...c].sort()), [["A", "D", "E"], ["B"], ["C"]]);
  });
  it("orders a column to sit next to its neighbours", () => {
    // X1 feeds Y2, X2 feeds Y1: the second column flips to avoid a crossing.
    const cols = layeredLayout(["X1", "X2", "Y1", "Y2"], [fs("X1", "Y2"), fs("X2", "Y1")]);
    assert.deepEqual(cols, [["X1", "X2"], ["Y2", "Y1"]]);
  });
});
