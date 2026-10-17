-- Honeywell evohome runs in Supabase instead of on the Pi:
--   * the `evohome` edge function talks to Honeywell's cloud API,
--   * pg_cron calls it every 5 minutes to refresh temperatures,
--   * a trigger calls it right away when someone queues an evohome command.
--
-- Requires a Vault secret with the project URL (done once, outside migrations):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Honeywell login tokens, kept between function runs. Honeywell rate-limits
-- logins hard, so we reuse tokens instead of logging in on every run.
-- RLS on with no policies: only the service role (the function) can read it.
create table public.evohome_session (
  id smallint primary key default 1 check (id = 1),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  locations jsonb,
  last_poll_at timestamptz,
  auth_failed_at timestamptz
);
alter table public.evohome_session enable row level security;

create function private.invoke_evohome()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/evohome',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.invoke_evohome() from public;

create function private.on_evohome_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.invoke_evohome();
  return new;
end;
$$;

create trigger commands_invoke_evohome
  after insert on public.commands
  for each row
  when (new.device_id like 'evohome:%')
  execute function private.on_evohome_command();

select cron.schedule('evohome-poll', '*/5 * * * *', 'select private.invoke_evohome()');
