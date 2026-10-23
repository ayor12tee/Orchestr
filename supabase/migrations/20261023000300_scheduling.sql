-- =============================================================================
-- 0003 Scheduling: dependencies, milestones and the approved baseline
--
--   * task_dependencies stores "A must finish before B" (finish_to_start, with
--     an optional lag) and "A relates to B" (informational, never blocks).
--     Both tasks belong to the same project. Loops are rejected here, not just
--     in the app, and graph changes are serialised per project so two
--     concurrent inserts can't close a loop.
--   * Managing a task's dependencies needs dependencies.manage on that task
--     (the successor) and visibility of the task it waits on.
--   * An approved exception lets a successor proceed before its predecessor
--     finishes. Recording one needs approvals.decide in the project and a reason.
--   * The baseline is the first approved plan. It's captured when someone with
--     baseline.approve approves a task's planning values, and only they can
--     change it afterwards (an explicit re-baseline, kept in the task history).
--   * Forecasts aren't stored: the app recalculates them from these facts.
-- =============================================================================

alter table public.tasks
  add column kind            text not null default 'task' check (kind in ('task', 'milestone')),
  add column baseline_start  date,
  add column baseline_finish date,
  add constraint milestone_has_no_duration check (kind <> 'milestone' or duration_days is null);

-- Runs before guard_task_update (triggers fire in name order).
create or replace function app.guard_task_schedule() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Migrations, templates and scripts run without a user session.
  can_baseline boolean := auth.uid() is null or app.has_project_permission(new.project_id, 'baseline.approve');
begin
  if tg_op = 'UPDATE' then
    if (new.baseline_start is distinct from old.baseline_start
        or new.baseline_finish is distinct from old.baseline_finish) and not can_baseline then
      raise exception 'Only someone who can approve the plan can change the baseline' using errcode = '42501';
    end if;
  elsif not can_baseline then
    new.baseline_start := null;
    new.baseline_finish := null;
  end if;

  -- The first approved dates become the baseline. Later plan changes leave it alone.
  if can_baseline and new.planning_state = 'approved'
     and new.baseline_start is null and new.baseline_finish is null then
    new.baseline_start := new.start_date;
    new.baseline_finish := new.due_date;
  end if;

  -- A milestone is a point in time: it has a date, not a duration.
  if new.kind = 'milestone' then
    new.duration_days := null;
  end if;
  return new;
end $$;

create trigger guard_task_schedule before insert or update on public.tasks
  for each row execute function app.guard_task_schedule();

-- ---------------------------------------------------------------------------
-- Dependencies
-- ---------------------------------------------------------------------------
create table public.task_dependencies (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  project_id            uuid not null,
  predecessor_id        uuid not null references public.tasks(id) on delete cascade,
  successor_id          uuid not null references public.tasks(id) on delete cascade,
  type                  text not null default 'finish_to_start' check (type in ('finish_to_start', 'informational')),
  -- Calendar days after the predecessor's finish. 0 means the next day.
  lag_days              int not null default 0 check (lag_days >= 0),
  exception_approved    boolean not null default false,
  exception_reason      text,
  exception_approved_by uuid references public.profiles(id) on delete set null,
  exception_approved_at timestamptz,
  created_by            uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  constraint not_self check (predecessor_id <> successor_id),
  constraint informational_no_lag check (type <> 'informational' or lag_days = 0),
  constraint exception_needs_reason check (not exception_approved or nullif(trim(exception_reason), '') is not null),
  unique (predecessor_id, successor_id)
);
create index task_dependencies_successor_idx on public.task_dependencies (successor_id);
create index task_dependencies_project_idx on public.task_dependencies (project_id);

create or replace function app.guard_dependency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_exception boolean;
  old_reason    text;
begin
  if tg_op = 'INSERT' then
    -- Project and organization always come from the tasks themselves.
    select t.project_id, t.organization_id into new.project_id, new.organization_id
    from public.tasks t where t.id = new.successor_id;
    if not exists (select 1 from public.tasks t where t.id = new.predecessor_id and t.project_id = new.project_id) then
      raise exception 'Both tasks must belong to the same project' using errcode = '23514';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
    if exists (
      with recursive reach(id) as (
        select new.successor_id
        union
        select d.successor_id from public.task_dependencies d join reach r on d.predecessor_id = r.id
      )
      select 1 from reach where id = new.predecessor_id
    ) then
      raise exception 'This dependency would create a circular chain of tasks' using errcode = '23514';
    end if;
    old_exception := false;
    old_reason := null;
  else
    if new.predecessor_id <> old.predecessor_id or new.successor_id <> old.successor_id
       or new.project_id <> old.project_id or new.organization_id <> old.organization_id then
      raise exception 'Remove the dependency and add a new one instead of re-pointing it' using errcode = '42501';
    end if;
    old_exception := old.exception_approved;
    old_reason := old.exception_reason;
  end if;

  if new.exception_approved is distinct from old_exception or new.exception_reason is distinct from old_reason then
    if auth.uid() is not null and not app.has_project_permission(new.project_id, 'approvals.decide') then
      raise exception 'Only an authorised approver can record a dependency exception' using errcode = '42501';
    end if;
    if new.exception_approved then
      new.exception_approved_by := auth.uid();
      new.exception_approved_at := now();
    else
      new.exception_reason := null;
      new.exception_approved_by := null;
      new.exception_approved_at := null;
    end if;
  end if;
  return new;
end $$;

create trigger guard_dependency before insert or update on public.task_dependencies
  for each row execute function app.guard_dependency();

create or replace function app.record_dependency_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec  public.task_dependencies := coalesce(new, old);
  verb text;
  succ public.tasks;
begin
  select * into succ from public.tasks where id = rec.successor_id;
  if succ.id is null then
    return null;  -- the successor itself is being deleted
  end if;
  verb := case
    when tg_op = 'INSERT' then 'dependency.added'
    when tg_op = 'DELETE' then 'dependency.removed'
    when new.exception_approved and not old.exception_approved then 'dependency.exception_approved'
    when old.exception_approved and not new.exception_approved then 'dependency.exception_withdrawn'
    else null
  end;
  if verb is not null then
    insert into public.activity_events (organization_id, project_id, team_id, task_id, actor_id, verb, detail)
    values (succ.organization_id, succ.project_id, succ.team_id, succ.id, auth.uid(), verb, jsonb_build_object(
      'title', succ.title,
      'predecessor', (select t.title from public.tasks t where t.id = rec.predecessor_id),
      'type', rec.type,
      'reason', rec.exception_reason));
  end if;
  return null;
end $$;

create trigger record_dependency_activity after insert or update or delete on public.task_dependencies
  for each row execute function app.record_dependency_activity();

create trigger audit after insert or update or delete on public.task_dependencies
  for each row execute function app.audit_row();

alter table public.task_dependencies enable row level security;

create policy view on public.task_dependencies for select to authenticated
  using (app.can_view_task(predecessor_id) or app.can_view_task(successor_id));
create policy add on public.task_dependencies for insert to authenticated
  with check (app.task_permission(successor_id, 'dependencies.manage') and app.can_view_task(predecessor_id));
create policy change on public.task_dependencies for update to authenticated
  using (app.task_permission(successor_id, 'dependencies.manage') or app.has_project_permission(project_id, 'approvals.decide'))
  with check (app.task_permission(successor_id, 'dependencies.manage') or app.has_project_permission(project_id, 'approvals.decide'));
create policy remove on public.task_dependencies for delete to authenticated
  using (app.task_permission(successor_id, 'dependencies.manage'));

grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from anon, public;

alter publication supabase_realtime add table public.task_dependencies;
