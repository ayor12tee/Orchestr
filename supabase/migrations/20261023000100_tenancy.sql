-- =============================================================================
-- 0001 Tenancy: organizations, editable roles, units, teams and memberships
--
-- Isolation model
--   * Every tenant-owned row carries organization_id, and every policy checks
--     the caller's active membership of that organization. Nothing is shared
--     between organizations except the global permission catalogue.
--   * Composite foreign keys (id, organization_id) make it impossible to point
--     a row at another organization's role, team or member, even with
--     service-role access.
--
-- Permission model
--   * The permission catalogue is fixed by the platform (the app's code
--     checks these keys). Roles are defined and edited by each organization.
--   * A role has a scope:
--       organization  grants organization permissions to org members,
--       project       is assigned per project (project_members, migration 0002),
--       team          is assigned per team and applies to that team's work.
--     A user can hold different roles in different projects and teams.
--   * Every organization is created with editable starter roles. The Owner
--     role always holds every organization permission and at least one active
--     member must keep it, so an organization can't lock itself out.
--   * No escalation: you can only grant a role, or add a permission to an
--     organization role, if you already hold every permission involved. Only
--     an Owner can grant or remove the Owner role.
-- =============================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text not null,
  phone       text,          -- personal data: exposed only via profile_contacts
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index profiles_email_key on public.profiles (lower(email));

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
-- Organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  name        text not null check (length(trim(name)) between 1 and 120),
  -- IANA zone used for "today" in this organization (projects may override).
  timezone    text not null default 'UTC',
  -- What this organization calls its top-level units ("Department", "Division", "Faculty"...).
  unit_label  text not null default 'Department' check (length(trim(unit_label)) between 1 and 40),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function app.check_timezone() returns trigger
language plpgsql as $$
begin
  if new.timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone "%"', new.timezone using errcode = '23514';
  end if;
  return new;
end $$;

create trigger check_timezone before insert or update of timezone on public.organizations
  for each row execute function app.check_timezone();

-- ---------------------------------------------------------------------------
-- Permission catalogue (platform-defined) and organization-defined roles
-- ---------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,
  scope        text not null check (scope in ('organization', 'project')),
  description  text not null,
  sort_order   int not null default 0
);

insert into public.permissions (key, scope, description, sort_order) values
  ('org.manage',         'organization', 'Edit the organization''s name, time zone and settings', 10),
  ('members.manage',     'organization', 'Invite people, assign organization and team roles, suspend access', 20),
  ('roles.manage',       'organization', 'Create and edit roles and what they allow', 30),
  ('structure.manage',   'organization', 'Create and edit units and teams', 40),
  ('projects.create',    'organization', 'Create projects', 50),
  ('projects.view_all',  'organization', 'See every project in the organization (read-only)', 60),
  ('projects.manage_all','organization', 'Full control of every project in the organization', 70),
  ('portfolios.manage',  'organization', 'Create and edit portfolios', 80),
  ('personal_data.view', 'organization', 'See colleagues'' personal contact details', 90),
  ('audit.view',         'organization', 'Read the audit log', 100),
  ('project.view',       'project', 'See the project, its plan and its dashboards', 110),
  ('project.manage',     'project', 'Edit project settings, add people and teams to the project', 120),
  ('tasks.view',         'project', 'See tasks', 130),
  ('tasks.create',       'project', 'Create tasks', 140),
  ('tasks.edit',         'project', 'Edit any field of a task', 150),
  ('tasks.assign',       'project', 'Assign and reassign tasks', 160),
  ('tasks.delete',       'project', 'Delete tasks', 170),
  ('dependencies.manage','project', 'Create, edit and remove dependencies', 180),
  ('baseline.approve',   'project', 'Approve planning values and the schedule baseline', 190),
  ('approvals.decide',   'project', 'Approve exceptions and act as an approver', 200);

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope           text not null check (scope in ('organization', 'project', 'team')),
  name            text not null check (length(trim(name)) between 1 and 60),
  description     text,
  -- Stable handle for starter roles the app refers to (e.g. who becomes lead
  -- of a new project). Null for roles an organization creates itself.
  system_key      text,
  is_owner        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, scope, name),
  unique (organization_id, system_key),
  unique (id, organization_id),
  constraint owner_is_org_role check (not is_owner or scope = 'organization')
);
create unique index roles_one_owner on public.roles (organization_id) where is_owner;

create table public.role_permissions (
  role_id     uuid not null references public.roles(id) on delete cascade,
  permission  text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission)
);

