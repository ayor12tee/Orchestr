# Orchestr

**Turn plans into coordinated execution.**

A multi-tenant project execution platform: each organization defines its own structure, teams, roles and permissions, runs many projects, and sees how progress, blockers and delays affect delivery.

Next.js 15 (App Router, strict TypeScript, Tailwind) on Supabase (Postgres, Auth, RLS, Realtime, Storage). Built from the ConTech Nigeria Conference Command Centre, which lives on unchanged in its own folder and Supabase project.

## Status

| Step | Area | State |
|---|---|---|
| 0 | Version control; ConTech preserved separately | Done |
| 1 | Self-serve sign-up and organization creation | Built; database tested |
| 1 | Editable roles at organization, project and team level; permission catalogue | Built; database tested |
| 1 | Units (nested, named by each organization) and teams; memberships; invitations; suspension | Built; database tested |
| 1 | Tenant isolation (RLS on every table, composite foreign keys), no-escalation and keep-an-Owner guards | Built; database tested |
| 2 | Multiple projects per organization; project roles; teams attached to projects | Built; database tested |
| 2 | Task execution: lifecycle, review gating, checklist, comments, evidence files, history, audit, conflict warnings | Built; database tested |
| 2 | Project overview, task list, board, organization overview with live per-project figures | Built |
| 4 | Dependencies, milestones, baseline, forecasts, impact preview, Timeline, Dependency Map (per project) | Built; logic and database tested |
| 3 | Templates (including a Conference template from ConTech's plan); "create project from template" | Not started |
| 4 | Links between projects in the same organization | Not started |
| 5 | Portfolios | Not started (the organization overview is a first, ungrouped view) |
| 6 | Approvals, risks, Pace Tracker (verified / planned / forecast / unknown), notifications, optional modules | Not started |

"Database tested" means checked by the PGlite suite below, acting as different users. The app screens have been type-checked, linted and built, but **not yet exercised against a live Supabase project**.

## Concepts

- **Organization**: an isolated workspace. Created self-serve; its creator becomes **Owner**.
- **Roles** are defined by each organization (starter roles are created for it and are all editable):
  - *organization roles* (Owner, Administrator, Executive, Member…) apply across the organization;
  - *project roles* (Project Lead, Contributor, Viewer…) are given per project, so one person can hold different roles in different projects;
  - *team roles* (Team Lead, Team Member…) apply to a team's tasks in every project the team is attached to.
- The **permission catalogue** is fixed by the platform (the code checks those keys); which roles hold which permissions is up to each organization.
- Safety rules enforced by the database: you can't grant a role or permission you don't hold; only an Owner can grant, remove or suspend an Owner; an organization always keeps an active Owner.
- **Units** describe how the organization is arranged (it chooses the word: Department, Division…). **Teams** do the work.

## Conventions

- **Dates:** calendar days, due dates inclusive. A 1-day task starting D finishes on D. A finish-to-start successor can start on predecessor finish + 1 + lag. "Today" uses the project's time zone, or the organization's.
- **Forecasts** are recalculated from stored facts on every request and never saved. Missing inputs produce an explicit "can't forecast yet" with what's needed.

## Setup

1. **Supabase project.** Create a new one for Orchestr (not ConTech's), copy `.env.example` to `.env.local` and fill it in.
2. **Database.** Run each file in `supabase/migrations/` in filename order in the SQL Editor (or `npx supabase db push`). There is no seed: organizations are created in the app.
3. **Auth settings** (Supabase → Authentication):
   - Keep **"Allow new users to sign up" ON** (sign-up is self-serve).
   - Site URL = `NEXT_PUBLIC_SITE_URL`. Redirect URLs: `<site>/auth/callback`, `<site>/auth/welcome`, `<site>/auth/confirm`.
   - Default email templates work. Configure custom SMTP before going live (the built-in sender is rate-limited).
4. **Run:** `npm install`, then `npm run dev` (on Windows PowerShell: `npm.cmd run dev`) → http://localhost:3000. Sign up, create your organization.

## Tests

```sh
npm test            # everything
npm run test:domain # scheduling, dates, progress, indicators (pure TypeScript)
npm run test:db     # runs the real migrations in PGlite and tests RLS as different users
npm run typecheck
```

To check a production build while `npm run dev` is running, build into a separate folder: `NEXT_DIST_DIR=.next-verify npm run build`.

## Architecture

```
src/lib/domain/       Pure business logic, reused unchanged from ConTech. Unit tested.
  dates.ts              calendar-day, inclusive date arithmetic; today in any time zone
  graph.ts              dependency validation, cycle prevention, traversal, map layout
  schedule.ts           forecast + downstream impact with explicit "unknown" states
  progress.ts           weighted, evidence-gated progress (for the Pace Tracker)
  indicators.ts         overdue / due soon / blocked / planning incomplete
src/lib/auth.ts       Organization and project access, resolved on the server (UI hints only)
src/lib/*/actions.ts  Server actions: validate with zod, re-resolve access, write via the user's RLS client
src/app/(app)/o/[org]/...             organization pages
src/app/(app)/o/[org]/p/[project]/... project pages
supabase/migrations   The source of truth for permissions and isolation (RLS, guard triggers)
```

Security rules live in the database. Hiding a button is never the control: RLS, guard triggers and constraints decide every write, including direct API calls. The service-role key is used in one place only, sending invitation emails, after the caller's `members.manage` permission has been checked.
