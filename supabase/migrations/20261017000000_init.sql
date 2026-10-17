-- Home automation schema.
--
-- Who writes what:
--   * The Raspberry Pi agent uses the secret (service-role) key, so it bypasses RLS.
--     It owns `devices`, `events`, `agent_status` and executes `commands`.
--   * Household members (allow-listed emails) use the web app with their own login.
--     They read everything, queue `commands`, and manage `automations`.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Membership
-- ---------------------------------------------------------------------------

-- Only these emails can see or control the house, even if someone else
-- manages to create a Supabase Auth account.
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- No policies: only the SQL editor / service role can read or change it.

create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function private.is_member() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_member() to authenticated;

-- ---------------------------------------------------------------------------
-- Devices (written by the agent)
-- ---------------------------------------------------------------------------

create table public.devices (
  id text primary key,                 -- e.g. 'tradfri:65537', 'evohome:zone:5262675'
  integration text not null check (integration in ('tradfri', 'evohome', 'eufy')),
  kind text not null check (kind in ('light', 'group', 'plug', 'blind', 'sensor', 'remote', 'zone', 'heating', 'doorbell')),
  name text not null,
  room text,
  online boolean not null default true,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.devices enable row level security;

create policy "members read devices"
  on public.devices for select
  to authenticated
  using ((select private.is_member()));

-- ---------------------------------------------------------------------------
-- Commands (queued by the app or automations, executed by the agent)
-- ---------------------------------------------------------------------------

create table public.commands (
  id bigint generated always as identity primary key,
  device_id text not null references public.devices (id) on delete cascade,
  action text not null,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  error text,
  source text not null default 'app',  -- 'app' or 'automation:<uuid>'
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.commands enable row level security;

create index commands_pending_idx on public.commands (created_at) where status = 'pending';
create index commands_device_idx on public.commands (device_id);
create index commands_created_by_idx on public.commands (created_by);

create policy "members read commands"
  on public.commands for select
  to authenticated
  using ((select private.is_member()));

create policy "members queue commands"
  on public.commands for insert
  to authenticated
  with check (
    (select private.is_member())
    and status = 'pending'
    and source = 'app'
    and created_by = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Events (doorbell rings, automation runs, ...; written by the agent)
-- ---------------------------------------------------------------------------

create table public.events (
  id bigint generated always as identity primary key,
  device_id text references public.devices (id) on delete set null,
  type text not null,                  -- 'doorbell.ring', 'automation.run', ...
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;

create index events_created_at_idx on public.events (created_at desc);
create index events_device_idx on public.events (device_id);

create policy "members read events"
  on public.events for select
  to authenticated
  using ((select private.is_member()));

-- ---------------------------------------------------------------------------
-- Automations (edited in the app, evaluated by the agent)
-- ---------------------------------------------------------------------------

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  enabled boolean not null default true,
  -- {"type":"time","at":"07:00","days":[1,2,3,4,5]}
  -- {"type":"sun","event":"sunset","offset_minutes":-15,"days":[0,1,2,3,4,5,6]}
  -- {"type":"doorbell"}
  trigger jsonb not null,
  -- [{"type":"dark"}]
  conditions jsonb not null default '[]'::jsonb,
  -- [{"device_id":"tradfri:131073","action":"set","params":{"on":true,"brightness":80}}]
  actions jsonb not null default '[]'::jsonb,
  last_run_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.automations enable row level security;

create index automations_created_by_idx on public.automations (created_by);

create policy "members read automations"
  on public.automations for select
  to authenticated
  using ((select private.is_member()));

create policy "members create automations"
  on public.automations for insert
  to authenticated
  with check ((select private.is_member()));

create policy "members update automations"
  on public.automations for update
  to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "members delete automations"
  on public.automations for delete
  to authenticated
  using ((select private.is_member()));

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger automations_touch_updated_at
  before update on public.automations
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Agent heartbeat (single row, written by the agent)
-- ---------------------------------------------------------------------------

create table public.agent_status (
  id smallint primary key default 1 check (id = 1),
  version text,
  started_at timestamptz,
  last_seen timestamptz,
  -- {"tradfri":{"ok":true},"evohome":{"ok":false,"error":"..."},"eufy":{"ok":true}}
  integrations jsonb not null default '{}'::jsonb
);
alter table public.agent_status enable row level security;

create policy "members read agent status"
  on public.agent_status for select
  to authenticated
  using ((select private.is_member()));

-- ---------------------------------------------------------------------------
-- Realtime: the dashboard and the agent subscribe to these.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.devices,
  public.commands,
  public.events,
  public.automations,
  public.agent_status;
