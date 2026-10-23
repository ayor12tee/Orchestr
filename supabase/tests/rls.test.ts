// Permission acceptance tests (brief §15.2) against the real migrations.
// Run with: npm run test:db
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");
const db = new PGlite();

const U = {
  ceo: "00000000-0000-0000-0000-0000000000c1",
  coo: "00000000-0000-0000-0000-0000000000c2",
  lead: "00000000-0000-0000-0000-0000000000d1",
  member: "00000000-0000-0000-0000-0000000000e1",
  outsider: "00000000-0000-0000-0000-0000000000e2",
  observer: "00000000-0000-0000-0000-0000000000f1",
  admin: "00000000-0000-0000-0000-0000000000a1",
};
const CONF = "11111111-1111-1111-1111-111111111111";
const SPONSOR = "22222222-2222-2222-2222-222222222221";
const FINANCE = "22222222-2222-2222-2222-222222222222";

/** Runs `sql` as `user` with the `authenticated` role, so RLS applies. */
async function rows<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  let out: T[] = [];
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    await tx.exec(`set local role authenticated`);
    out = (await tx.query<T>(sql, params)).rows;
  });
  return out;
}
const denied = (p: Promise<unknown>) => assert.rejects(p, (e: Error) => /permission|row-level security|violates|cannot|do not have|not its|needs review|Only conference leadership|authorised approver/i.test(e.message));

before(async () => {
  await db.exec(readFileSync(join(root, "tests", "supabase-stubs.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  const people = Object.entries(U).map(([k, id]) => `('${id}', '${k}@example.test')`).join(",");
  await db.exec(`
    insert into auth.users (id, email) values ${people};
    update public.profiles set full_name = email, phone = '+234-000';
    insert into public.conferences (id, slug, name, event_date) values ('${CONF}', 'contech-2026', 'ConTech Nigeria 2026 Conference', '2026-11-21');
    insert into public.departments (id, conference_id, slug, name) values
      ('${SPONSOR}', '${CONF}', 'sponsorship', 'Sponsorship'), ('${FINANCE}', '${CONF}', 'finance', 'Finance');
    insert into public.conference_memberships (conference_id, user_id, role_key) values
      ('${CONF}', '${U.ceo}', 'ceo'), ('${CONF}', '${U.coo}', 'coo'),
      ('${CONF}', '${U.lead}', 'team_member'), ('${CONF}', '${U.member}', 'team_member'),
      ('${CONF}', '${U.outsider}', 'team_member'), ('${CONF}', '${U.observer}', 'observer'),
      ('${CONF}', '${U.admin}', 'system_admin');
    insert into public.department_memberships (department_id, user_id, department_role) values
      ('${SPONSOR}', '${U.lead}', 'lead'), ('${SPONSOR}', '${U.member}', 'member');
  `);
});

async function makeTask(user: string, dept: string | null, extra = "") {
  const [t] = await rows<{ id: string }>(
    user,
    `insert into public.tasks (conference_id, department_id, title ${extra ? ", " + extra.split("=")[0] : ""})
     values ($1, $2, 'Send initial sponsor outreach' ${extra ? ", " + extra.split("=")[1] : ""}) returning id`,
    [CONF, dept],
  );
  return t.id;
}

describe("CEO / COO parity", () => {
  it("CEO and COO resolve to exactly the same permissions", async () => {
    const q = `select permission from public.my_permissions($1) order by 1`;
    const ceo = (await rows<{ permission: string }>(U.ceo, q, [CONF])).map((r) => r.permission);
    const coo = (await rows<{ permission: string }>(U.coo, q, [CONF])).map((r) => r.permission);
    assert.ok(ceo.length > 10);
    assert.deepEqual(ceo, coo);
    assert.ok(ceo.includes("approvals.decide") && ceo.includes("finance.view"));
  });
  it("the shared profile can't be split by editing the role table", async () => {
    await assert.rejects(db.exec(`update public.organisational_roles set permission_profile = 'observer' where key = 'coo'`), /leadership_parity/);
  });
  it("the COO can reassign the CEO's task and vice versa", async () => {
    const id = await makeTask(U.ceo, null);
    await rows(U.coo, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.member]);
    await rows(U.ceo, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.lead]);
  });
});

describe("department leads and members", () => {
  it("a lead can create and edit tasks in their department only", async () => {
    const id = await makeTask(U.lead, SPONSOR);
    await rows(U.lead, `update public.tasks set title = 'Edited' where id = $1`, [id]);
    await denied(rows(U.lead, `insert into public.tasks (conference_id, department_id, title) values ($1, $2, 'x')`, [CONF, FINANCE]));
  });
  it("a lead can't see another department's tasks", async () => {
    await makeTask(U.ceo, FINANCE);
    const seen = await rows(U.lead, `select 1 from public.tasks where department_id = $1`, [FINANCE]);
    assert.equal(seen.length, 0);
  });
  it("an assignee can move progress but can't rewrite or reassign the task", async () => {
    const id = await makeTask(U.ceo, FINANCE, "requires_review=true");
    await rows(U.ceo, `insert into public.task_assignees (task_id, user_id) values ($1, $2)`, [id, U.outsider]);
    const [t] = await rows<{ status: string; actual_start: string | null; version: number }>(
      U.outsider, `update public.tasks set status = 'in_progress' where id = $1 returning status, actual_start, version`, [id]);
    assert.equal(t.status, "in_progress");
    assert.ok(t.actual_start, "actual start is recorded automatically");
    assert.equal(t.version, 2);
    await denied(rows(U.outsider, `update public.tasks set title = 'Mine now' where id = $1`, [id]));
    await denied(rows(U.outsider, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.outsider]));
    await denied(rows(U.outsider, `update public.tasks set status = 'completed' where id = $1`, [id]));
    await rows(U.outsider, `update public.tasks set status = 'submitted_for_review' where id = $1`, [id]);
  });
  it("only leadership can approve planning values", async () => {
    const id = await makeTask(U.lead, SPONSOR);
    await denied(rows(U.lead, `update public.tasks set planning_state = 'approved' where id = $1`, [id]));
    const [t] = await rows<{ planning_state: string }>(U.lead,
      `insert into public.tasks (conference_id, department_id, title, planning_state) values ($1, $2, 'x', 'approved') returning planning_state`, [CONF, SPONSOR]);
    assert.equal(t.planning_state, "suggested");
    await rows(U.coo, `update public.tasks set planning_state = 'approved' where id = $1`, [id]);
  });
  it("blocking a task requires a reason", async () => {
    const id = await makeTask(U.ceo, null);
    await assert.rejects(rows(U.ceo, `update public.tasks set status = 'blocked' where id = $1`, [id]), /blocked_needs_reason/);
  });
});

