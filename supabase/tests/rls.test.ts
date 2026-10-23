// Permission and isolation tests against the real migrations, run as
// different users with RLS applied. Run with: npm run test:db
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");
const db = new PGlite();

const U = {
  alice: "00000000-0000-0000-0000-00000000000a", // Owner of Acme
  adam: "00000000-0000-0000-0000-00000000000b", // Administrator of Acme
  exec: "00000000-0000-0000-0000-00000000000c", // Executive of Acme (sees all projects)
  lead: "00000000-0000-0000-0000-00000000000d", // Team Lead, Sponsorship
  member: "00000000-0000-0000-0000-00000000000e", // Team Member, Sponsorship
  contrib: "00000000-0000-0000-0000-00000000000f", // Contributor on the Launch project
  viewer: "00000000-0000-0000-0000-000000000010", // Viewer on the Launch project
  outsider: "00000000-0000-0000-0000-000000000011", // Acme member with nothing else
  eve: "00000000-0000-0000-0000-000000000012", // Owner of Beta, a different organization
  newbie: "00000000-0000-0000-0000-000000000013", // signed up, no organization yet
};
const ids: Record<string, string> = {};

/** Runs `sql` as `user` with the `authenticated` role, so RLS applies. */
async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  let out: T[] = [];
  await db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    await tx.exec(`set local role authenticated`);
    out = (await tx.query<T>(sql, params)).rows;
  });
  return out;
}
const one = async <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => (await as<T>(user, sql, params))[0];
const denied = (p: Promise<unknown>) =>
  assert.rejects(p, (e: Error) => /permission|row-level security|violates|can't|cannot|do not have|not its|needs review|Only /i.test(e.message));
const role = (org: string, key: string) => ids[`${org}:${key}`];

before(async () => {
  await db.exec(readFileSync(join(root, "tests", "supabase-stubs.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
  await db.exec(`insert into auth.users (id, email) values ${Object.entries(U).map(([k, id]) => `('${id}', '${k}@example.test')`).join(",")};
                 update public.profiles set full_name = email, phone = '+234-000';`);

  ids.acme = (await one<{ id: string }>(U.alice, `select public.create_organization('Acme Ltd', 'acme', 'Africa/Lagos') as id`)).id;
  ids.beta = (await one<{ id: string }>(U.eve, `select public.create_organization('Beta Inc', 'beta') as id`)).id;
  for (const org of ["acme", "beta"]) {
    for (const r of (await db.query<{ id: string; system_key: string }>(`select id, system_key from public.roles where organization_id = $1`, [ids[org]])).rows) {
      ids[`${org}:${r.system_key}`] = r.id;
    }
  }

  // Alice builds Acme through the app's own permissions.
  const join_ = async (user: string, roleKey: string) => {
    await as(U.alice, `insert into public.org_members (organization_id, user_id, invited_by) values ($1, $2, $3)`, [ids.acme, user, U.alice]);
    await as(U.alice, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, user, role("acme", roleKey)]);
  };
  await join_(U.adam, "admin");
  await join_(U.exec, "executive");
  for (const u of [U.lead, U.member, U.contrib, U.viewer, U.outsider]) await join_(u, "member");

  ids.sponsorship = (await one<{ id: string }>(U.alice, `insert into public.teams (organization_id, name) values ($1, 'Sponsorship') returning id`, [ids.acme])).id;
  ids.finance = (await one<{ id: string }>(U.alice, `insert into public.teams (organization_id, name) values ($1, 'Finance') returning id`, [ids.acme])).id;
  await as(U.alice, `insert into public.team_members (team_id, organization_id, user_id, role_id) values ($1, $2, $3, $4), ($1, $2, $5, $6)`,
    [ids.sponsorship, ids.acme, U.lead, role("acme", "team_lead"), U.member, role("acme", "team_member")]);

  ids.launch = (await one<{ id: string }>(U.alice, `select public.create_project($1, 'Product launch', 'launch', null, null, '2026-12-01') as id`, [ids.acme])).id;
  await as(U.alice, `insert into public.project_teams (project_id, organization_id, team_id) values ($1, $2, $3), ($1, $2, $4)`, [ids.launch, ids.acme, ids.sponsorship, ids.finance]);
  await as(U.alice, `insert into public.project_members (project_id, organization_id, user_id, role_id) values ($1, $2, $3, $4), ($1, $2, $5, $6)`,
    [ids.launch, ids.acme, U.contrib, role("acme", "contributor"), U.viewer, role("acme", "viewer")]);
  ids.betaProject = (await one<{ id: string }>(U.eve, `select public.create_project($1, 'Beta secret plan', 'secret') as id`, [ids.beta])).id;
});

async function makeTask(user: string, team: string | null = null, extra = "") {
  const [cols, vals] = extra ? extra.split("=") : ["", ""];
  return (await one<{ id: string }>(user,
    `insert into public.tasks (project_id, team_id, title ${cols ? ", " + cols : ""}) values ($1, $2, 'Send initial outreach' ${vals ? ", " + vals : ""}) returning id`,
    [ids.launch, team])).id;
}

describe("creating an organization", () => {
  it("the creator becomes Owner, with editable starter roles", async () => {
    const roles = await as<{ name: string; scope: string }>(U.alice, `select name, scope from public.roles where organization_id = $1 order by scope, name`, [ids.acme]);
    assert.equal(roles.length, 9);
    const perms = await as<{ p: string }>(U.alice, `select p from public.my_org_permissions($1) p`, [ids.acme]);
    assert.ok(perms.length >= 10 && perms.some((r) => r.p === "roles.manage"));
  });
  it("anyone signed in can create their own organization, nobody else's", async () => {
    const org = (await one<{ id: string }>(U.newbie, `select public.create_organization('Newbie Co', 'newbie-co') as id`)).id;
    assert.equal((await as(U.newbie, `select 1 from public.organizations where id = $1`, [org])).length, 1);
    await assert.rejects(as(U.newbie, `select public.create_organization('Taken', 'acme')`), /duplicate|unique/);
    await denied(as(U.newbie, `insert into public.organizations (name, slug) values ('Sneaky', 'sneaky')`));
  });
  it("rejects an unknown time zone", async () => {
    await assert.rejects(as(U.newbie, `select public.create_organization('Tz', 'tz-test', 'Mars/Olympus')`), /time zone/);
  });
});

describe("tenant isolation", () => {
  it("another organization's data is invisible", async () => {
    for (const [table, col] of [["organizations", "id"], ["roles", "organization_id"], ["org_members", "organization_id"], ["teams", "organization_id"], ["projects", "organization_id"], ["tasks", "organization_id"]]) {
      assert.equal((await as(U.eve, `select 1 from public.${table} where ${col} = $1`, [ids.acme])).length, 0, `eve sees acme ${table}`);
      assert.equal((await as(U.alice, `select 1 from public.${table} where ${col} = $1`, [ids.beta])).length, 0, `alice sees beta ${table}`);
    }
    assert.equal((await as(U.eve, `select 1 from public.profiles where id = $1`, [U.alice])).length, 0, "profiles of non-colleagues are hidden");
  });
  it("can't write into another organization", async () => {
    await denied(as(U.eve, `insert into public.org_members (organization_id, user_id) values ($1, $2)`, [ids.acme, U.eve]));
    await denied(as(U.eve, `insert into public.projects (organization_id, slug, name) values ($1, 'x', 'x')`, [ids.acme]));
    await denied(as(U.eve, `insert into public.tasks (project_id, title) values ($1, 'x')`, [ids.launch]));
    await denied(as(U.alice, `insert into public.tasks (project_id, title) values ($1, 'x')`, [ids.betaProject]));
  });
  it("can't attach another organization's role or team, even with full rights", async () => {
    await assert.rejects(
      as(U.alice, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.outsider, role("beta", "admin")]),
      /different organization/);
    await assert.rejects(db.query(`insert into public.project_teams (project_id, organization_id, team_id) values ($1, $2, $3)`, [ids.betaProject, ids.beta, ids.sponsorship]), /foreign key/);
  });
  it("a task's organization comes from its project, not the client", async () => {
    const [t] = await as<{ organization_id: string }>(U.alice, `insert into public.tasks (project_id, organization_id, title) values ($1, $2, 'Spoof') returning organization_id`, [ids.launch, ids.beta]);
    assert.equal(t.organization_id, ids.acme);
  });
});

describe("roles and escalation", () => {
  it("an Administrator can't grant Owner or make themselves Owner", async () => {
    await denied(as(U.adam, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.adam, role("acme", "owner")]));
    await denied(as(U.adam, `delete from public.org_member_roles where user_id = $1 and role_id = $2`, [U.alice, role("acme", "owner")]));
    await denied(as(U.adam, `update public.org_members set status = 'suspended' where user_id = $1 and organization_id = $2`, [U.alice, ids.acme]));
    // Even with a second Owner around, so the lock-out rule isn't what stops it.
    await as(U.alice, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.exec, role("acme", "owner")]);
    await assert.rejects(as(U.adam, `update public.org_members set status = 'suspended' where user_id = $1 and organization_id = $2`, [U.alice, ids.acme]), /Only an Owner/);
    await as(U.alice, `delete from public.org_member_roles where user_id = $1 and role_id = $2`, [U.exec, role("acme", "owner")]);
  });
  it("someone who can only manage members can't hand out more than they hold", async () => {
    const r = (await one<{ id: string }>(U.alice, `insert into public.roles (organization_id, scope, name) values ($1, 'organization', 'People manager') returning id`, [ids.acme])).id;
    await as(U.alice, `insert into public.role_permissions (role_id, permission) values ($1, 'members.manage')`, [r]);
    await as(U.alice, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.outsider, r]);
    await denied(as(U.outsider, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.outsider, role("acme", "admin")]));
    await as(U.outsider, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.viewer, r]);
    await as(U.alice, `delete from public.org_member_roles where role_id = $1`, [r]);
  });
  it("roles carry only permissions of their scope, and the Owner role is fixed", async () => {
    await assert.rejects(as(U.alice, `insert into public.role_permissions (role_id, permission) values ($1, 'tasks.edit')`, [role("acme", "member")]), /can't include/);
    await assert.rejects(as(U.alice, `insert into public.role_permissions (role_id, permission) values ($1, 'org.manage')`, [role("acme", "viewer")]), /can't include/);
    await denied(as(U.alice, `delete from public.role_permissions where role_id = $1`, [role("acme", "owner")]));
    await denied(as(U.alice, `delete from public.roles where id = $1`, [role("acme", "owner")]));
  });
  it("roles are editable: rename, change permissions, add new ones", async () => {
    await as(U.adam, `update public.roles set name = 'Staff' where id = $1`, [role("acme", "member")]);
    await as(U.adam, `insert into public.role_permissions (role_id, permission) values ($1, 'tasks.assign')`, [role("acme", "contributor")]);
    await as(U.adam, `delete from public.role_permissions where role_id = $1 and permission = 'tasks.assign'`, [role("acme", "contributor")]);
    await as(U.adam, `update public.roles set name = 'Member' where id = $1`, [role("acme", "member")]);
  });
  it("an organization always keeps an active Owner", async () => {
    await assert.rejects(as(U.alice, `delete from public.org_member_roles where user_id = $1 and role_id = $2`, [U.alice, role("acme", "owner")]), /at least one active Owner/);
    // Handing over first works.
    await as(U.alice, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.adam, role("acme", "owner")]);
    await as(U.alice, `delete from public.org_member_roles where user_id = $1 and role_id = $2`, [U.alice, role("acme", "owner")]);
    await as(U.adam, `insert into public.org_member_roles (organization_id, user_id, role_id) values ($1, $2, $3)`, [ids.acme, U.alice, role("acme", "owner")]);
    await as(U.alice, `delete from public.org_member_roles where user_id = $1 and role_id = $2`, [U.adam, role("acme", "owner")]);
  });
  it("a suspended member loses access immediately", async () => {
    await as(U.alice, `update public.org_members set status = 'suspended' where user_id = $1 and organization_id = $2`, [U.contrib, ids.acme]);
    assert.equal((await as(U.contrib, `select 1 from public.projects where id = $1`, [ids.launch])).length, 0);
    await as(U.alice, `update public.org_members set status = 'active' where user_id = $1 and organization_id = $2`, [U.contrib, ids.acme]);
    assert.equal((await as(U.contrib, `select 1 from public.projects where id = $1`, [ids.launch])).length, 1);
  });
});

