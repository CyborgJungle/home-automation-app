-- Health per integration, written by whoever runs it: the Pi agent (tradfri,
-- eufy) or the evohome edge function. Replaces agent_status.integrations (now
-- unused), since evohome no longer runs on the Pi.

create table public.integration_status (
  name text primary key,                -- 'tradfri' | 'eufy' | 'evohome'
  ok boolean not null,
  error text,
  updated_at timestamptz not null default now()
);
alter table public.integration_status enable row level security;

create policy "members read integration status"
  on public.integration_status for select
  to authenticated
  using ((select private.is_member()));

alter publication supabase_realtime add table public.integration_status;
