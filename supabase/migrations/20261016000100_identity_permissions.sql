-- =============================================================================
-- 0001 Identity, roles, permissions and departments (brief §4, §11.1)
--
-- Access model
--   * A user can hold several conference roles and belong to several
--     departments. Access is the union of what those grant.
--   * Roles map to a permission profile. CEO and COO are separate roles (for
--     attribution and reporting) but BOTH are pinned to the single
--     'conference_leadership' profile by a CHECK constraint, so their access
--     cannot drift apart.
--   * Department leads and members get department-scoped permissions that only
--     apply to records in their own departments.
--   * Anything other than status 'active' grants nothing, so a revoked
--     membership loses access on the next request.
--   * RLS calls the helper functions in schema "app". They are SECURITY DEFINER
--     so policies on membership tables don't recurse.
-- =============================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Conference
-- ---------------------------------------------------------------------------
create table public.conferences (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  event_date  date not null,
  venue       text,
  theme       text,
  timezone    text not null default 'Africa/Lagos',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Settings that leadership configures (progress options, escalation rules,
-- date convention). value is JSON so new settings need no migration.
create table public.conference_settings (
  conference_id uuid not null references public.conferences(id) on delete cascade,
  key           text not null,
  value         jsonb not null,
  -- 'suggested' = default proposed by the system, 'approved' = confirmed by leadership.
  approval_state text not null default 'suggested' check (approval_state in ('suggested', 'approved')),
  updated_by    uuid,
  updated_at    timestamptz not null default now(),
  primary key (conference_id, key)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text not null,
  phone       text,          -- personal data: visible to self and personal_data.view only (see view below)
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

-- Every auth account (created only by invitation) gets a profile.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  description  text not null
);

create table public.permission_profiles (
  key          text primary key,
  scope        text not null check (scope in ('conference', 'department')),
  description  text not null
);

create table public.role_permissions (
  permission_profile text not null references public.permission_profiles(key) on delete cascade,
  permission         text not null references public.permissions(key) on delete cascade,
  primary key (permission_profile, permission)
);

create table public.organisational_roles (
  key                text primary key,
  title              text not null,
  permission_profile text not null references public.permission_profiles(key),
  -- §4.2: CEO and COO always share one profile. This can't be changed by data edits.
  constraint leadership_parity check (
    key not in ('ceo', 'coo') or permission_profile = 'conference_leadership'
  )
);

create table public.conference_memberships (
  id             uuid primary key default gen_random_uuid(),
  conference_id  uuid not null references public.conferences(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  role_key       text not null references public.organisational_roles(key),
  -- Distinguishes the three volunteer leads (and any other repeated role).
  label          text,
  status         text not null default 'active' check (status in ('invited', 'active', 'suspended', 'revoked')),
  invited_by     uuid references public.profiles(id),
  revoked_at     timestamptz,
  revoked_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (conference_id, user_id, role_key)
);
create index conference_memberships_user_idx on public.conference_memberships (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id             uuid primary key default gen_random_uuid(),
  conference_id  uuid not null references public.conferences(id) on delete cascade,
  slug           text not null,
  name           text not null,
  objective      text,
  sort_order     int not null default 0,
  source         text not null default 'manual' check (source in ('manual', 'seed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (conference_id, slug)
);

create table public.department_roles (
  key                text primary key check (key in ('lead', 'member')),
  permission_profile text not null references public.permission_profiles(key)
);

create table public.department_memberships (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references public.departments(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  department_role text not null references public.department_roles(key),
  status         text not null default 'active' check (status in ('active', 'revoked')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (department_id, user_id)
);
create index department_memberships_user_idx on public.department_memberships (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('conference.view',          'See the conference, its departments and member names'),
  ('conference.view_all',      'See every department, workstream and conference-wide report'),
  ('conference.manage',        'Manage targets, milestones, timeline and operational settings'),
  ('members.manage',           'Invite people, assign roles and department memberships, revoke access'),
  ('departments.manage',       'Create and edit departments'),
  ('tasks.view',               'See tasks in scope'),
  ('tasks.create',             'Create tasks in scope'),
  ('tasks.edit',               'Edit any field of tasks in scope'),
  ('tasks.assign',             'Assign and reassign tasks in scope'),
  ('tasks.delete',             'Delete tasks in scope'),
  ('dependencies.manage',      'Create, edit and remove task dependencies'),
  ('baseline.approve',         'Approve a revised schedule baseline'),
  ('approvals.decide',         'Act as an approver where an approval policy names this role'),
  ('pace.view',                'View the Conference Pace Tracker'),
  ('reports.view',             'View reports'),
  ('finance.view',             'View finance records'),
  ('finance.manage',           'Edit finance records'),
  ('commercial.view',          'View confidential sponsorship and exhibitor terms'),
  ('personal_data.view',       'View personal contact details of team members and volunteers'),
  ('volunteers.manage',        'Manage volunteer assignments, shifts and briefings'),
  ('audit.view',               'View the audit log'),
  ('system.configure',         'Technical configuration (no business decision authority)');

insert into public.permission_profiles (key, scope, description) values
  ('conference_leadership', 'conference', 'Shared by CEO/Convener and COO. Full conference access.'),
  ('volunteer_lead',        'conference', 'Volunteer coordination'),
  ('team_member',           'conference', 'Assigned work and the context needed to do it'),
  ('observer',              'conference', 'Read-only dashboards and reports'),
  ('system_admin',          'conference', 'Technical configuration and access support only'),
  ('department_lead',       'department', 'Manages work inside their department'),
  ('department_member',     'department', 'Works inside their department');

-- Leadership: every permission except pure technical configuration.
insert into public.role_permissions (permission_profile, permission)
select 'conference_leadership', key from public.permissions where key <> 'system.configure';

insert into public.role_permissions (permission_profile, permission) values
  ('volunteer_lead', 'conference.view'), ('volunteer_lead', 'volunteers.manage'),
  -- No conference-wide tasks.view: volunteer leads see tasks through
  -- assignment or department membership, like everyone else.
  ('volunteer_lead', 'pace.view'),
  ('team_member',    'conference.view'),
  ('observer',       'conference.view'), ('observer', 'pace.view'), ('observer', 'reports.view'),
  -- Admin can support access but has no approval, finance or task authority.
  ('system_admin',   'conference.view'), ('system_admin', 'members.manage'),
  ('system_admin',   'system.configure'), ('system_admin', 'audit.view'),
  ('department_lead', 'tasks.view'),  ('department_lead', 'tasks.create'),
  ('department_lead', 'tasks.edit'),  ('department_lead', 'tasks.assign'),
  ('department_lead', 'tasks.delete'), ('department_lead', 'dependencies.manage'),
  ('department_lead', 'pace.view'),   ('department_lead', 'reports.view'),
  ('department_member', 'tasks.view'), ('department_member', 'tasks.create');

insert into public.organisational_roles (key, title, permission_profile) values
  ('ceo',             'CEO / Convener',         'conference_leadership'),
  ('coo',             'COO',                    'conference_leadership'),
  ('volunteer_lead',  'Volunteer Lead',         'volunteer_lead'),
  ('team_member',     'Team Member',            'team_member'),
  ('volunteer',       'Volunteer',              'team_member'),
  ('observer',        'Observer',               'observer'),
  ('system_admin',    'System Administrator',   'system_admin');

insert into public.department_roles (key, permission_profile) values
  ('lead', 'department_lead'), ('member', 'department_member');

-- ---------------------------------------------------------------------------
-- Authorisation helpers (used by RLS and by server actions via rpc)
-- ---------------------------------------------------------------------------
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function app.is_member(p_conference uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1 from public.conference_memberships m
    where m.conference_id = p_conference and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- Conference-wide permission from any active role.
create or replace function app.has_permission(p_conference uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1
    from public.conference_memberships m
    join public.organisational_roles r on r.key = m.role_key
    join public.role_permissions rp on rp.permission_profile = r.permission_profile
    where m.conference_id = p_conference and m.user_id = auth.uid()
      and m.status = 'active' and rp.permission = p_permission
  );
$$;

-- Conference-wide permission OR the same permission granted by an active
-- membership of this specific department.
create or replace function app.has_department_permission(p_department uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.departments d
    where d.id = p_department and (
      app.has_permission(d.conference_id, p_permission)
      or (app.is_member(d.conference_id) and exists (
        select 1
        from public.department_memberships dm
        join public.department_roles dr on dr.key = dm.department_role
        join public.role_permissions rp on rp.permission_profile = dr.permission_profile
        where dm.department_id = d.id and dm.user_id = auth.uid()
          and dm.status = 'active' and rp.permission = p_permission
      ))
    )
  );
$$;

-- Holds a role on the shared leadership profile (CEO or COO, identically).
create or replace function app.is_leadership(p_conference uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1 from public.conference_memberships m
    join public.organisational_roles r on r.key = m.role_key
    where m.conference_id = p_conference and m.user_id = auth.uid()
      and m.status = 'active' and r.permission_profile = 'conference_leadership'
  );
$$;

create or replace function app.is_department_member(p_department uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.department_memberships dm
    join public.departments d on d.id = dm.department_id
    where dm.department_id = p_department and dm.user_id = auth.uid()
      and dm.status = 'active' and app.is_member(d.conference_id)
  );
$$;

-- Public wrapper so the app can ask "can I?" for UI hints. Never a substitute
-- for RLS or for the same check inside a server action.
create or replace function public.my_permissions(p_conference uuid)
returns table (permission text, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select rp.permission, null::uuid
  from public.conference_memberships m
  join public.organisational_roles r on r.key = m.role_key
  join public.role_permissions rp on rp.permission_profile = r.permission_profile
  where m.conference_id = p_conference and m.user_id = auth.uid() and m.status = 'active'
    and app.is_active_user()
  union
  select rp.permission, d.id
  from public.department_memberships dm
  join public.departments d on d.id = dm.department_id
  join public.department_roles dr on dr.key = dm.department_role
  join public.role_permissions rp on rp.permission_profile = dr.permission_profile
  where d.conference_id = p_conference and dm.user_id = auth.uid() and dm.status = 'active'
    and app.is_member(p_conference);
$$;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from anon, public;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['conferences', 'profiles', 'conference_memberships', 'departments', 'department_memberships']
  loop
    execute format('create trigger touch_updated_at before update on public.%I
                    for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.conferences            enable row level security;
alter table public.conference_settings    enable row level security;
alter table public.profiles               enable row level security;
alter table public.permissions            enable row level security;
alter table public.permission_profiles    enable row level security;
alter table public.role_permissions       enable row level security;
alter table public.organisational_roles   enable row level security;
alter table public.conference_memberships enable row level security;
alter table public.departments            enable row level security;
alter table public.department_roles       enable row level security;
alter table public.department_memberships enable row level security;

-- Reference data: readable by signed-in users, writable only by migrations.
create policy read_ref on public.permissions          for select to authenticated using (true);
create policy read_ref on public.permission_profiles  for select to authenticated using (true);
create policy read_ref on public.role_permissions     for select to authenticated using (true);
create policy read_ref on public.organisational_roles for select to authenticated using (true);
create policy read_ref on public.department_roles     for select to authenticated using (true);

create policy member_read on public.conferences for select to authenticated
  using (app.is_member(id));
create policy manage on public.conferences for update to authenticated
  using (app.has_permission(id, 'conference.manage'))
  with check (app.has_permission(id, 'conference.manage'));

create policy member_read on public.conference_settings for select to authenticated
  using (app.is_member(conference_id));
create policy manage on public.conference_settings for all to authenticated
  using (app.has_permission(conference_id, 'conference.manage'))
  with check (app.has_permission(conference_id, 'conference.manage'));

-- Profiles: you can see your own, and colleagues in a shared conference.
-- Phone numbers are personal data and are exposed only via the view below.
create policy self_read on public.profiles for select to authenticated
  using (id = auth.uid());
create policy colleague_read on public.profiles for select to authenticated
  using (exists (
    select 1 from public.conference_memberships m
    where m.user_id = profiles.id and app.is_member(m.conference_id)
  ));
create policy self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Column-level grants. Users can't flip their own is_active or change their
-- email here, and phone is never readable from the base table: only via
-- profile_contacts. (A column revoke alone wouldn't work, because Supabase
-- grants table-level SELECT by default.)
revoke all on public.profiles from anon, authenticated;
grant select (id, full_name, email, is_active, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace view public.profile_contacts with (security_barrier = true) as
  select p.id, p.full_name, p.email, p.phone
  from public.profiles p
  where p.id = auth.uid()
     or exists (
       select 1 from public.conference_memberships m
       where m.user_id = p.id and app.has_permission(m.conference_id, 'personal_data.view')
     );
grant select on public.profile_contacts to authenticated;

create policy member_read on public.conference_memberships for select to authenticated
  using (user_id = auth.uid() or app.is_member(conference_id));
create policy manage on public.conference_memberships for all to authenticated
  using (app.has_permission(conference_id, 'members.manage'))
  with check (app.has_permission(conference_id, 'members.manage'));

create policy member_read on public.departments for select to authenticated
  using (app.is_member(conference_id));
create policy manage on public.departments for all to authenticated
  using (app.has_permission(conference_id, 'departments.manage'))
  with check (app.has_permission(conference_id, 'departments.manage'));

create policy member_read on public.department_memberships for select to authenticated
  using (exists (select 1 from public.departments d where d.id = department_id and app.is_member(d.conference_id)));
create policy manage on public.department_memberships for all to authenticated
  using (exists (select 1 from public.departments d where d.id = department_id and app.has_permission(d.conference_id, 'members.manage')))
  with check (exists (select 1 from public.departments d where d.id = department_id and app.has_permission(d.conference_id, 'members.manage')));

-- ---------------------------------------------------------------------------
-- Guard rails on role assignment (enforced in the database, not just the UI)
-- ---------------------------------------------------------------------------
-- Only leadership may grant or revoke a leadership role. A system admin with
-- members.manage cannot make anyone (including themselves) CEO or COO.
create or replace function app.guard_membership_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  touches_leadership boolean;
  conf uuid := coalesce(new.conference_id, old.conference_id);
begin
  -- Migrations, seeds and the bootstrap script run without a user session.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  touches_leadership := (tg_op <> 'INSERT' and old.role_key in ('ceo', 'coo'))
                     or (tg_op <> 'DELETE' and new.role_key in ('ceo', 'coo'));
  if touches_leadership and not app.is_leadership(conf) then
    raise exception 'Only conference leadership can grant or revoke CEO/COO roles'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'revoked' and old.status <> 'revoked' then
    new.revoked_at := now();
    new.revoked_by := auth.uid();
  end if;
  return coalesce(new, old);
end $$;

create trigger guard_membership_change
  before insert or update or delete on public.conference_memberships
  for each row execute function app.guard_membership_change();