describe("structure", () => {
  it("units nest, but never inside themselves", async () => {
    const a = (await one<{ id: string }>(U.alice, `insert into public.org_units (organization_id, name) values ($1, 'Operations') returning id`, [ids.acme])).id;
    const b = (await one<{ id: string }>(U.alice, `insert into public.org_units (organization_id, parent_id, name) values ($1, $2, 'Events') returning id`, [ids.acme, a])).id;
    await assert.rejects(as(U.alice, `update public.org_units set parent_id = $2 where id = $1`, [a, b]), /inside itself/);
    await assert.rejects(as(U.alice, `delete from public.org_units where id = $1`, [a]), /foreign key/);
  });
  it("only structure managers edit units and teams", async () => {
    await denied(as(U.lead, `insert into public.teams (organization_id, name) values ($1, 'Rogue')`, [ids.acme]));
    await as(U.adam, `insert into public.teams (organization_id, name) values ($1, 'Design')`, [ids.acme]);
  });
});

describe("projects", () => {
  it("the creator leads the project and it starts with suggested settings", async () => {
    const [m] = await as<{ role_id: string }>(U.alice, `select role_id from public.project_members where project_id = $1 and user_id = $2`, [ids.launch, U.alice]);
    assert.equal(m.role_id, role("acme", "project_lead"));
    const s = await as<{ key: string; approval_state: string }>(U.alice, `select key, approval_state from public.project_settings where project_id = $1 order by key`, [ids.launch]);
    assert.deepEqual(s, [{ key: "indicators", approval_state: "suggested" }, { key: "progress", approval_state: "suggested" }]);
  });
  it("only people with projects.create can start a project", async () => {
    await denied(as(U.outsider, `insert into public.projects (organization_id, slug, name) values ($1, 'mine', 'Mine')`, [ids.acme]));
  });
  it("people outside a project don't see it; an executive sees but can't change it", async () => {
    assert.equal((await as(U.outsider, `select 1 from public.projects where id = $1`, [ids.launch])).length, 0);
    assert.equal((await as(U.exec, `select 1 from public.projects where id = $1`, [ids.launch])).length, 1);
    await makeTask(U.alice);
    assert.ok((await as(U.exec, `select 1 from public.tasks where project_id = $1`, [ids.launch])).length > 0);
    await denied(as(U.exec, `insert into public.tasks (project_id, title) values ($1, 'x')`, [ids.launch]));
    assert.equal((await as(U.exec, `update public.projects set name = 'Hijacked' where id = $1 returning id`, [ids.launch])).length, 0);
  });
  it("a contributor creates and edits tasks but can't assign or delete; a viewer only reads", async () => {
    const id = await makeTask(U.contrib);
    await as(U.contrib, `update public.tasks set title = 'Edited' where id = $1`, [id]);
    await denied(as(U.contrib, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.contrib]));
    assert.equal((await as(U.contrib, `delete from public.tasks where id = $1 returning id`, [id])).length, 0);
    await denied(as(U.viewer, `insert into public.tasks (project_id, title) values ($1, 'x')`, [ids.launch]));
    assert.equal((await as(U.viewer, `select 1 from public.tasks where id = $1`, [id])).length, 1);
  });
  it("a project manager can't grant a project role with more than they hold", async () => {
    const r = (await one<{ id: string }>(U.alice, `insert into public.roles (organization_id, scope, name) values ($1, 'project', 'Coordinator') returning id`, [ids.acme])).id;
    await as(U.alice, `insert into public.role_permissions (role_id, permission) values ($1, 'project.view'), ($1, 'project.manage')`, [r]);
    await as(U.alice, `update public.project_members set role_id = $3 where project_id = $1 and user_id = $2`, [ids.launch, U.viewer, r]);
    await denied(as(U.viewer, `update public.project_members set role_id = $3 where project_id = $1 and user_id = $2`, [ids.launch, U.contrib, role("acme", "project_lead")]));
    await as(U.alice, `update public.project_members set role_id = $3 where project_id = $1 and user_id = $2`, [ids.launch, U.viewer, role("acme", "viewer")]);
  });
  it("a user can hold different roles in different projects", async () => {
    const other = (await one<{ id: string }>(U.alice, `select public.create_project($1, 'Annual audit', 'audit') as id`, [ids.acme])).id;
    await as(U.alice, `insert into public.project_members (project_id, organization_id, user_id, role_id) values ($1, $2, $3, $4)`, [other, ids.acme, U.viewer, role("acme", "contributor")]);
    await as(U.viewer, `insert into public.tasks (project_id, title) values ($1, 'Collect ledgers')`, [other]);
    await denied(as(U.viewer, `insert into public.tasks (project_id, title) values ($1, 'x')`, [ids.launch]));
  });
});

