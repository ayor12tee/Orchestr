-- =============================================================================
-- 0002 Projects and task execution
--
--   * An organization runs many projects. People get a project role per
--     project (project_members); whole teams can be attached to a project
--     (project_teams), and a team role then applies to that team's tasks in it.
--   * Effective permission on a task = project role, OR the user's team role
--     when the task belongs to one of their teams, OR organization-wide
--     projects.manage_all / projects.view_all (read-only).
--   * People involved in a task (owner, reviewer, collaborators) can always
--     see it and move its progress, but not rewrite it.
--   * Optimistic concurrency, append-only history, activity feed and audit
--     work exactly as in the original conference build, now per project.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug            text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  name            text not null check (length(trim(name)) between 1 and 160),
  description     text,
  status          text not null default 'active' check (status in ('planning', 'active', 'on_hold', 'completed', 'archived')),
  start_date      date,
  -- The date everything builds towards (a launch, an event day, a go-live).
  target_date     date,
  -- Overrides the organization's time zone for "today" in this project.
  timezone        text,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug),
  unique (id, organization_id),
  constraint project_dates_ordered check (start_date is null or target_date is null or start_date <= target_date)
);
create index projects_org_idx on public.projects (organization_id);

create trigger check_timezone before insert or update of timezone on public.projects
  for each row execute function app.check_timezone();

