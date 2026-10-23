// The seed is rerunnable and invents nothing (brief §2.2, §7, §10.4).
import { before, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = join(import.meta.dirname, "..");
const db = new PGlite();
const seed = readFileSync(join(root, "seed.sql"), "utf8");

before(async () => {
  await db.exec(readFileSync(join(root, "tests", "supabase-stubs.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).sort()) {
    await db.exec(readFileSync(join(root, "migrations", f), "utf8"));
  }
});

it("can be rerun without duplicating or overwriting anything", async () => {
  await db.exec(seed);
  const count = async (t: string) => (await db.query<{ n: number }>(`select count(*)::int n from public.${t}`)).rows[0].n;
  const first = { d: await count("departments"), t: await count("tasks") };
  assert.equal(first.d, 14);
  assert.ok(first.t >= 60);

  await db.exec(`update public.tasks set title = 'Edited in app' where seed_key = 'sp-01'`);
  await db.exec(seed);
  assert.deepEqual({ d: await count("departments"), t: await count("tasks") }, first);
  const [row] = (await db.query<{ title: string }>(`select title from public.tasks where seed_key = 'sp-01'`)).rows;
  assert.equal(row.title, "Edited in app");
});

it("seeds suggestions only: no owners, dates, durations or progress", async () => {
  const [r] = (
    await db.query<{ bad: number; suggested: number; videos: number }>(`
      select count(*) filter (where accountable_owner_id is not null or start_date is not null or due_date is not null
                               or duration_days is not null or status <> 'not_started' or reported_completion <> 0)::int bad,
             count(*) filter (where planning_state = 'suggested' and source = 'seed')::int suggested,
             count(*) filter (where seed_key like 'vd-%')::int videos
      from public.tasks`)
  ).rows;
  assert.equal(r.bad, 0);
  assert.equal(r.videos, 4);
  const [{ n }] = (await db.query<{ n: number }>(`select count(*)::int n from public.tasks`)).rows;
  assert.equal(r.suggested, n);
});