describe("observers and admins", () => {
  it("an observer can't create or see tasks", async () => {
    await denied(rows(U.observer, `insert into public.tasks (conference_id, title) values ($1, 'x')`, [CONF]));
    assert.equal((await rows(U.observer, `select 1 from public.tasks`)).length, 0);
  });
  it("a system admin has no approval or finance authority", async () => {
    const perms = (await rows<{ permission: string }>(U.admin, `select permission from public.my_permissions($1)`, [CONF])).map((r) => r.permission);
    assert.ok(perms.includes("members.manage"));
    assert.ok(!perms.includes("approvals.decide") && !perms.includes("finance.view") && !perms.includes("tasks.view"));
  });
  it("a system admin can't make anyone CEO or COO, but leadership can", async () => {
    await denied(rows(U.admin, `insert into public.conference_memberships (conference_id, user_id, role_key) values ($1, $2, 'coo')`, [CONF, U.admin]));
    await rows(U.ceo, `insert into public.conference_memberships (conference_id, user_id, role_key) values ($1, $2, 'observer')`, [CONF, U.lead]);
  });
});

describe("revocation, personal data and audit", () => {
  it("a revoked membership loses access immediately", async () => {
    const id = await makeTask(U.ceo, SPONSOR);
    assert.equal((await rows(U.member, `select 1 from public.tasks where id = $1`, [id])).length, 1);
    await db.exec(`update public.department_memberships set status = 'revoked' where user_id = '${U.member}'`);
    assert.equal((await rows(U.member, `select 1 from public.tasks where id = $1`, [id])).length, 0);
    await db.exec(`update public.department_memberships set status = 'active' where user_id = '${U.member}'`);
  });
  it("a deactivated profile loses access even with active memberships", async () => {
    await db.exec(`update public.profiles set is_active = false where id = '${U.coo}'`);
    assert.equal((await rows(U.coo, `select permission from public.my_permissions($1)`, [CONF])).length, 0);
    await db.exec(`update public.profiles set is_active = true where id = '${U.coo}'`);
  });
  it("phone numbers can't be read from profiles directly", async () => {
    await denied(rows(U.member, `select phone from public.profiles`));
    const mine = await rows<{ phone: string }>(U.member, `select phone from public.profile_contacts where id = $1`, [U.member]);
    assert.equal(mine[0].phone, "+234-000");
    assert.equal((await rows(U.member, `select 1 from public.profile_contacts where id = $1`, [U.ceo])).length, 0);
    assert.equal((await rows(U.ceo, `select 1 from public.profile_contacts where id = $1`, [U.member])).length, 1);
  });
  it("history and audit records are written and can't be erased", async () => {
    const id = await makeTask(U.ceo, null);
    await rows(U.ceo, `update public.tasks set due_date = '2026-11-01', change_reason = 'Venue confirmed later' where id = $1`, [id]);
    const hist = await rows<{ field: string; reason: string }>(U.ceo, `select field, reason from public.task_change_history where task_id = $1`, [id]);
    assert.deepEqual(hist, [{ field: "due_date", reason: "Venue confirmed later" }]);
    await denied(rows(U.ceo, `delete from public.task_change_history where task_id = $1`, [id]));
    await denied(rows(U.ceo, `delete from public.audit_log`));
    const audit = await rows(U.ceo, `select 1 from public.audit_log where table_name = 'conference_memberships'`);
    assert.ok(audit.length > 0, "membership changes are audited");
    assert.equal((await rows(U.lead, `select 1 from public.audit_log`)).length, 0, "leads can't read the audit log");
  });
});