create table public.project_members (
  project_id      uuid not null,
  organization_id uuid not null,
  user_id         uuid not null,
  role_id         uuid not null,
  added_by        uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  primary key (project_id, user_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.org_members(organization_id, user_id) on delete cascade,
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete restrict
);
create index project_members_user_idx on public.project_members (user_id);

create table public.project_teams (
  project_id      uuid not null,
  organization_id uuid not null,
  team_id         uuid not null,
  created_at      timestamptz not null default now(),
  primary key (project_id, team_id),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  foreign key (team_id, organization_id) references public.teams(id, organization_id) on delete cascade
);

-- Rules each project configures (due-soon window, progress credit...).
-- value is JSON so new settings need no migration.
create table public.project_settings (
  project_id      uuid not null,
  organization_id uuid not null,
  key             text not null,
  value           jsonb not null,
  -- 'suggested' = a default, 'approved' = confirmed by someone who manages the project.
  approval_state  text not null default 'suggested' check (approval_state in ('suggested', 'approved')),
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  primary key (project_id, key),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Project authorisation helpers
-- ---------------------------------------------------------------------------
create or replace function app.has_project_permission(p_project uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project and app.is_org_member(p.organization_id) and (
      app.has_org_permission(p.organization_id, 'projects.manage_all')
      or (p_permission in ('project.view', 'tasks.view') and app.has_org_permission(p.organization_id, 'projects.view_all'))
      or exists (
        select 1 from public.project_members pm
        join public.role_permissions rp on rp.role_id = pm.role_id
        where pm.project_id = p.id and pm.user_id = auth.uid() and rp.permission = p_permission
      )
    )
  );
$$;

-- A team role applies inside projects the team is attached to.
create or replace function app.has_team_permission(p_project uuid, p_team uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.project_teams pt
    join public.team_members tm on tm.team_id = pt.team_id and tm.user_id = auth.uid()
    join public.role_permissions rp on rp.role_id = tm.role_id and rp.permission = p_permission
    where pt.project_id = p_project and pt.team_id = p_team and app.is_org_member(pt.organization_id)
  );
$$;

create or replace function app.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_project_permission(p_project, 'project.view') or exists (
    select 1 from public.project_teams pt
    join public.team_members tm on tm.team_id = pt.team_id and tm.user_id = auth.uid()
    where pt.project_id = p_project and app.is_org_member(pt.organization_id)
  );
$$;

-- "Today" for a project, in its own (or its organization's) time zone.
create or replace function app.project_today(p_project uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(p.timezone, o.timezone, 'UTC'))::date
  from public.projects p join public.organizations o on o.id = p.organization_id
  where p.id = p_project;
$$;

create or replace function app.bootstrapping_project(p_project uuid) returns boolean
language sql stable as $$
  select coalesce(current_setting('app.bootstrap_project', true), '') = p_project::text;
$$;

-- Project-scope permissions the caller holds in a project, with the team that
-- grants them (null = granted by the project role or organization-wide).
create or replace function public.my_project_permissions(p_project uuid)
returns table (permission text, team_id uuid)
language sql stable security definer set search_path = '' as $$
  select k.key, null::uuid from public.permissions k
  where k.scope = 'project' and app.has_project_permission(p_project, k.key)
  union
  select rp.permission, pt.team_id
  from public.project_teams pt
  join public.team_members tm on tm.team_id = pt.team_id and tm.user_id = auth.uid()
  join public.role_permissions rp on rp.role_id = tm.role_id
  where pt.project_id = p_project and app.is_org_member(pt.organization_id);
$$;

-- ---------------------------------------------------------------------------
-- Project guards
-- ---------------------------------------------------------------------------
create or replace function app.guard_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'A project can''t move to another organization' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_project before insert or update on public.projects
  for each row execute function app.guard_project();

-- The creator leads the new project, and it starts with suggested settings.
create or replace function app.setup_new_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lead_role uuid;
begin
  perform set_config('app.bootstrap_project', new.id::text, true);
  select id into lead_role from public.roles where organization_id = new.organization_id and system_key = 'project_lead';
  if auth.uid() is not null and lead_role is not null then
    insert into public.project_members (project_id, organization_id, user_id, role_id)
    values (new.id, new.organization_id, auth.uid(), lead_role)
    on conflict do nothing;
  end if;
  insert into public.project_settings (project_id, organization_id, key, value) values
    (new.id, new.organization_id, 'indicators', '{"due_soon_days": 7}'),
    (new.id, new.organization_id, 'progress', '{"unverified_complete_credit": 0}');
  perform set_config('app.bootstrap_project', '', true);
  return null;
end $$;

create trigger setup_new_project after insert on public.projects
  for each row execute function app.setup_new_project();

-- Creating a project. A plain INSERT ... RETURNING can't work for the
-- creator: the new row is checked for visibility before setup_new_project
-- has made them its lead. This does both in one step.
create or replace function public.create_project(
  p_org uuid, p_name text, p_slug text,
  p_description text default null, p_start date default null, p_target date default null, p_timezone text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  new_id uuid;
begin
  if auth.uid() is null or not app.has_org_permission(p_org, 'projects.create') then
    raise exception 'You don''t have permission to create projects here' using errcode = '42501';
  end if;
  insert into public.projects (organization_id, name, slug, description, start_date, target_date, timezone, created_by)
  values (p_org, trim(p_name), lower(trim(p_slug)), nullif(trim(p_description), ''), p_start, p_target, nullif(p_timezone, ''), auth.uid())
  returning id into new_id;
  return new_id;
end $$;
revoke execute on function public.create_project(uuid, text, text, text, date, date, text) from anon, public;
grant execute on function public.create_project(uuid, text, text, text, date, date, text) to authenticated;

-- Granting, changing or removing a project role: it must be a project role,
-- and you must hold every permission involved yourself.
create or replace function app.check_project_grantable(p_project uuid, p_role uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  missing text;
begin
  select * into r from public.roles where id = p_role;
  if r.id is null or r.organization_id <> (select organization_id from public.projects where id = p_project) then
    raise exception 'That role belongs to a different organization' using errcode = '23503';
  end if;
  if r.scope <> 'project' then
    raise exception 'That is a % role, not a project role', r.scope using errcode = '23514';
  end if;
  if auth.uid() is null or app.bootstrapping_project(p_project) then
    return;
  end if;
  select rp.permission into missing from public.role_permissions rp
  where rp.role_id = r.id and not app.has_project_permission(p_project, rp.permission) limit 1;
  if missing is not null then
    raise exception 'You can''t grant or remove this role because it includes "%", which you don''t hold here', missing using errcode = '42501';
  end if;
end $$;

create or replace function app.guard_project_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects where id = coalesce(new.project_id, old.project_id)) then
    return coalesce(new, old);  -- project being deleted
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform app.check_project_grantable(old.project_id, old.role_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'UPDATE' and (new.project_id <> old.project_id or new.user_id <> old.user_id) then
      raise exception 'Remove the member and add them again instead' using errcode = '42501';
    end if;
    perform app.check_project_grantable(new.project_id, new.role_id);
  end if;
  return coalesce(new, old);
end $$;

create trigger guard_project_member before insert or update or delete on public.project_members
  for each row execute function app.guard_project_member();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create type public.task_status   as enum ('not_started', 'in_progress', 'blocked', 'submitted_for_review', 'completed');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  project_id           uuid not null,
  team_id              uuid,
  workstream           text,
  title                text not null check (length(trim(title)) > 0),
  description          text,
  accountable_owner_id uuid references public.profiles(id) on delete set null,
  reviewer_id          uuid references public.profiles(id) on delete set null,
  priority             public.task_priority not null default 'medium',
  is_critical          boolean not null default false,
  status               public.task_status not null default 'not_started',
  start_date           date,
  due_date             date,
  duration_days        int check (duration_days is null or duration_days >= 1),
  actual_start         date,
  actual_finish        date,
  reported_completion  numeric(4,3) not null default 0 check (reported_completion between 0 and 1),
  acceptance_criteria  text,
  requires_evidence    boolean not null default false,
  requires_review      boolean not null default false,
  blocker_details      text,
  next_action          text,
  -- Suggested values (from a template or proposed) vs values someone with
  -- baseline.approve confirmed.
  planning_state       text not null default 'suggested' check (planning_state in ('suggested', 'approved')),
  source               text not null default 'manual' check (source in ('manual', 'template')),
  -- Stable key for rows created from a template, so it can be re-applied safely.
  template_key         text,
  change_reason        text,
  version              int not null default 1,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  -- A task's team must be attached to its project. Detaching the team keeps the task.
  foreign key (project_id, team_id) references public.project_teams(project_id, team_id) on delete set null (team_id),
  constraint dates_ordered  check (start_date is null or due_date is null or start_date <= due_date),
  constraint actuals_ordered check (actual_start is null or actual_finish is null or actual_start <= actual_finish),
  constraint blocked_needs_reason check (status <> 'blocked' or nullif(trim(blocker_details), '') is not null),
  constraint completed_has_finish check (status <> 'completed' or actual_finish is not null),
  unique (project_id, template_key)
);
create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_team_idx on public.tasks (team_id);
create index tasks_owner_idx on public.tasks (accountable_owner_id);
create index tasks_due_idx on public.tasks (project_id, due_date);

create table public.task_assignees (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'collaborator' check (role in ('collaborator', 'supporting', 'approver')),
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees (user_id);

create table public.task_checklist_items (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  label      text not null check (length(trim(label)) > 0),
  is_done    boolean not null default false,
  sort_order int not null default 0,
  done_by    uuid references public.profiles(id) on delete set null,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_checklist_task_idx on public.task_checklist_items (task_id);

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body       text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at  timestamptz
);
create index task_comments_task_idx on public.task_comments (task_id, created_at);

-- Metadata only. Files live in the private 'task-evidence' bucket at
-- <organization_id>/<project_id>/<task_id>/<uuid>-<filename>.
create table public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  is_evidence  boolean not null default false,
  uploaded_by  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  created_at   timestamptz not null default now()
);
create index task_attachments_task_idx on public.task_attachments (task_id);

create table public.task_change_history (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks(id) on delete cascade,
  field       text not null,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index task_change_history_task_idx on public.task_change_history (task_id, changed_at);

create table public.activity_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete cascade,
  team_id         uuid,
  task_id         uuid references public.tasks(id) on delete cascade,
  actor_id        uuid,
  verb            text not null,
  detail          jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
create index activity_events_project_idx on public.activity_events (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Task authorisation helpers
-- ---------------------------------------------------------------------------
create or replace function app.is_involved(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and app.is_org_member(t.organization_id) and (
      t.accountable_owner_id = auth.uid() or t.reviewer_id = auth.uid()
      or exists (select 1 from public.task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
    )
  );
$$;

create or replace function app.task_permission(p_task uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and (
      app.has_project_permission(t.project_id, p_permission)
      or (t.team_id is not null and app.has_team_permission(t.project_id, t.team_id, p_permission))
    )
  );
$$;

-- Permission for a task that doesn't exist yet (or is moving team).
create or replace function app.can_in_project_or_team(p_project uuid, p_team uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_project_permission(p_project, p_permission)
      or (p_team is not null and app.has_team_permission(p_project, p_team, p_permission));
$$;

create or replace function app.can_view_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.task_permission(p_task, 'tasks.view') or app.is_involved(p_task);
$$;

create or replace function app.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Task triggers: update guard, lifecycle dates, version, history, activity
-- ---------------------------------------------------------------------------
create or replace function app.guard_task_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  can_edit   boolean;
  can_assign boolean;
  today date := app.project_today(old.project_id);
  progress_cols constant text[] := array[
    'status', 'actual_start', 'actual_finish', 'blocker_details', 'next_action',
    'reported_completion', 'change_reason', 'updated_at', 'version'];
  changed text;
begin
  if new.project_id <> old.project_id or new.organization_id <> old.organization_id then
    raise exception 'A task can''t be moved to another project' using errcode = '42501';
  end if;

  if auth.uid() is not null then
    can_edit   := app.task_permission(old.id, 'tasks.edit');
    can_assign := app.task_permission(old.id, 'tasks.assign');

    if new.accountable_owner_id is distinct from old.accountable_owner_id
       or new.reviewer_id is distinct from old.reviewer_id then
      if not can_assign then
        raise exception 'You do not have permission to reassign this task' using errcode = '42501';
      end if;
    end if;

    if new.planning_state = 'approved' and old.planning_state <> 'approved'
       and not app.has_project_permission(old.project_id, 'baseline.approve') then
      raise exception 'Only someone who can approve the plan can approve planning values' using errcode = '42501';
    end if;

    -- Moving to another team needs edit rights there too.
    if new.team_id is distinct from old.team_id and new.team_id is not null
       and not app.can_in_project_or_team(new.project_id, new.team_id, 'tasks.edit') then
      raise exception 'You cannot move tasks into that team' using errcode = '42501';
    end if;

    if not can_edit then
      for changed in
        select n.key from jsonb_each(to_jsonb(new)) n
        join jsonb_each(to_jsonb(old)) o using (key)
        where n.value is distinct from o.value
      loop
        if changed <> all (progress_cols)
           and changed not in ('accountable_owner_id', 'reviewer_id') then
          raise exception 'You can update progress on this task but not its "%"', changed
            using errcode = '42501';
        end if;
      end loop;

      -- Review-gated tasks are completed by the reviewer or by someone with
      -- edit rights, never by the person who did the work alone.
      if new.status = 'completed' and old.status <> 'completed' and old.requires_review
         and old.reviewer_id is distinct from auth.uid() then
        raise exception 'This task needs review: submit it for review instead' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.status in ('in_progress', 'submitted_for_review', 'completed') and new.actual_start is null then
    new.actual_start := today;
  end if;
  if new.status = 'completed' and new.actual_finish is null then
    new.actual_finish := today;
    new.reported_completion := 1;
  end if;
  if new.status <> 'completed' and old.status = 'completed' then
    new.actual_finish := null;  -- reopened. The history keeps the old value.
  end if;
  if new.status <> 'blocked' and old.status = 'blocked' and new.blocker_details = old.blocker_details then
    new.blocker_details := null;
  end if;

  if new.change_reason is not distinct from old.change_reason then
    new.change_reason := null;
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_task_update before update on public.tasks
  for each row execute function app.guard_task_update();

create or replace function app.task_defaults_on_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The organization always comes from the project, never from the client.
  select p.organization_id into new.organization_id from public.projects p where p.id = new.project_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  new.version := 1;
  if auth.uid() is not null and new.planning_state = 'approved'
     and not app.has_project_permission(new.project_id, 'baseline.approve') then
    new.planning_state := 'suggested';
  end if;
  if new.status = 'completed' and new.actual_finish is null then
    new.actual_finish := app.project_today(new.project_id);
  end if;
  return new;
end $$;

create trigger task_defaults_on_insert before insert on public.tasks
  for each row execute function app.task_defaults_on_insert();

create or replace function app.record_task_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ignored constant text[] := array['updated_at', 'version', 'change_reason'];
  verb text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_events (organization_id, project_id, team_id, task_id, actor_id, verb, detail)
    values (new.organization_id, new.project_id, new.team_id, new.id, auth.uid(), 'task.created',
            jsonb_build_object('title', new.title, 'source', new.source));
    return new;
  end if;

  insert into public.task_change_history (task_id, field, old_value, new_value, reason, changed_by)
  select new.id, n.key, o.value, n.value, new.change_reason, auth.uid()
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value and n.key <> all (ignored);

  verb := case
    when new.status is distinct from old.status and new.status = 'blocked' then 'blocker.raised'
    when new.status is distinct from old.status and old.status = 'blocked' then 'blocker.resolved'
    when new.status is distinct from old.status and new.status = 'completed' then 'task.completed'
    when new.status is distinct from old.status then 'task.status_changed'
    when new.accountable_owner_id is distinct from old.accountable_owner_id then 'task.reassigned'
    when new.due_date is distinct from old.due_date then 'task.rescheduled'
    else null
  end;
  if verb is not null then
    insert into public.activity_events (organization_id, project_id, team_id, task_id, actor_id, verb, detail)
    values (new.organization_id, new.project_id, new.team_id, new.id, auth.uid(), verb, jsonb_build_object(
      'title', new.title,
      'from_status', old.status, 'to_status', new.status,
      'from_owner', old.accountable_owner_id, 'to_owner', new.accountable_owner_id,
      'from_due', old.due_date, 'to_due', new.due_date,
      'reason', new.change_reason));
  end if;
  return new;
end $$;

create trigger record_task_changes after insert or update on public.tasks
  for each row execute function app.record_task_changes();

do $$
declare t text;
begin
  foreach t in array array['projects', 'project_members', 'project_teams', 'project_settings']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;
create trigger audit after delete on public.tasks
  for each row execute function app.audit_row();

create trigger touch_updated_at before update on public.task_checklist_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.projects             enable row level security;
alter table public.project_members      enable row level security;
alter table public.project_teams        enable row level security;
alter table public.project_settings     enable row level security;
alter table public.tasks                enable row level security;
alter table public.task_assignees       enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_attachments     enable row level security;
alter table public.task_change_history  enable row level security;
alter table public.activity_events      enable row level security;

create policy view on public.projects for select to authenticated
  using (app.can_view_project(id));
create policy create_project on public.projects for insert to authenticated
  with check (app.has_org_permission(organization_id, 'projects.create') and created_by = auth.uid());
create policy manage on public.projects for update to authenticated
  using (app.has_project_permission(id, 'project.manage'))
  with check (app.has_project_permission(id, 'project.manage'));
create policy remove on public.projects for delete to authenticated
  using (app.has_org_permission(organization_id, 'projects.manage_all'));

create policy view on public.project_members for select to authenticated
  using (app.can_view_project(project_id));
create policy manage on public.project_members for all to authenticated
  using (app.has_project_permission(project_id, 'project.manage'))
  with check (app.has_project_permission(project_id, 'project.manage'));

create policy view on public.project_teams for select to authenticated
  using (app.can_view_project(project_id));
create policy manage on public.project_teams for all to authenticated
  using (app.has_project_permission(project_id, 'project.manage'))
  with check (app.has_project_permission(project_id, 'project.manage'));

create policy view on public.project_settings for select to authenticated
  using (app.can_view_project(project_id));
create policy manage on public.project_settings for all to authenticated
  using (app.has_project_permission(project_id, 'project.manage'))
  with check (app.has_project_permission(project_id, 'project.manage'));

create policy view on public.tasks for select to authenticated
  using (
    app.has_project_permission(project_id, 'tasks.view')
    or (team_id is not null and app.has_team_permission(project_id, team_id, 'tasks.view'))
    or app.is_involved(id)
  );
create policy create_task on public.tasks for insert to authenticated
  with check (app.can_in_project_or_team(project_id, team_id, 'tasks.create'));
create policy update_task on public.tasks for update to authenticated
  using (app.task_permission(id, 'tasks.edit') or app.task_permission(id, 'tasks.assign') or app.is_involved(id))
  with check (app.is_org_member(organization_id));
create policy delete_task on public.tasks for delete to authenticated
  using (app.task_permission(id, 'tasks.delete'));

create policy view on public.task_assignees for select to authenticated
  using (app.can_view_task(task_id));
create policy manage on public.task_assignees for all to authenticated
  using (app.task_permission(task_id, 'tasks.assign'))
  with check (app.task_permission(task_id, 'tasks.assign'));

create policy view on public.task_checklist_items for select to authenticated
  using (app.can_view_task(task_id));
create policy tick on public.task_checklist_items for update to authenticated
  using (app.task_permission(task_id, 'tasks.edit') or app.is_involved(task_id))
  with check (app.task_permission(task_id, 'tasks.edit') or app.is_involved(task_id));
create policy manage on public.task_checklist_items for all to authenticated
  using (app.task_permission(task_id, 'tasks.edit'))
  with check (app.task_permission(task_id, 'tasks.edit'));

create policy view on public.task_comments for select to authenticated
  using (app.can_view_task(task_id));
create policy post on public.task_comments for insert to authenticated
  with check (author_id = auth.uid() and app.can_view_task(task_id));
create policy edit_own on public.task_comments for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

create policy view on public.task_attachments for select to authenticated
  using (app.can_view_task(task_id));
create policy upload on public.task_attachments for insert to authenticated
  with check (uploaded_by = auth.uid() and (app.is_involved(task_id) or app.task_permission(task_id, 'tasks.edit')));
create policy remove on public.task_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or app.task_permission(task_id, 'tasks.edit'));

create policy view on public.task_change_history for select to authenticated
  using (app.can_view_task(task_id));

create policy view on public.activity_events for select to authenticated
  using (
    case when task_id is not null then app.can_view_task(task_id)
         when project_id is not null then app.has_project_permission(project_id, 'project.view')
         else app.has_org_permission(organization_id, 'audit.view') end
  );

revoke insert, update, delete, truncate on public.task_change_history, public.activity_events
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Evidence storage (private bucket): <org>/<project>/<task>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-evidence', 'task-evidence', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

create policy "task evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'task-evidence'
         and app.can_view_task(app.try_uuid((storage.foldername(name))[3])));
create policy "task evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-evidence' and (
    app.is_involved(app.try_uuid((storage.foldername(name))[3]))
    or app.task_permission(app.try_uuid((storage.foldername(name))[3]), 'tasks.edit')));
create policy "task evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'task-evidence' and (
    owner_id = auth.uid()::text
    or app.task_permission(app.try_uuid((storage.foldername(name))[3]), 'tasks.edit')));

grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from anon, public;

alter publication supabase_realtime add table
  public.tasks, public.task_comments, public.task_checklist_items, public.activity_events;
