-- Rules use OR groups of AND checks. Legacy triggers and weather filters keep
-- their existing behavior. No rules are created or household commands queued.
create function private.automation_rule_valid(rule jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare kind text := rule ->> 'type'; days jsonb; item jsonb;
begin
  if jsonb_typeof(rule) is distinct from 'object' then return false; end if;
  if kind in ('time', 'time_range', 'sun') then
    days := rule -> 'days';
    if jsonb_typeof(days) is distinct from 'array' or jsonb_array_length(days) not between 1 and 7 then return false; end if;
    for item in select value from jsonb_array_elements(days) loop
      if jsonb_typeof(item) <> 'number' or item::text !~ '^[0-6]$' then return false; end if;
    end loop;
  end if;
  return coalesce(case kind
    when 'time' then rule ->> 'at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    when 'time_range' then rule ->> 'from' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and rule ->> 'until' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and rule ->> 'from' <> rule ->> 'until'
    when 'sun' then rule ->> 'event' in ('sunrise','sunset') and jsonb_typeof(rule -> 'offset_minutes') = 'number'
      and (rule ->> 'offset_minutes')::numeric between -180 and 180
      and (rule ->> 'offset_minutes')::numeric = trunc((rule ->> 'offset_minutes')::numeric)
    when 'weather' then private.weather_predicate_valid(rule)
    when 'event' then rule ->> 'event' = 'doorbell.ring'
      and (not rule ? 'device_id' or (jsonb_typeof(rule -> 'device_id') = 'string' and length(rule ->> 'device_id') > 0))
    when 'device' then jsonb_typeof(rule -> 'device_id') = 'string' and length(rule ->> 'device_id') > 0
      and jsonb_typeof(rule -> 'key') = 'string' and length(rule ->> 'key') > 0
      and rule ->> 'op' in ('eq','ne','lt','gt')
      and jsonb_typeof(rule -> 'value') in ('number','boolean','string')
      and (rule ->> 'op' not in ('lt','gt') or jsonb_typeof(rule -> 'value') = 'number')
    else false end, false);
exception when others then return false;
end;
$$;

create function private.automation_trigger_valid(rule jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare grp jsonb; leaf jsonb; total int := 0;
begin
  if rule ->> 'type' <> 'logic' then return private.automation_rule_valid(rule); end if;
  if jsonb_typeof(rule -> 'groups') is distinct from 'array'
     or jsonb_array_length(rule -> 'groups') not between 1 and 12 then return false; end if;
  for grp in select value from jsonb_array_elements(rule -> 'groups') loop
    if jsonb_typeof(grp) <> 'array' or jsonb_array_length(grp) < 1 then return false; end if;
    for leaf in select value from jsonb_array_elements(grp) loop
      total := total + 1;
      if total > 12 or not private.automation_rule_valid(leaf) then return false; end if;
    end loop;
  end loop;
  return total > 0;
exception when others then return false;
end;
$$;

-- Existing rows are left intact; all future inserts/edits use strict validation.
alter table public.automations drop constraint automations_trigger_shape;
alter table public.automations add constraint automations_trigger_shape
  check (private.automation_trigger_valid(trigger)) not valid;

-- NULL means unknown (offline/missing/stale); it cannot produce a crossing.
-- The previous snapshot is supplied by the database trigger, never a client.
create function private.automation_rule_value(rule jsonb, check_at timestamptz, context jsonb, previous boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  at_time timestamptz := check_at;
  local_at timestamp;
  day_number int;
  clock_text text;
  d public.devices;
  w public.weather;
  state jsonb;
  observed timestamptz;
  day jsonb;
  event_time timestamptz;
  scheduled timestamptz;
begin
  if previous and context ->> 'cause' = 'clock' then at_time := check_at - interval '1 minute'; end if;
  local_at := at_time at time zone 'Europe/Amsterdam';
  day_number := extract(dow from local_at)::int;
  clock_text := to_char(local_at, 'HH24:MI');
  case rule ->> 'type'
    when 'time' then
      return clock_text = rule ->> 'at' and rule -> 'days' @> to_jsonb(day_number);
    when 'time_range' then
      if rule ->> 'from' < rule ->> 'until' then
        return clock_text >= rule ->> 'from' and clock_text < rule ->> 'until' and rule -> 'days' @> to_jsonb(day_number);
      end if;
      -- Overnight ranges belong to the day on which they started.
      if clock_text < rule ->> 'until' then day_number := (day_number + 6) % 7; end if;
      return (clock_text >= rule ->> 'from' or clock_text < rule ->> 'until') and rule -> 'days' @> to_jsonb(day_number);
    when 'event' then
      return not previous and context ->> 'cause' = rule ->> 'event'
        and (not rule ? 'device_id' or rule ->> 'device_id' = context ->> 'device_id');
    when 'device' then
      select * into d from public.devices where id = rule ->> 'device_id';
      if not found then return null; end if;
      if previous and context ->> 'cause' = 'device' and context ->> 'device_id' = d.id then
        state := context -> 'previous_state';
        if not coalesce((context ->> 'previous_online')::boolean, false) then return null; end if;
      else
        state := d.state;
        if not d.online then return null; end if;
      end if;
      if jsonb_typeof(state -> (rule ->> 'key')) is distinct from jsonb_typeof(rule -> 'value') then return null; end if;
      return private.matches(state -> (rule ->> 'key'), rule ->> 'op', rule -> 'value');
    when 'weather', 'sun' then
      select * into w from public.weather where id = 1;
      state := w.state;
      observed := w.observed_at;
      if previous and context ->> 'cause' = 'weather' then
        state := context -> 'previous_state'; observed := (context ->> 'previous_observed_at')::timestamptz;
      end if;
      if not private.weather_fresh(observed, at_time) then return null; end if;
      if rule ->> 'type' = 'weather' then
        if not private.weather_value_known(state, rule) then return null; end if;
        return private.weather_value_matches(state, rule);
      end if;
      for day in select value from jsonb_each(w.sun_events) loop
        event_time := (day ->> (rule ->> 'event'))::timestamptz;
        scheduled := event_time + (rule ->> 'offset_minutes')::int * interval '1 minute';
        if date_trunc('minute', scheduled) = date_trunc('minute', at_time)
          and rule -> 'days' @> to_jsonb(extract(dow from event_time at time zone 'Europe/Amsterdam')::int) then return true; end if;
      end loop;
      return false;
    else return null;
  end case;
end;
$$;

create function private.automation_group_value(grp jsonb, check_at timestamptz, context jsonb, previous boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare leaf jsonb; matched boolean; unknown boolean := false;
begin
  for leaf in select value from jsonb_array_elements(grp) loop
    matched := private.automation_rule_value(leaf, check_at, context, previous);
    if matched is false then return false; end if;
    if matched is null then unknown := true; end if;
  end loop;
  if unknown then return null; end if;
  return true;
end;
$$;

create function private.run_logic_automations(check_at timestamptz, context jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.automations; grp jsonb; current_value boolean; previous_value boolean;
begin
  for a in select * from public.automations where enabled and trigger ->> 'type' in ('logic','time_range') for update skip locked loop
    if context ->> 'cause' = 'clock' and a.last_run_at >= date_trunc('minute',check_at) then continue; end if;
    for grp in select value from jsonb_array_elements(case when a.trigger ->> 'type' = 'logic'
      then a.trigger -> 'groups' else jsonb_build_array(jsonb_build_array(a.trigger)) end) loop
      current_value := private.automation_group_value(grp, check_at, context, false);
      previous_value := private.automation_group_value(grp, check_at, context, true);
      -- Each OR branch is an alternative. Queue only once even when two match.
      if current_value is true and previous_value is false then
        perform private.run_automation(a, jsonb_build_object('cause', context ->> 'cause'));
        exit;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.on_device_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  for a in select * from public.automations where enabled and trigger ->> 'type' = 'device' and trigger ->> 'device_id' = new.id loop
    if private.matches(new.state -> (a.trigger ->> 'key'), a.trigger ->> 'op', a.trigger -> 'value')
       and not private.matches(old.state -> (a.trigger ->> 'key'), a.trigger ->> 'op', a.trigger -> 'value') then
      perform private.run_automation(a, jsonb_build_object('cause', 'device', 'device_id', new.id));
    end if;
  end loop;
  perform private.run_logic_automations(now(), jsonb_build_object('cause','device','device_id',new.id,
    'previous_state',old.state,'previous_online',old.online));
  return new;
end;
$$;

create or replace function private.on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  for a in select * from public.automations where enabled and trigger ->> 'type' = 'event'
    and trigger ->> 'event' = new.type and (trigger ->> 'device_id' is null or trigger ->> 'device_id' = new.device_id) loop
    perform private.run_automation(a, jsonb_build_object('cause',new.type,'device_id',new.device_id));
  end loop;
  if new.type = 'doorbell.ring' then
    perform private.run_logic_automations(now(), jsonb_build_object('cause',new.type,'device_id',new.device_id));
  end if;
  return new;
end;
$$;

create or replace function private.on_weather_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  if private.weather_fresh(new.observed_at, now()) and private.weather_fresh(old.observed_at, now()) then
    for a in select * from public.automations where enabled and trigger ->> 'type' = 'weather' loop
      if private.weather_value_known(old.state,a.trigger) and private.weather_value_matches(new.state,a.trigger)
         and not private.weather_value_matches(old.state,a.trigger) then
        perform private.run_automation(a,jsonb_build_object('cause','weather'));
      end if;
    end loop;
  end if;
  perform private.run_logic_automations(now(), jsonb_build_object('cause','weather',
    'previous_state',old.state,'previous_observed_at',old.observed_at));
  return new;
end;
$$;

-- Keep the existing schedule evaluator for legacy rules, then evaluate logic.
alter function private.run_scheduled_automations(timestamptz) rename to run_legacy_scheduled_automations;
create function private.run_scheduled_automations(check_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.run_legacy_scheduled_automations(check_at);
  perform private.run_logic_automations(check_at, jsonb_build_object('cause','clock'));
end;
$$;
-- Rebind the SQL function explicitly after renaming its former dependency.
create or replace function private.run_time_automations()
returns void language sql security definer set search_path = '' as $$
  select private.run_scheduled_automations(now());
$$;

revoke all on function
  private.automation_rule_valid(jsonb), private.automation_trigger_valid(jsonb),
  private.automation_rule_value(jsonb,timestamptz,jsonb,boolean),
  private.automation_group_value(jsonb,timestamptz,jsonb,boolean),
  private.run_logic_automations(timestamptz,jsonb), private.run_scheduled_automations(timestamptz)
from public;
grant execute on function private.automation_rule_valid(jsonb), private.automation_trigger_valid(jsonb) to authenticated;