describe("teams inside projects", () => {
  it("a team lead manages their team's tasks, not other teams'", async () => {
    const id = await makeTask(U.lead, ids.sponsorship);
    await as(U.lead, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.member]);
    await denied(as(U.lead, `insert into public.tasks (project_id, team_id, title) values ($1, $2, 'x')`, [ids.launch, ids.finance]));
    const fin = await makeTask(U.alice, ids.finance);
    assert.equal((await as(U.lead, `select 1 from public.tasks where id = $1`, [fin])).length, 0);
    assert.equal((await as(U.lead, `select 1 from public.projects where id = $1`, [ids.launch])).length, 1, "team members can open the project");
  });
  it("a task can only belong to a team attached to its project", async () => {
    const design = (await one<{ id: string }>(U.alice, `select id from public.teams where name = 'Design'`)).id;
    await assert.rejects(as(U.alice, `insert into public.tasks (project_id, team_id, title) values ($1, $2, 'x')`, [ids.launch, design]), /foreign key/);
  });
  it("an assignee moves progress but can't rewrite, reassign or self-complete a reviewed task", async () => {
    const id = await makeTask(U.alice, ids.finance, "requires_review=true");
    await as(U.alice, `insert into public.task_assignees (task_id, user_id) values ($1, $2)`, [id, U.outsider]);
    const [t] = await as<{ status: string; actual_start: string | null; version: number }>(
      U.outsider, `update public.tasks set status = 'in_progress' where id = $1 returning status, actual_start, version`, [id]);
    assert.equal(t.status, "in_progress");
    assert.ok(t.actual_start);
    assert.equal(t.version, 2);
    await denied(as(U.outsider, `update public.tasks set title = 'Mine now' where id = $1`, [id]));
    await denied(as(U.outsider, `update public.tasks set accountable_owner_id = $2 where id = $1`, [id, U.outsider]));
    await denied(as(U.outsider, `update public.tasks set status = 'completed' where id = $1`, [id]));
    await as(U.outsider, `update public.tasks set status = 'submitted_for_review' where id = $1`, [id]);
  });
  it("only plan approvers approve planning values", async () => {
    const id = await makeTask(U.lead, ids.sponsorship);
    await denied(as(U.lead, `update public.tasks set planning_state = 'approved' where id = $1`, [id]));
    await as(U.alice, `update public.tasks set planning_state = 'approved' where id = $1`, [id]);
  });
  it("blocking a task requires a reason", async () => {
    const id = await makeTask(U.alice);
    await assert.rejects(as(U.alice, `update public.tasks set status = 'blocked' where id = $1`, [id]), /blocked_needs_reason/);
  });
  it("history and audit are written and can't be erased", async () => {
    const id = await makeTask(U.alice);
    await as(U.alice, `update public.tasks set due_date = '2026-11-01', change_reason = 'Supplier confirmed later' where id = $1`, [id]);
    const hist = await as<{ field: string; reason: string }>(U.alice, `select field, reason from public.task_change_history where task_id = $1`, [id]);
    assert.deepEqual(hist, [{ field: "due_date", reason: "Supplier confirmed later" }]);
    await denied(as(U.alice, `delete from public.task_change_history where task_id = $1`, [id]));
    await denied(as(U.alice, `delete from public.audit_log`));
    assert.ok((await as(U.alice, `select 1 from public.audit_log where table_name = 'org_member_roles'`)).length > 0);
    assert.equal((await as(U.lead, `select 1 from public.audit_log`)).length, 0);
    assert.equal((await as(U.eve, `select 1 from public.audit_log where organization_id = $1`, [ids.acme])).length, 0);
  });
  it("phone numbers are personal data", async () => {
    await denied(as(U.member, `select phone from public.profiles`));
    assert.equal((await as(U.member, `select 1 from public.profile_contacts where id = $1`, [U.alice])).length, 0);
    assert.equal((await as(U.exec, `select 1 from public.profile_contacts where id = $1`, [U.member])).length, 1);
  });
});