describe("scheduling: dependencies and baseline", () => {
  const link = (user: string, pred: string, succ: string, extra = "") =>
    rows<{ id: string }>(user,
      `insert into public.task_dependencies (conference_id, predecessor_id, successor_id ${extra ? ", " + extra.split("=")[0] : ""})
       values ($1, $2, $3 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [CONF, pred, succ]);

  it("a lead links tasks in their department; a member without dependencies.manage can't", async () => {
    const a = await makeTask(U.lead, SPONSOR);
    const b = await makeTask(U.lead, SPONSOR);
    await link(U.lead, a, b);
    await denied(link(U.member, b, await makeTask(U.lead, SPONSOR)));
    assert.equal((await rows(U.member, `select 1 from public.task_dependencies where successor_id = $1`, [b])).length, 1, "members can see links on tasks they can see");
  });
  it("a lead can't make another department's task wait on theirs", async () => {
    const mine = await makeTask(U.lead, SPONSOR);
    const finance = await makeTask(U.ceo, FINANCE);
    await denied(link(U.lead, mine, finance));
  });
  it("circular chains are rejected by the database, however long", async () => {
    const [a, b, c] = [await makeTask(U.ceo, null), await makeTask(U.ceo, null), await makeTask(U.ceo, null)];
    await link(U.ceo, a, b);
    await link(U.ceo, b, c);
    await assert.rejects(link(U.ceo, c, a), /circular/);
    await assert.rejects(link(U.ceo, a, a), /not_self|circular/);
    await assert.rejects(link(U.ceo, a, b), /duplicate|unique/);
  });
  it("informational links can't carry a lag", async () => {
    const [a, b] = [await makeTask(U.ceo, null), await makeTask(U.ceo, null)];
    await assert.rejects(link(U.ceo, a, b, "type, lag_days='informational', 2"), /informational_no_lag/);
  });
  it("only an approver records an exception, and it needs a reason", async () => {
    const a = await makeTask(U.lead, SPONSOR);
    const b = await makeTask(U.lead, SPONSOR);
    const [d] = await link(U.lead, a, b);
    await denied(rows(U.lead, `update public.task_dependencies set exception_approved = true, exception_reason = 'Urgent' where id = $1`, [d.id]));
    await assert.rejects(rows(U.coo, `update public.task_dependencies set exception_approved = true where id = $1`, [d.id]), /exception_needs_reason/);
    const [r] = await rows<{ exception_approved_by: string }>(U.coo,
      `update public.task_dependencies set exception_approved = true, exception_reason = 'Sponsor deadline' where id = $1 returning exception_approved_by`, [d.id]);
    assert.equal(r.exception_approved_by, U.coo);
    const events = await rows<{ verb: string }>(U.ceo, `select verb from public.activity_events where task_id = $1 order by id`, [b]);
    assert.deepEqual(events.map((e) => e.verb).filter((v) => v.startsWith("dependency.")), ["dependency.added", "dependency.exception_approved"]);
  });
  it("deleting a task removes its links without breaking the activity feed", async () => {
    const [a, b] = [await makeTask(U.ceo, null), await makeTask(U.ceo, null)];
    await link(U.ceo, a, b);
    await rows(U.ceo, `delete from public.tasks where id = $1`, [b]);
    await rows(U.ceo, `delete from public.tasks where id = $1`, [a]);
    assert.equal((await rows(U.ceo, `select 1 from public.task_dependencies where predecessor_id = $1`, [a])).length, 0);
  });
  it("approving the plan captures the baseline, and only leadership can change it", async () => {
    const id = await makeTask(U.lead, SPONSOR);
    await rows(U.lead, `update public.tasks set start_date = '2026-10-20', due_date = '2026-10-24' where id = $1`, [id]);
    const [t] = await rows<{ baseline_start: string; baseline_finish: string }>(U.ceo,
      `update public.tasks set planning_state = 'approved' where id = $1 returning baseline_start::text, baseline_finish::text`, [id]);
    assert.deepEqual(t, { baseline_start: "2026-10-20", baseline_finish: "2026-10-24" });
    const [moved] = await rows<{ baseline_finish: string }>(U.lead,
      `update public.tasks set due_date = '2026-10-28' where id = $1 returning baseline_finish::text`, [id]);
    assert.equal(moved.baseline_finish, "2026-10-24", "a plan change leaves the baseline alone");
    await denied(rows(U.lead, `update public.tasks set baseline_finish = '2026-10-28' where id = $1`, [id]));
    await rows(U.ceo, `update public.tasks set baseline_finish = '2026-10-28', change_reason = 'Re-baselined' where id = $1`, [id]);
  });
  it("a milestone never carries a duration", async () => {
    const [m] = await rows<{ duration_days: number | null }>(U.ceo,
      `insert into public.tasks (conference_id, title, kind, duration_days) values ($1, 'Programme published', 'milestone', 3) returning duration_days`, [CONF]);
    assert.equal(m.duration_days, null);
  });
});
