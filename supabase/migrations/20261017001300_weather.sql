-- Weather reads and rule evaluation run in the cloud, without the app open.
-- Deployment also sets WEATHER_CRON_SECRET in Edge Function secrets and the
-- matching weather_cron_secret in Vault. No enabled automations are created.

create table public.weather_config (
  id smallint primary key default 1 check (id = 1),
  label text not null,
  postcode text not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180)
);
alter table public.weather_config enable row level security;
create policy "members read weather location" on public.weather_config
  for select to authenticated using ((select private.is_member()));
insert into public.weather_config (label, postcode) values ('Amsterdam · 1011 AB', '1011 AB');

create table public.weather (
  id smallint primary key default 1 check (id = 1),
  state jsonb not null default '{}'::jsonb,
  sun_events jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  error text
);
alter table public.weather enable row level security;
create policy "members read weather" on public.weather
  for select to authenticated using ((select private.is_member()));
grant select on public.weather_config, public.weather to authenticated;
grant select, insert, update, delete on public.weather_config, public.weather to service_role;
insert into public.weather (id) values (1);
alter publication supabase_realtime add table public.weather;

-- Only the service role can claim polls. Prevent overlapping cron invocations.
create function public.claim_weather_poll()
returns boolean language sql security definer set search_path = '' as $$
  with claimed as (
    update public.weather set checked_at = now()
    where id = 1 and (checked_at is null or checked_at < now() - interval '5 minutes')
    returning id
  ) select exists (select 1 from claimed);
$$;
revoke all on function public.claim_weather_poll() from public, anon, authenticated;
grant execute on function public.claim_weather_poll() to service_role;

create function private.weather_predicate_valid(rule jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(rule) = 'object' and case
    when rule ->> 'key' = 'is_day' then
      rule ->> 'op' in ('eq', 'ne') and jsonb_typeof(rule -> 'value') = 'boolean'
    when rule ->> 'key' in ('temperature', 'rain', 'precipitation', 'cloud_cover', 'wind_speed', 'rain_probability') then
      rule ->> 'op' in ('eq', 'ne', 'lt', 'gt') and jsonb_typeof(rule -> 'value') = 'number'
    else false end, false);
$$;