describe("scheduling", () => {
  const link = (user: string, pred: string, succ: string) =>
    as<{ id: string }>(user, `insert into public.task_dependencies (predecessor_id, successor_id) values ($1, $2) returning id`, [pred, succ]);

  it("a team lead links their team's tasks; a team member can't", async () => {
    const a = await makeTask(U.lead, ids.sponsorship);
    const b = await makeTask(U.lead, ids.sponsorship);
    await link(U.lead, a, b);
    await denied(link(U.member, b, await makeTask(U.lead, ids.sponsorship)));
    const [d] = await as<{ project_id: string }>(U.lead, `select project_id from public.task_dependencies where successor_id = $1`, [b]);
    assert.equal(d.project_id, ids.launch, "project comes from the tasks");
  });
  it("links stay inside one project", async () => {
    const other = (await one<{ id: string }>(U.alice, `select id from public.projects where slug = 'audit'`)).id;
    const x = (await one<{ id: string }>(U.alice, `insert into public.tasks (project_id, title) values ($1, 'x') returning id`, [other])).id;
    await assert.rejects(link(U.alice, x, await makeTask(U.alice)), /same project/);
  });
  it("circular chains are rejected by the database", async () => {
    const [a, b, c] = [await makeTask(U.alice), await makeTask(U.alice), await makeTask(U.alice)];
    await link(U.alice, a, b);
    await link(U.alice, b, c);
    await assert.rejects(link(U.alice, c, a), /circular/);
    await assert.rejects(link(U.alice, a, a), /not_self|circular/);
  });
  it("only an approver records an exception, with a reason", async () => {
    const a = await makeTask(U.lead, ids.sponsorship);
    const b = await makeTask(U.lead, ids.sponsorship);
    const [d] = await link(U.lead, a, b);
    await denied(as(U.lead, `update public.task_dependencies set exception_approved = true, exception_reason = 'Urgent' where id = $1`, [d.id]));
    await assert.rejects(as(U.alice, `update public.task_dependencies set exception_approved = true where id = $1`, [d.id]), /exception_needs_reason/);
    const [r] = await as<{ exception_approved_by: string }>(U.alice,
      `update public.task_dependencies set exception_approved = true, exception_reason = 'Sponsor deadline' where id = $1 returning exception_approved_by`, [d.id]);
    assert.equal(r.exception_approved_by, U.alice);
  });
  it("approving the plan captures the baseline; only approvers change it", async () => {
    const id = await makeTask(U.lead, ids.sponsorship);
    await as(U.lead, `update public.tasks set start_date = '2026-11-02', due_date = '2026-11-06' where id = $1`, [id]);
    const [t] = await as<{ baseline_finish: string }>(U.alice, `update public.tasks set planning_state = 'approved' where id = $1 returning baseline_finish::text`, [id]);
    assert.equal(t.baseline_finish, "2026-11-06");
    await denied(as(U.lead, `update public.tasks set baseline_finish = '2026-11-09' where id = $1`, [id]));
  });
  it("deleting a task removes its links cleanly", async () => {
    const [a, b] = [await makeTask(U.alice), await makeTask(U.alice)];
    await link(U.alice, a, b);
    await as(U.alice, `delete from public.tasks where id = $1`, [b]);
    assert.equal((await as(U.alice, `select 1 from public.task_dependencies where predecessor_id = $1`, [a])).length, 0);
  });
});
