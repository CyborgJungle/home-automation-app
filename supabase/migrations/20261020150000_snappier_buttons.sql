-- Snappier button automations:
--  * the "don't run twice" guard is 1 s for button presses and doorbells
--    (10 s stays for state changes), so a second press isn't ignored;
--  * a toggle counts a command sent in the last seconds as the current state,
--    so quick presses alternate even before the device reports back.
create or replace function private.run_automation(a public.automations, cause jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rule public.automations;
  act jsonb;
begin
  select * into rule from public.automations where id = a.id for update;
  if not found or not rule.enabled
     -- Don't run twice in a row by accident: 10 s for state changes, but just
     -- 1 s for button presses and doorbells, where every press is meant.
     or (rule.last_run_at is not null and rule.last_run_at > now() - case
           when cause ->> 'cause' in ('button.press', 'doorbell.ring') then interval '1 second'
           else interval '10 seconds' end)
     or not private.weather_conditions_allow(rule.conditions, now()) then return; end if;
  update public.automations set last_run_at = now() where id = rule.id;
  for act in select value from jsonb_array_elements(rule.actions) loop
    if act ? 'scene_id' then
      perform private.queue_scene((act ->> 'scene_id')::uuid, 'automation:' || rule.id, null);
    elsif exists (select 1 from public.devices where id = act ->> 'device_id') then
      insert into public.commands (device_id, action, params, source, created_by)
      values (act ->> 'device_id', act ->> 'action', coalesce(act -> 'params', '{}'::jsonb), 'automation:' || rule.id, null);
      -- "Turn on for N minutes": (re)start this device's switch-off timer.
      if jsonb_typeof(act -> 'off_after_minutes') = 'number' then
        insert into public.automation_timers (automation_id, device_id, minutes, run_at)
        values (rule.id, act ->> 'device_id', (act ->> 'off_after_minutes')::int,
                now() + (act ->> 'off_after_minutes')::int * interval '1 minute')
        on conflict (automation_id, device_id)
        do update set minutes = excluded.minutes, run_at = excluded.run_at;
      end if;
    end if;
  end loop;
  insert into public.events (type, data)
  values ('automation.run', jsonb_build_object('automation_id', rule.id, 'name', rule.name) || cause);
end;
$$;

create or replace function private.on_toggle_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices;
  is_on boolean;
  recent boolean;
begin
  select * into d from public.devices where id = new.device_id;
  if d.id is null or d.kind not in ('light', 'group', 'plug', 'tv') then
    new.status := 'failed';
    new.error := 'This device can''t be toggled';
    return new;
  end if;
  -- The last known state, also for a device that's unreachable right now.
  is_on := coalesce((d.state ->> 'on')::boolean, false);
  -- But a command sent a moment ago wins: the device may not have reported
  -- its new state yet, and a quick second press should still flip it back.
  select (c.params ->> 'on')::boolean into recent
  from public.commands c
  where c.device_id = d.id
    and c.action in ('set', 'power') and c.params ? 'on'
    and c.status <> 'failed'
    and c.created_at > now() - interval '5 seconds'
    and c.created_at > d.updated_at
  order by c.id desc
  limit 1;
  is_on := coalesce(recent, is_on);
  new.action := case when d.kind = 'tv' then 'power' else 'set' end;
  new.params := jsonb_build_object('on', not is_on);
  return new;
end;
$$;