create function private.weather_conditions_valid(conditions jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(conditions) = 'array' then not exists (
    select 1 from jsonb_array_elements(conditions) c
    where c ->> 'type' is distinct from 'weather' or not private.weather_predicate_valid(c)
  ) else false end;
$$;

alter table public.automations drop constraint automations_trigger_shape;
alter table public.automations add constraint automations_trigger_shape check (
  coalesce(jsonb_typeof(trigger) = 'object' and case trigger ->> 'type'
    when 'time' then true when 'device' then true when 'event' then true
    when 'weather' then private.weather_predicate_valid(trigger)
    when 'sun' then trigger ->> 'event' in ('sunrise', 'sunset')
      and jsonb_typeof(trigger -> 'offset_minutes') = 'number'
      and (trigger ->> 'offset_minutes')::numeric between -180 and 180
      and (trigger ->> 'offset_minutes')::numeric = trunc((trigger ->> 'offset_minutes')::numeric)
      and jsonb_typeof(trigger -> 'days') = 'array'
    else false end, false)
);
alter table public.automations add constraint automations_conditions_shape
  check (private.weather_conditions_valid(conditions));

-- Strictly fresh model readings only. A provider outage must not look like 0°C,
-- no rain, or permission to act on an old forecast.
create function private.weather_fresh(observed timestamptz, check_at timestamptz)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(observed between check_at - interval '45 minutes' and check_at + interval '5 minutes', false);
$$;

create function private.weather_value_known(state jsonb, rule jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(state -> (rule ->> 'key')) =
    case when rule ->> 'key' = 'is_day' then 'boolean' else 'number' end, false);
$$;

create function private.weather_value_matches(state jsonb, rule jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select private.weather_predicate_valid(rule)
    and private.weather_value_known(state, rule)
    and private.matches(state -> (rule ->> 'key'), rule ->> 'op', rule -> 'value');
$$;

create function private.weather_conditions_allow(conditions jsonb, check_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when conditions = '[]'::jsonb then true else
    private.weather_conditions_valid(conditions) and exists (
      select 1 from public.weather w where w.id = 1 and private.weather_fresh(w.observed_at, check_at)
        and not exists (
          select 1 from jsonb_array_elements(conditions) c where not private.weather_value_matches(w.state, c)
        )
    ) end;
$$;

-- Preserve device actions and dynamic scenes, adding conditions and a row lock.
create or replace function private.run_automation(a public.automations, cause jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rule public.automations;
  act jsonb;
begin
  select * into rule from public.automations where id = a.id for update;
  if not found or not rule.enabled
     or (rule.last_run_at is not null and rule.last_run_at > now() - interval '10 seconds')
     or not private.weather_conditions_allow(rule.conditions, now()) then return; end if;
  update public.automations set last_run_at = now() where id = rule.id;
  for act in select value from jsonb_array_elements(rule.actions) loop
    if act ? 'scene_id' then
      perform private.queue_scene((act ->> 'scene_id')::uuid, 'automation:' || rule.id, null);
    elsif exists (select 1 from public.devices where id = act ->> 'device_id') then
      insert into public.commands (device_id, action, params, source, created_by)
      values (act ->> 'device_id', act ->> 'action', coalesce(act -> 'params', '{}'::jsonb), 'automation:' || rule.id, null);
    end if;
  end loop;
  insert into public.events (type, data)
  values ('automation.run', jsonb_build_object('automation_id', rule.id, 'name', rule.name) || cause);
end;
$$;

create function private.on_weather_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  -- Initial setup and recovery from stale data are not threshold crossings.
  if not private.weather_fresh(new.observed_at, now())
     or not private.weather_fresh(old.observed_at, now()) then return new; end if;
  for a in select * from public.automations where enabled and trigger ->> 'type' = 'weather' loop
    if private.weather_value_known(old.state, a.trigger)
       and private.weather_value_matches(new.state, a.trigger)
       and not private.weather_value_matches(old.state, a.trigger) then
      perform private.run_automation(a, jsonb_build_object('cause', 'weather'));
    end if;
  end loop;
  return new;
end;
$$;
create trigger weather_run_automations after update on public.weather
  for each row when (old.state is distinct from new.state)
  execute function private.on_weather_change();

-- Daily sunrise/sunset instants are supplied in UTC by Open-Meteo. Offsets use
-- actual instants; days are interpreted in Amsterdam, including DST changes.
create function private.run_scheduled_automations(check_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  local_now timestamp := check_at at time zone 'Europe/Amsterdam';
  a public.automations;
  w public.weather;
  day jsonb;
  scheduled timestamptz;
  event_time timestamptz;
begin
  select * into w from public.weather where id = 1;
  for a in select * from public.automations where enabled and trigger ->> 'type' in ('time', 'sun') for update skip locked loop
    if a.trigger ->> 'type' = 'time' then
      if a.trigger ->> 'at' = to_char(local_now, 'HH24:MI')
         and (a.trigger -> 'days' is null or a.trigger -> 'days' @> to_jsonb(extract(dow from local_now)::int))
         and (a.last_run_at is null or a.last_run_at < date_trunc('minute', check_at))
         and private.weather_conditions_allow(a.conditions, check_at) then
        perform private.run_automation(a, jsonb_build_object('cause', 'time'));
      end if;
    elsif private.weather_fresh(w.observed_at, check_at) then
      for day in select value from jsonb_each(w.sun_events) loop
        event_time := (day ->> (a.trigger ->> 'event'))::timestamptz;
        scheduled := event_time + (a.trigger ->> 'offset_minutes')::int * interval '1 minute';
        if date_trunc('minute', scheduled) = date_trunc('minute', check_at)
           and a.trigger -> 'days' @> to_jsonb(extract(dow from event_time at time zone 'Europe/Amsterdam')::int)
           and (a.last_run_at is null or a.last_run_at < date_trunc('minute', scheduled))
           and private.weather_conditions_allow(a.conditions, check_at) then
          perform private.run_automation(a, jsonb_build_object('cause', 'sun', 'event', a.trigger ->> 'event'));
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

create or replace function private.run_time_automations()
returns void language sql security definer set search_path = '' as $$
  select private.run_scheduled_automations(now());
$$;

create function private.invoke_weather()
returns void language plpgsql security definer set search_path = '' as $$
declare
  project_url text;
  cron_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'weather_cron_secret';
  if project_url is null or cron_secret is null then return; end if;
  perform net.http_post(
    url := project_url || '/functions/v1/weather',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb, timeout_milliseconds := 45000
  );
end;
$$;

revoke all on function
  private.weather_predicate_valid(jsonb), private.weather_conditions_valid(jsonb),
  private.weather_fresh(timestamptz, timestamptz), private.weather_value_matches(jsonb, jsonb),
  private.weather_value_known(jsonb, jsonb),
  private.weather_conditions_allow(jsonb, timestamptz), private.on_weather_change(),
  private.run_scheduled_automations(timestamptz), private.invoke_weather()
from public;
-- Check constraints execute these validators as the signed-in member.
grant execute on function private.weather_predicate_valid(jsonb), private.weather_conditions_valid(jsonb) to authenticated;
revoke all on function private.run_automation(public.automations, jsonb), private.run_time_automations() from public;

select cron.schedule('weather-poll', '*/15 * * * *', 'select private.invoke_weather()');