-- ---------------------------------------------------------------------------
-- Memberships, units and teams
-- ---------------------------------------------------------------------------
create table public.org_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  -- Anything other than 'active' grants nothing.
  status          text not null default 'active' check (status in ('active', 'suspended')),
  title           text,   -- free-text job title, e.g. "COO"
  invited_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id) where status = 'active';

create table public.org_member_roles (
  organization_id uuid not null,
  user_id         uuid not null,
  role_id         uuid not null,
  primary key (organization_id, user_id, role_id),
  foreign key (organization_id, user_id) references public.org_members(organization_id, user_id) on delete cascade,
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete restrict
);

create table public.org_units (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id       uuid,
  name            text not null check (length(trim(name)) between 1 and 120),
  description     text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id),
  unique nulls not distinct (organization_id, parent_id, name),
  -- A unit with sub-units can't be deleted until they're moved or removed.
  foreign key (parent_id, organization_id) references public.org_units(id, organization_id) on delete restrict
);

create table public.teams (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  org_unit_id     uuid,
  name            text not null check (length(trim(name)) between 1 and 120),
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  foreign key (org_unit_id, organization_id) references public.org_units(id, organization_id) on delete set null (org_unit_id)
);

create table public.team_members (
  team_id         uuid not null,
  organization_id uuid not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role_id         uuid not null,
  created_at      timestamptz not null default now(),
  primary key (team_id, user_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id) on delete cascade,
  foreign key (organization_id, user_id) references public.org_members(organization_id, user_id) on delete cascade,
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete restrict
);
create index team_members_user_idx on public.team_members (user_id);

