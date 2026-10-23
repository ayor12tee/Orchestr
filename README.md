# ConTech Nigeria 2026 — Conference Command Centre

Collaborative operations platform for ConTech Nigeria 2026 (21 November 2026, Regal Hall, Ikeja, Lagos).
Next.js 15 (App Router, strict TypeScript, Tailwind) on Supabase (Postgres, Auth, RLS, Realtime, Storage).

## Status: Phase 2 (scheduling)

| Area | State |
|---|---|
| Invitation-only sign-in (magic link, `shouldCreateUser: false`) | Built |
| CEO/COO permission parity (one shared profile, enforced by a DB constraint) | Built, tested |
| Roles, departments, memberships, revocation | Built, tested |
| Tasks: create/edit/assign, lifecycle, checklist, comments, evidence files, history | Built |
| Optimistic concurrency (conflict warning, no silent overwrite) | Built |
| RLS + trigger enforcement, append-only history and audit log | Built, tested |
| Control Room (countdown, overdue/blocked/due-soon, attention list, activity) | Built |
| Department workspaces with status board | Built |
| Realtime refresh across users | Built |
| Dependencies (blocking + related, lag, approved exceptions), loops rejected in the DB | Built, tested |
| Milestones and approved baseline (captured on plan approval, leadership re-baselines) | Built, tested |
| Forecasts on every task: late by N days, what pushed it, what's missing to forecast | Built |
| "What if this finishes on…" impact preview (nothing saved) | Built, tested |
| Timeline (planned vs forecast vs baseline, to conference day) | Built |
| Dependency Map (layered diagram + accessible list, per department or per task chain) | Built |
| Settings (due-soon window, unverified-work credit; leadership approves) | Built |
| Control Room "Forecast late" and late critical work in the attention list | Built |
| Weighted, evidence-aware progress | Domain logic built and tested; Pace Tracker arrives in Phase 3 |

## Confirmed conventions

- **Dates:** calendar days, due dates inclusive. A 1-day task starting D finishes on D. A finish-to-start successor can start on predecessor finish + 1 + lag. "Today" is Lagos time (WAT).
- **Email:** Supabase SMTP. In-app notifications come in Phase 5.
- **Bootstrap:** only the CEO and COO are invited by script. Everyone else is invited from **Team & Permissions**.

## Setup

1. **Supabase project.** Create one (separate dev and prod projects), then copy `.env.example` to `.env.local` and fill it in.
2. **Database.** Apply the migrations in `supabase/migrations/` in order, then `supabase/seed.sql`. Either:
   - `npx supabase link --project-ref <ref>` → `npx supabase db push`, then run `seed.sql` in the SQL editor, or
   - paste each file into the SQL editor in filename order.

   The seed is safe to rerun and never overwrites edits made in the app.
3. **Auth settings** (Supabase → Authentication):
   - Turn **off** "Allow new users to sign up" (invitation-only).
   - Site URL = `NEXT_PUBLIC_SITE_URL`. Add `<site>/auth/callback`, `<site>/auth/welcome` and `<site>/auth/confirm` to the redirect URLs.
   - The default email templates work as they are: magic links land on `/auth/callback`, invitations on `/auth/welcome`.
   - Configure custom SMTP before going live (the built-in sender is rate-limited). Supabase only lets you edit
     templates once custom SMTP is on. Optionally, you can then switch to token_hash links, which also work when
     the link is opened in a different browser: set the *Invite user* link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
     and *Magic Link* to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink`.
4. **Invite leadership:**
   ```sh
   npm install
   node --env-file=.env.local scripts/bootstrap-leadership.ts ceo@example.org coo@example.org
   ```
5. **Run:** `npm run dev` → http://localhost:3000

## Tests

```sh
npm test            # everything
npm run test:domain # scheduling, dates, progress, indicators (pure TypeScript)
npm run test:db     # runs the real migrations in PGlite and tests RLS as different users
npm run typecheck
```

To check a production build while `npm run dev` is running, build into a separate folder so the dev cache isn't disturbed: `NEXT_DIST_DIR=.next-verify npm run build`.

The database tests use `supabase/tests/supabase-stubs.sql` to stand in for Supabase's `auth`/`storage` schemas. They cover CEO/COO parity, department scoping, assignee limits, observers, admin limits, revocation, personal data and audit immutability. They complement, but don't replace, a check against a real Supabase project.

## Architecture

```
src/lib/domain/     Pure business logic. No React, no Supabase. Unit tested.
  dates.ts            calendar-day, inclusive date arithmetic
  graph.ts            dependency validation, cycle prevention, traversal
  schedule.ts         forecast + downstream impact with explicit "unknown" states
  progress.ts         weighted, evidence-gated progress
  indicators.ts       overdue / due soon / blocked / planning incomplete
src/lib/auth.ts     Resolves role + department permissions on the server (UI hints only)
src/lib/*/actions.ts Server actions: validate with zod, write via the user's RLS client
supabase/migrations The source of truth for permissions (RLS, guard triggers)
```

Security rules live in the database. Hiding a button is never the control: RLS, guard triggers and constraints decide every write, including direct API calls. The service-role key is used in one place only, sending invitations, and only after the caller's `members.manage` permission has been checked.
