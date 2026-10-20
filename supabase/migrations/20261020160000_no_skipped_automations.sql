-- Automations: never skip one because another transaction is busy with it.
-- "for update skip locked" made a button press that arrived while a device
-- update was still running its automations silently miss them. Read the rows
-- without locking (in a fixed order, so concurrent runs can't deadlock);
-- run_automation locks the single row it runs and debounces doubles.
create or replace function private.run_logic_automations(check_at timestamptz, context jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.automations; grp jsonb; current_value boolean; previous_value boolean;
begin
  for a in select * from public.automations where enabled and trigger ->> 'type' in ('logic','time_range') order by id loop
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

create or replace function private.run_legacy_scheduled_automations(check_at timestamptz)
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
  for a in select * from public.automations where enabled and trigger ->> 'type' in ('time', 'sun') order by id loop
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