-- ---------------------------------------------------------------------------
-- Audit log (append-only, written by triggers)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid,
  project_id      uuid,
  table_name      text not null,
  record_id       text,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id        uuid,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Authorisation helpers (SECURITY DEFINER so policies don't recurse)
-- ---------------------------------------------------------------------------
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and exists (
    select 1 from public.org_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function app.has_org_permission(p_org uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_org_member(p_org) and exists (
    select 1 from public.org_member_roles mr
    join public.role_permissions rp on rp.role_id = mr.role_id
    where mr.organization_id = p_org and mr.user_id = auth.uid() and rp.permission = p_permission
  );
$$;

create or replace function app.is_org_owner(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_org_member(p_org) and exists (
    select 1 from public.org_member_roles mr join public.roles r on r.id = mr.role_id
    where mr.organization_id = p_org and mr.user_id = auth.uid() and r.is_owner
  );
$$;

-- Organization permissions a given member holds (used for "no escalation" checks).
create or replace function app.member_org_permissions(p_org uuid, p_user uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct rp.permission
  from public.org_member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
  join public.org_members m on m.organization_id = mr.organization_id and m.user_id = mr.user_id
  where mr.organization_id = p_org and mr.user_id = p_user and m.status = 'active';
$$;

-- True while create_organization() is laying down an organization's starter
-- data, so the escalation guards don't block the founder's first role.
create or replace function app.bootstrapping(p_org uuid) returns boolean
language sql stable as $$
  select coalesce(current_setting('app.bootstrap_org', true), '') = p_org::text;
$$;

create or replace function public.my_org_permissions(p_org uuid) returns setof text
language sql stable security definer set search_path = '' as $$
  select p from app.member_org_permissions(p_org, auth.uid()) p where app.is_org_member(p_org);
$$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Permissions must match the role's scope: organization roles carry
-- organization permissions; project and team roles carry project permissions.
-- Adding a permission to an organization role needs that permission yourself,
-- and the Owner role's permissions are fixed.
create or replace function app.guard_role_permission() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  p_scope text;
  expected text;
begin
  select * into r from public.roles where id = coalesce(new.role_id, old.role_id);
  if r.id is null then
    return coalesce(new, old);  -- the role itself is being deleted
  end if;
  if tg_op = 'INSERT' then
    select scope into p_scope from public.permissions where key = new.permission;
    -- (Computed first: a CASE's THEN inside an IF condition ends the condition early.)
    expected := (case when r.scope = 'organization' then 'organization' else 'project' end);
    if p_scope <> expected then
      raise exception 'A % role can''t include the % permission "%"', r.scope, p_scope, new.permission using errcode = '23514';
    end if;
  end if;
  if auth.uid() is not null and not app.bootstrapping(r.organization_id) then
    if r.is_owner then
      raise exception 'The Owner role always has every organization permission' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and r.scope = 'organization'
       and not app.has_org_permission(r.organization_id, new.permission) then
      raise exception 'You can''t grant the "%" permission because you don''t hold it' , new.permission using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger guard_role_permission before insert or delete on public.role_permissions
  for each row execute function app.guard_role_permission();

create or replace function app.guard_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id or new.scope <> old.scope or new.is_owner <> old.is_owner
       or new.system_key is distinct from old.system_key then
      raise exception 'A role''s organization, scope and built-in status can''t change' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;
  -- DELETE. The organization itself is being deleted: let the cascade through.
  if not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  if old.is_owner then
    raise exception 'The Owner role can''t be deleted' using errcode = '42501';
  end if;
  return old;
end $$;

create trigger guard_role before update or delete on public.roles
  for each row execute function app.guard_role();

-- Assigning a role: it must be the right scope, and you must already hold
-- every permission it grants. Only an Owner can grant or remove Owner.
create or replace function app.check_grantable(p_org uuid, p_role uuid, p_scope text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  missing text;
begin
  select * into r from public.roles where id = p_role;
  -- Checked before anything else so nothing about another tenant's role leaks.
  if r.id is null or r.organization_id <> p_org then
    raise exception 'That role belongs to a different organization' using errcode = '23503';
  end if;
  if r.scope <> p_scope then
    raise exception 'That is a % role, not a % role', r.scope, p_scope using errcode = '23514';
  end if;
  if auth.uid() is null or app.bootstrapping(r.organization_id) then
    return;
  end if;
  if r.is_owner and not app.is_org_owner(r.organization_id) then
    raise exception 'Only an Owner can grant or remove the Owner role' using errcode = '42501';
  end if;
  if r.scope = 'organization' then
    select rp.permission into missing from public.role_permissions rp
    where rp.role_id = r.id and not app.has_org_permission(r.organization_id, rp.permission) limit 1;
    if missing is not null then
      raise exception 'You can''t grant this role because it includes "%", which you don''t hold', missing using errcode = '42501';
    end if;
  end if;
end $$;

create or replace function app.guard_org_member_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = coalesce(new.organization_id, old.organization_id)) then
    return coalesce(new, old);
  end if;
  perform app.check_grantable(coalesce(new.organization_id, old.organization_id), coalesce(new.role_id, old.role_id), 'organization');
  return coalesce(new, old);
end $$;

create trigger guard_org_member_role before insert or delete on public.org_member_roles
  for each row execute function app.guard_org_member_role();

create or replace function app.guard_team_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' or new.role_id <> old.role_id then
    perform app.check_grantable(new.organization_id, new.role_id, 'team');
  end if;
  return new;
end $$;

create trigger guard_team_member before insert or update on public.team_members
  for each row execute function app.guard_team_member();

-- Suspending or removing someone who holds permissions you don't is refused,
-- so an administrator can't remove the Owner.
create or replace function app.guard_org_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
  org    uuid := coalesce(new.organization_id, old.organization_id);
begin
  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception 'A membership can''t be moved' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = org) then
    return coalesce(new, old);
  end if;
  if auth.uid() is not null and target <> auth.uid() and not app.bootstrapping(org)
     and (tg_op = 'DELETE' or new.status <> old.status) then
    -- Administrators can hold every permission an Owner has, so this is checked separately.
    if exists (select 1 from public.org_member_roles mr join public.roles r on r.id = mr.role_id and r.is_owner
               where mr.organization_id = org and mr.user_id = target)
       and not app.is_org_owner(org) then
      raise exception 'Only an Owner can suspend or remove an Owner' using errcode = '42501';
    end if;
    if exists (select p from app.member_org_permissions(org, target) p
               except select p from app.member_org_permissions(org, auth.uid()) p) then
      raise exception 'You can''t change access for someone with permissions you don''t hold' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return coalesce(new, old);
end $$;

create trigger guard_org_member before update or delete on public.org_members
  for each row execute function app.guard_org_member();

-- Lock-out prevention: checked at commit, so a transaction may hand Owner
-- to someone else and then drop its own.
create or replace function app.assert_org_has_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  org uuid := coalesce(new.organization_id, old.organization_id);
begin
  if exists (select 1 from public.organizations where id = org) and not exists (
    select 1 from public.org_member_roles mr
    join public.roles r on r.id = mr.role_id and r.is_owner
    join public.org_members m on m.organization_id = mr.organization_id and m.user_id = mr.user_id and m.status = 'active'
    join public.profiles p on p.id = m.user_id and p.is_active
    where mr.organization_id = org
  ) then
    raise exception 'An organization must keep at least one active Owner' using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger keep_an_owner after delete on public.org_member_roles
  deferrable initially deferred for each row execute function app.assert_org_has_owner();
create constraint trigger keep_an_owner after update or delete on public.org_members
  deferrable initially deferred for each row execute function app.assert_org_has_owner();

-- Units form a tree: no loops, and a parent must belong to the same organization (FK).
create or replace function app.guard_org_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id <> old.organization_id then
    raise exception 'A unit can''t move to another organization' using errcode = '42501';
  end if;
  if new.parent_id is not null and exists (
    with recursive up(id) as (
      select new.parent_id
      union
      select u.parent_id from public.org_units u join up on u.id = up.id where u.parent_id is not null
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'A unit can''t sit inside itself' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger guard_org_unit before insert or update on public.org_units
  for each row execute function app.guard_org_unit();

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger touch_updated_at before update on public.organizations
  for each row execute function app.touch_updated_at();
create trigger touch_updated_at before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger touch_updated_at before update on public.teams
  for each row execute function app.touch_updated_at();

-- Generic audit trigger. Finds the organization and project from the row.
create or replace function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  org uuid;
begin
  org := case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid else (rec ->> 'organization_id')::uuid end;
  if org is null and rec ? 'role_id' then
    select r.organization_id into org from public.roles r where r.id = (rec ->> 'role_id')::uuid;
  end if;
  insert into public.audit_log (organization_id, project_id, table_name, record_id, action, actor_id, before, after)
  values (org, (rec ->> 'project_id')::uuid, tg_table_name,
          coalesce(rec ->> 'id', concat_ws(':', rec ->> 'organization_id', rec ->> 'user_id', rec ->> 'role_id', rec ->> 'team_id', rec ->> 'permission')),
          tg_op, auth.uid(),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['organizations', 'roles', 'role_permissions', 'org_members', 'org_member_roles',
                           'org_units', 'teams', 'team_members']
  loop
    execute format('create trigger audit after insert or update or delete on public.%I
                    for each row execute function app.audit_row()', t);
  end loop;
end $$;
create trigger audit after update on public.profiles
  for each row when (old.is_active is distinct from new.is_active)
  execute function app.audit_row();

-- ---------------------------------------------------------------------------
-- Creating an organization (self-serve): the caller becomes its first Owner
-- and it starts with editable starter roles.
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text, p_timezone text default 'UTC')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  org uuid;
  v_role uuid;
  starter record;
begin
  if auth.uid() is null or not app.is_active_user() then
    raise exception 'Sign in to create an organization' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, timezone, created_by)
  values (trim(p_name), lower(trim(p_slug)), coalesce(nullif(p_timezone, ''), 'UTC'), auth.uid())
  returning id into org;
  perform set_config('app.bootstrap_org', org::text, true);

  insert into public.org_members (organization_id, user_id) values (org, auth.uid());

  for starter in
    select * from (values
      ('organization', 'owner', 'Owner', 'Full control. Every organization permission; can''t be edited or removed while it''s the last one.', true,
        array(select key from public.permissions where scope = 'organization')),
      ('organization', 'admin', 'Administrator', 'Runs the organization day to day: people, roles, structure and every project.', false,
        array(select key from public.permissions where scope = 'organization')),
      ('organization', 'executive', 'Executive', 'Sees every project and portfolio, read-only unless also given project roles.', false,
        array['projects.view_all', 'personal_data.view']),
      ('organization', 'member', 'Member', 'Belongs to the organization. Sees the projects and teams they''re added to.', false,
        array[]::text[]),
      ('project', 'project_lead', 'Project Lead', 'Full control of the project.', false,
        array(select key from public.permissions where scope = 'project')),
      ('project', 'contributor', 'Contributor', 'Works on the project: creates and updates tasks.', false,
        array['project.view', 'tasks.view', 'tasks.create', 'tasks.edit']),
      ('project', 'viewer', 'Viewer', 'Read-only access to the project.', false,
        array['project.view', 'tasks.view']),
      ('team', 'team_lead', 'Team Lead', 'Manages the team''s work in the projects it''s part of.', false,
        array['tasks.view', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.delete', 'dependencies.manage']),
      ('team', 'team_member', 'Team Member', 'Sees and creates the team''s tasks; updates the ones they''re involved in.', false,
        array['tasks.view', 'tasks.create'])
    ) as s(scope, system_key, name, description, is_owner, perms)
  loop
    insert into public.roles (organization_id, scope, system_key, name, description, is_owner)
    values (org, starter.scope, starter.system_key, starter.name, starter.description, starter.is_owner)
    returning id into v_role;
    insert into public.role_permissions (role_id, permission) select v_role, unnest(starter.perms);
    if starter.is_owner then
      insert into public.org_member_roles (organization_id, user_id, role_id) values (org, auth.uid(), v_role);
    end if;
  end loop;

  perform set_config('app.bootstrap_org', '', true);
  return org;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.organizations     enable row level security;
alter table public.permissions       enable row level security;
alter table public.roles             enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.org_members       enable row level security;
alter table public.org_member_roles  enable row level security;
alter table public.org_units         enable row level security;
alter table public.teams             enable row level security;
alter table public.team_members      enable row level security;
alter table public.audit_log         enable row level security;

create policy read_catalogue on public.permissions for select to authenticated using (true);

create policy member_read on public.organizations for select to authenticated
  using (app.is_org_member(id));
create policy manage on public.organizations for update to authenticated
  using (app.has_org_permission(id, 'org.manage'))
  with check (app.has_org_permission(id, 'org.manage'));
-- No insert policy: organizations are created through create_organization().
-- No delete policy: deleting a tenant is a deliberate operation, not a button.

create policy member_read on public.roles for select to authenticated
  using (app.is_org_member(organization_id));
create policy manage on public.roles for all to authenticated
  using (app.has_org_permission(organization_id, 'roles.manage'))
  with check (app.has_org_permission(organization_id, 'roles.manage'));

create policy member_read on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and app.is_org_member(r.organization_id)));
create policy manage on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and app.has_org_permission(r.organization_id, 'roles.manage')))
  with check (exists (select 1 from public.roles r where r.id = role_id and app.has_org_permission(r.organization_id, 'roles.manage')));

create policy member_read on public.org_members for select to authenticated
  using (user_id = auth.uid() or app.is_org_member(organization_id));
create policy manage on public.org_members for all to authenticated
  using (app.has_org_permission(organization_id, 'members.manage'))
  with check (app.has_org_permission(organization_id, 'members.manage'));

create policy member_read on public.org_member_roles for select to authenticated
  using (user_id = auth.uid() or app.is_org_member(organization_id));
create policy manage on public.org_member_roles for all to authenticated
  using (app.has_org_permission(organization_id, 'members.manage'))
  with check (app.has_org_permission(organization_id, 'members.manage'));

create policy member_read on public.org_units for select to authenticated
  using (app.is_org_member(organization_id));
create policy manage on public.org_units for all to authenticated
  using (app.has_org_permission(organization_id, 'structure.manage'))
  with check (app.has_org_permission(organization_id, 'structure.manage'));

create policy member_read on public.teams for select to authenticated
  using (app.is_org_member(organization_id));
create policy manage on public.teams for all to authenticated
  using (app.has_org_permission(organization_id, 'structure.manage'))
  with check (app.has_org_permission(organization_id, 'structure.manage'));

create policy member_read on public.team_members for select to authenticated
  using (app.is_org_member(organization_id));
create policy manage on public.team_members for all to authenticated
  using (app.has_org_permission(organization_id, 'members.manage') or app.has_org_permission(organization_id, 'structure.manage'))
  with check (app.has_org_permission(organization_id, 'members.manage') or app.has_org_permission(organization_id, 'structure.manage'));

create policy view on public.audit_log for select to authenticated
  using (organization_id is not null and app.has_org_permission(organization_id, 'audit.view'));
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- Profiles: your own, and people who share an organization with you.
-- Phone numbers are only readable through profile_contacts.
create policy self_read on public.profiles for select to authenticated
  using (id = auth.uid());
create policy colleague_read on public.profiles for select to authenticated
  using (exists (
    select 1 from public.org_members m
    where m.user_id = profiles.id and app.is_org_member(m.organization_id)
  ));
create policy self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select (id, full_name, email, is_active, created_at, updated_at) on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create or replace view public.profile_contacts with (security_barrier = true) as
  select p.id, p.full_name, p.email, p.phone
  from public.profiles p
  where p.id = auth.uid()
     or exists (
       select 1 from public.org_members m
       where m.user_id = p.id and m.status = 'active'
         and app.has_org_permission(m.organization_id, 'personal_data.view')
     );
grant select on public.profile_contacts to authenticated;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on all functions in schema app from anon, public;
revoke execute on function public.create_organization(text, text, text) from anon, public;
grant execute on function public.create_organization(text, text, text) to authenticated;
