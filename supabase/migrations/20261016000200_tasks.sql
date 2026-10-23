-- =============================================================================
-- 0002 Task management, history, activity feed and audit log (brief §5 C, R)
--
--   * Visibility: tasks.view (conference-wide or in the task's department), or
--     being the accountable owner / an assignee.
--   * People involved in a task without tasks.edit can only move its progress
--     (status, actual dates, blocker, next action, reported completion).
--     Changing the owner needs tasks.assign. This is enforced by a trigger, so
--     direct API calls can't bypass it.
--   * Optimistic concurrency: every update bumps `version`. Server actions
--     update "where version = <what the user loaded>" and report a conflict
--     on zero rows, so concurrent edits aren't silently overwritten.
--   * task_change_history, activity_events and audit_log are append-only and
--     written by triggers. Users can read them, and nobody can edit them.
-- =============================================================================

create type public.task_status   as enum ('not_started', 'in_progress', 'blocked', 'submitted_for_review', 'completed');
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');

create table public.tasks (
  id                   uuid primary key default gen_random_uuid(),
  conference_id        uuid not null references public.conferences(id) on delete cascade,
  department_id        uuid references public.departments(id) on delete set null,
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
  -- §2.2: suggested values (seeded or proposed) vs values leadership approved.
  planning_state       text not null default 'suggested' check (planning_state in ('suggested', 'approved')),
  source               text not null default 'manual' check (source in ('manual', 'seed', 'template')),
  -- Stable key for seeded rows so the seed script can be rerun safely.
  seed_key             text,
  -- Written alongside a date/owner change; copied into task_change_history.
  change_reason        text,
  version              int not null default 1,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint dates_ordered  check (start_date is null or due_date is null or start_date <= due_date),
  constraint actuals_ordered check (actual_start is null or actual_finish is null or actual_start <= actual_finish),
  constraint blocked_needs_reason check (status <> 'blocked' or nullif(trim(blocker_details), '') is not null),
  constraint completed_has_finish check (status <> 'completed' or actual_finish is not null),
  unique (conference_id, seed_key)
);
create index tasks_conference_status_idx on public.tasks (conference_id, status);
create index tasks_department_idx on public.tasks (department_id);
create index tasks_owner_idx on public.tasks (accountable_owner_id);
create index tasks_due_idx on public.tasks (conference_id, due_date);

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

-- Metadata only. Files live in the private 'task-evidence' storage bucket at
-- <conference_id>/<task_id>/<uuid>-<filename>.
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

-- Append-only, one row per changed field.
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
  id            bigint generated always as identity primary key,
  conference_id uuid not null references public.conferences(id) on delete cascade,
  department_id uuid,
  task_id       uuid references public.tasks(id) on delete cascade,
  actor_id      uuid,
  verb          text not null,   -- e.g. task.created, task.status_changed, task.reassigned, blocker.raised
  detail        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index activity_events_conf_idx on public.activity_events (conference_id, created_at desc);

-- Durable audit trail. Rows survive deletion of the audited record.
create table public.audit_log (
  id            bigint generated always as identity primary key,
  conference_id uuid,
  table_name    text not null,
  record_id     text,
  action        text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id      uuid,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index audit_log_conf_idx on public.audit_log (conference_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Task authorisation helpers
-- ---------------------------------------------------------------------------
create or replace function app.is_involved(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task and app.is_member(t.conference_id) and (
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
      case when t.department_id is null
        then app.has_permission(t.conference_id, p_permission)
        else app.has_department_permission(t.department_id, p_permission)
      end
    )
  );
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

grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from anon, public;

-- ---------------------------------------------------------------------------
-- Triggers: update guard, lifecycle dates, version, history, activity, audit
-- ---------------------------------------------------------------------------
create or replace function app.guard_task_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  can_edit   boolean;
  can_assign boolean;
  lagos_today date := (now() at time zone 'Africa/Lagos')::date;
  progress_cols constant text[] := array[
    'status', 'actual_start', 'actual_finish', 'blocker_details', 'next_action',
    'reported_completion', 'change_reason', 'updated_at', 'version'];
  changed text;
begin
  if new.conference_id <> old.conference_id then
    raise exception 'A task cannot be moved to another conference' using errcode = '42501';
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

    -- Only leadership turns suggested planning values into approved ones (§2.2).
    if new.planning_state = 'approved' and old.planning_state <> 'approved'
       and not app.has_permission(old.conference_id, 'baseline.approve') then
      raise exception 'Only conference leadership can approve planning values' using errcode = '42501';
    end if;

    -- Moving to another department needs edit rights in the destination too.
    if new.department_id is distinct from old.department_id and new.department_id is not null
       and not app.has_department_permission(new.department_id, 'tasks.edit') then
      raise exception 'You cannot move tasks into that department' using errcode = '42501';
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

  -- Lifecycle dates. Actual dates are recorded in Lagos local time.
  if new.status in ('in_progress', 'submitted_for_review', 'completed') and new.actual_start is null then
    new.actual_start := lagos_today;
  end if;
  if new.status = 'completed' and new.actual_finish is null then
    new.actual_finish := lagos_today;
    new.reported_completion := 1;
  end if;
  if new.status <> 'completed' and old.status = 'completed' then
    new.actual_finish := null;  -- reopened. The history keeps the old value.
  end if;
  if new.status <> 'blocked' and old.status = 'blocked' and new.blocker_details = old.blocker_details then
    new.blocker_details := null;
  end if;

  -- A reason applies only to the update it was sent with.
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
  new.created_by := coalesce(new.created_by, auth.uid());
  new.version := 1;
  if auth.uid() is not null and new.planning_state = 'approved'
     and not app.has_permission(new.conference_id, 'baseline.approve') then
    new.planning_state := 'suggested';
  end if;
  if new.status = 'completed' and new.actual_finish is null then
    new.actual_finish := (now() at time zone 'Africa/Lagos')::date;
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
    insert into public.activity_events (conference_id, department_id, task_id, actor_id, verb, detail)
    values (new.conference_id, new.department_id, new.id, auth.uid(), 'task.created',
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
    insert into public.activity_events (conference_id, department_id, task_id, actor_id, verb, detail)
    values (new.conference_id, new.department_id, new.id, auth.uid(), verb, jsonb_build_object(
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

-- Generic audit trigger for consequential tables.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  conf uuid;
begin
  conf := app.try_uuid(rec ->> 'conference_id');
  if conf is null and rec ? 'department_id' then
    select d.conference_id into conf from public.departments d where d.id = app.try_uuid(rec ->> 'department_id');
  end if;
  insert into public.audit_log (conference_id, table_name, record_id, action, actor_id, before, after)
  values (conf, tg_table_name, coalesce(rec ->> 'id', rec ->> 'key'), tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit after insert or update or delete on public.conference_memberships
  for each row execute function app.audit_row();
create trigger audit after insert or update or delete on public.department_memberships
  for each row execute function app.audit_row();
create trigger audit after insert or update or delete on public.departments
  for each row execute function app.audit_row();
create trigger audit after insert or update or delete on public.conference_settings
  for each row execute function app.audit_row();
create trigger audit after delete on public.tasks
  for each row execute function app.audit_row();
create trigger audit after update on public.profiles
  for each row when (old.is_active is distinct from new.is_active)
  execute function app.audit_row();

create trigger touch_updated_at before update on public.task_checklist_items
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tasks                enable row level security;
alter table public.task_assignees       enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_attachments     enable row level security;
alter table public.task_change_history  enable row level security;
alter table public.activity_events      enable row level security;
alter table public.audit_log            enable row level security;

create policy view on public.tasks for select to authenticated
  using (
    (department_id is null and app.has_permission(conference_id, 'tasks.view'))
    or (department_id is not null and app.has_department_permission(department_id, 'tasks.view'))
    or app.is_involved(id)
  );
create policy create_task on public.tasks for insert to authenticated
  with check (
    case when department_id is null
      then app.has_permission(conference_id, 'tasks.create')
      else app.has_department_permission(department_id, 'tasks.create')
    end
  );
-- Field-level limits for progress-only updaters are in guard_task_update.
create policy update_task on public.tasks for update to authenticated
  using (app.task_permission(id, 'tasks.edit') or app.task_permission(id, 'tasks.assign') or app.is_involved(id))
  with check (app.is_member(conference_id));
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
         else app.has_permission(conference_id, 'conference.view_all') end
  );

create policy view on public.audit_log for select to authenticated
  using (conference_id is not null and app.has_permission(conference_id, 'audit.view'));

-- Append-only: no insert/update/delete policies exist on history tables, and
-- the privileges are removed too as a second layer.
revoke insert, update, delete, truncate on public.task_change_history, public.activity_events, public.audit_log
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Evidence storage (private bucket)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-evidence', 'task-evidence', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

create policy "task evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'task-evidence'
         and app.can_view_task(app.try_uuid((storage.foldername(name))[2])));
create policy "task evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'task-evidence' and (
    app.is_involved(app.try_uuid((storage.foldername(name))[2]))
    or app.task_permission(app.try_uuid((storage.foldername(name))[2]), 'tasks.edit')));
create policy "task evidence delete" on storage.objects for delete to authenticated
  using (bucket_id = 'task-evidence' and (
    owner_id = auth.uid()::text
    or app.task_permission(app.try_uuid((storage.foldername(name))[2]), 'tasks.edit')));

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes respects RLS)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.tasks, public.task_comments, public.task_checklist_items, public.activity_events;
