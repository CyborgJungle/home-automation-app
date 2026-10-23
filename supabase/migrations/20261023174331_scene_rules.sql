-- Automations can check a scene: "Avond is on" / "Avond is off".
-- {"type": "scene", "scene_id": "...", "value": true}
-- A scene is on when every device in it looks the way the scene sets it, the
-- same test the Scenes page uses (web/lib/scenes.ts): offline devices and
-- actions that can't be checked don't count either way, and at least one
-- action must be checked. When a device change is being judged, that device's
-- previous state is used for the "before" picture, like device rules.

-- jsonb → boolean the way JavaScript's Boolean() reads it ("Steam Machine" is true).
create function private.truthy(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case jsonb_typeof(v)
    when 'boolean' then v::text::boolean
    when 'string' then v #>> '{}' <> ''
    when 'number' then v::text::numeric <> 0
    when 'object' then true
    when 'array' then true
    else false end;
$$;

-- null = this action can't be checked (e.g. "stop"), so it doesn't count.
create function private.scene_action_satisfied(a jsonb, s jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  p jsonb := coalesce(a -> 'params', '{}'::jsonb);
  k text;
  want jsonb;
  diff numeric;
begin
  case a ->> 'action'
    when 'set' then
      for k, want in select key, value from jsonb_each(p) loop
        if k = 'on' then
          if private.truthy(s -> 'on') is distinct from private.truthy(want) then return false; end if;
        elsif not s ? k then
          continue; -- e.g. room groups don't report brightness
        elsif k in ('brightness', 'position') then
          if abs((s ->> k)::numeric - (want #>> '{}')::numeric) > 3 then return false; end if;
        elsif k = 'hue' then
          diff := mod(abs((s ->> 'hue')::numeric - (want #>> '{}')::numeric), 360);
          if s ->> 'color_mode' = 'temperature' or least(diff, 360 - diff) > 4 then return false; end if;
        elsif k = 'saturation' then
          if abs((s ->> k)::numeric - (want #>> '{}')::numeric) > 4 then return false; end if;
        elsif k = 'color_temp' then
          if s ->> 'color_mode' = 'color' or abs((s ->> k)::numeric - (want #>> '{}')::numeric) > 60 then return false; end if;
        elsif s -> k is distinct from want then
          return false;
        end if;
      end loop;
      return true;
    when 'power' then return private.truthy(s -> 'on') = private.truthy(p -> 'on');
    when 'mute' then return private.truthy(s -> 'muted') = private.truthy(p -> 'on');
    when 'play', 'favorite' then return private.truthy(s -> 'playing');
    when 'pause' then return not private.truthy(s -> 'playing');
    when 'volume' then
      if p -> 'volume' is null or jsonb_typeof(p -> 'volume') = 'null' then return null; end if;
      return abs((s ->> 'volume')::numeric - (p ->> 'volume')::numeric) <= 2;
    when 'open' then return (s ->> 'position')::numeric = 0;
    when 'close' then return (s ->> 'position')::numeric = 100;
    when 'set_temperature' then return abs((s ->> 'setpoint')::numeric - (p ->> 'setpoint')::numeric) <= 0.1;
    when 'set_mode' then return s ->> 'mode' = p ->> 'mode';
    when 'follow_schedule' then return s ->> 'mode' = 'FollowSchedule';
    when 'plugin' then return (s ->> 'plugin')::numeric = (p ->> 'id')::numeric;
    else return null;
  end case;
exception when others then return null;
end;
$$;

-- null when the scene is gone or can't be judged ("Turn everything off").
create function private.scene_is_on(scene_id uuid, context jsonb, previous boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  sc public.scenes;
  act jsonb;
  d public.devices;
  state jsonb;
  online boolean;
  ok boolean;
  checked int := 0;
begin
  select * into sc from public.scenes where id = scene_id;
  if not found or sc.kind <> 'custom' then return null; end if;
  for act in select value from jsonb_array_elements(sc.actions) loop
    select * into d from public.devices where id = act ->> 'device_id';
    if not found then continue; end if;
    if previous and context ->> 'cause' = 'device' and context ->> 'device_id' = d.id then
      state := context -> 'previous_state';
      online := coalesce((context ->> 'previous_online')::boolean, false);
    else
      state := d.state;
      online := d.online;
    end if;
    if not online then continue; end if;
    ok := private.scene_action_satisfied(act, state);
    if ok is null then continue; end if;
    if not ok then return false; end if;
    checked := checked + 1;
  end loop;
  return checked > 0;
end;
$$;

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
    when 'dark' then jsonb_typeof(rule -> 'sunset_offset_minutes') = 'number'
      and jsonb_typeof(rule -> 'sunrise_offset_minutes') = 'number'
      and (rule ->> 'sunset_offset_minutes')::numeric between -180 and 180
      and (rule ->> 'sunrise_offset_minutes')::numeric between -180 and 180
      and (rule ->> 'sunset_offset_minutes')::numeric = trunc((rule ->> 'sunset_offset_minutes')::numeric)
      and (rule ->> 'sunrise_offset_minutes')::numeric = trunc((rule ->> 'sunrise_offset_minutes')::numeric)
    when 'event' then (rule ->> 'event' = 'doorbell.ring'
        or (rule ->> 'event' = 'button.press' and rule ? 'device_id'
          and (not rule ? 'pattern' or rule ->> 'pattern' in ('singlePress', 'doublePress', 'longPress'))))
      and (not rule ? 'device_id' or (jsonb_typeof(rule -> 'device_id') = 'string' and length(rule ->> 'device_id') > 0))
    when 'device' then jsonb_typeof(rule -> 'device_id') = 'string' and length(rule ->> 'device_id') > 0
      and jsonb_typeof(rule -> 'key') = 'string' and length(rule ->> 'key') > 0
      and rule ->> 'op' in ('eq','ne','lt','gt')
      and jsonb_typeof(rule -> 'value') in ('number','boolean','string')
      and (rule ->> 'op' not in ('lt','gt') or jsonb_typeof(rule -> 'value') = 'number')
    when 'scene' then jsonb_typeof(rule -> 'scene_id') = 'string'
      and rule ->> 'scene_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(rule -> 'value') = 'boolean'
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
  dark boolean;
  on_now boolean;
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
      -- "Turns on": only true at the moment this device changes into the state,
      -- never because something else (like the clock) changed while it already was.
      if rule ->> 'mode' = 'becomes' then
        if previous or context ->> 'cause' is distinct from 'device' or context ->> 'device_id' is distinct from d.id then return false; end if;
        return coalesce(private.matches(d.state -> (rule ->> 'key'), rule ->> 'op', rule -> 'value'), false)
          and not coalesce(private.matches(context -> 'previous_state' -> (rule ->> 'key'), rule ->> 'op', rule -> 'value'), false);
      end if;
      if previous and context ->> 'cause' = 'device' and context ->> 'device_id' = d.id then
        state := context -> 'previous_state';
        if not coalesce((context ->> 'previous_online')::boolean, false) then return null; end if;
      else
        state := d.state;
        if not d.online then return null; end if;
      end if;
      -- A missing or empty value isn't "unknown": it simply isn't equal (e.g. a
      -- TV that's between inputs has no input for a moment).
      if (state -> (rule ->> 'key')) is null or jsonb_typeof(state -> (rule ->> 'key')) = 'null' then
        if rule ->> 'op' = 'eq' then return false; end if;
        if rule ->> 'op' = 'ne' then return true; end if;
        return null;
      end if;
      if jsonb_typeof(state -> (rule ->> 'key')) is distinct from jsonb_typeof(rule -> 'value') then return null; end if;
      return private.matches(state -> (rule ->> 'key'), rule ->> 'op', rule -> 'value');
    when 'dark' then
      -- Dark from sunset (+ offset) until the next sunrise (+ offset): look at
      -- the latest of those moments before now. The forecast starts today, so
      -- yesterday's sunset is taken as today's minus a day.
      select * into w from public.weather where id = 1;
      select e.kind = 'start' into dark from (
        select 'start' as kind, (ev.value ->> 'sunset')::timestamptz + (rule ->> 'sunset_offset_minutes')::int * interval '1 minute' as at
        from jsonb_each(w.sun_events) ev
        union all
        select 'start', min((ev.value ->> 'sunset')::timestamptz) - interval '1 day' + (rule ->> 'sunset_offset_minutes')::int * interval '1 minute'
        from jsonb_each(w.sun_events) ev
        union all
        select 'end', (ev.value ->> 'sunrise')::timestamptz + (rule ->> 'sunrise_offset_minutes')::int * interval '1 minute'
        from jsonb_each(w.sun_events) ev
      ) e
      where e.at is not null and e.at <= at_time
      order by e.at desc
      limit 1;
      return dark;
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
    when 'scene' then
      on_now := private.scene_is_on((rule ->> 'scene_id')::uuid, context, previous);
      if on_now is null then return null; end if;
      return on_now = (rule ->> 'value')::boolean;
    else return null;
  end case;
end;
$$;

-- A scene that's on keeps "Turn on for N minutes" lights on, like device states.
create or replace function private.automation_holds(a public.automations)
returns boolean language plpgsql security definer set search_path = '' as $$
declare grp jsonb; ongoing jsonb;
begin
  for grp in select value from jsonb_array_elements(case when a.trigger ->> 'type' = 'logic'
    then a.trigger -> 'groups' else jsonb_build_array(jsonb_build_array(a.trigger)) end) loop
    select coalesce(jsonb_agg(r), '[]'::jsonb) into ongoing
    from jsonb_array_elements(grp) r
    where r ->> 'type' in ('device', 'scene', 'weather', 'time_range');
    if jsonb_array_length(ongoing) > 0
       and private.automation_group_value(ongoing, now(), jsonb_build_object('cause', 'timer'), false) is true then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function
  private.truthy(jsonb),
  private.scene_action_satisfied(jsonb, jsonb),
  private.scene_is_on(uuid, jsonb, boolean)
from public;
