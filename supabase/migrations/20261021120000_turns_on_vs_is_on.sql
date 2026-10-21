-- Device rules: "turns on" (the moment it changes) next to "is on" (its state).
-- {"mode": "becomes"} makes a rule the moment; without it, it's the state.
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
    else return null;
  end case;
end;
$$;
