-- IKEA DIRIGERA hub (replaces the TRÅDFRI gateway), and remote button presses
-- as triggers. A button.press rule names the remote and optionally one press
-- pattern (singlePress, doublePress, longPress); it works on its own and inside
-- And/Or rules.
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('dirigera', 'tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple'));

create or replace function private.automation_rule_valid(rule jsonb)
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
    when 'event' then (rule ->> 'event' = 'doorbell.ring'
        or (rule ->> 'event' = 'button.press' and rule ? 'device_id'
          and (not rule ? 'pattern' or rule ->> 'pattern' in ('singlePress', 'doublePress', 'longPress'))))
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

create or replace function private.automation_rule_value(rule jsonb, check_at timestamptz, context jsonb, previous boolean)
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
        and (not rule ? 'device_id' or rule ->> 'device_id' = context ->> 'device_id')
        and (not rule ? 'pattern' or rule ->> 'pattern' = context ->> 'pattern');
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

create or replace function private.on_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare a public.automations;
begin
  for a in select * from public.automations where enabled and trigger ->> 'type' = 'event'
    and trigger ->> 'event' = new.type and (trigger ->> 'device_id' is null or trigger ->> 'device_id' = new.device_id)
    and (trigger ->> 'pattern' is null or trigger ->> 'pattern' = new.data ->> 'pattern') loop
    perform private.run_automation(a, jsonb_build_object('cause',new.type,'device_id',new.device_id));
  end loop;
  if new.type in ('doorbell.ring', 'button.press') then
    perform private.run_logic_automations(now(), jsonb_build_object('cause',new.type,'device_id',new.device_id,
      'pattern',new.data ->> 'pattern'));
  end if;
  return new;
end;
$$;
