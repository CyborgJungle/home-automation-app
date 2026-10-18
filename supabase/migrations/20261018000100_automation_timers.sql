-- "Turn on for N minutes": an automation action can switch its device off
-- again later. The countdown restarts each time the automation runs, and it
-- waits while the automation's trigger still holds (e.g. motion is still
-- detected), so the light goes off N minutes after the last motion.

create table public.automation_timers (
  automation_id uuid not null references public.automations (id) on delete cascade,
  device_id text not null references public.devices (id) on delete cascade,
  minutes int not null check (minutes between 1 and 240),
  run_at timestamptz not null,
  primary key (automation_id, device_id)
);
alter table public.automation_timers enable row level security;

create policy "members read automation timers"
  on public.automation_timers for select
  to authenticated
  using ((select private.is_member()));

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

-- Whether an automation's trigger is true right now (any of its Or groups).
create function private.automation_holds(a public.automations)
returns boolean language plpgsql security definer set search_path = '' as $$
declare grp jsonb;
begin
  for grp in select value from jsonb_array_elements(case when a.trigger ->> 'type' = 'logic'
    then a.trigger -> 'groups' else jsonb_build_array(jsonb_build_array(a.trigger)) end) loop
    if private.automation_group_value(grp, now(), jsonb_build_object('cause', 'timer'), false) is true then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- Every 15 seconds: while the trigger holds, the countdown starts over; once
-- it doesn't, the device goes off when the countdown runs out.
create function private.run_automation_timers()
returns void language plpgsql security definer set search_path = '' as $$
declare t public.automation_timers; a public.automations;
begin
  for t in select * from public.automation_timers for update skip locked loop
    select * into a from public.automations where id = t.automation_id;
    if a.enabled and private.automation_holds(a) then
      update public.automation_timers set run_at = now() + t.minutes * interval '1 minute'
      where automation_id = t.automation_id and device_id = t.device_id;
    elsif t.run_at <= now() then
      insert into public.commands (device_id, action, params, source, created_by)
      values (t.device_id, 'set', '{"on": false}'::jsonb, 'automation:' || t.automation_id, null);
      delete from public.automation_timers where automation_id = t.automation_id and device_id = t.device_id;
    end if;
  end loop;
end;
$$;

revoke all on function private.automation_holds(public.automations), private.run_automation_timers() from public;

select cron.schedule('automation-timers', '15 seconds', 'select private.run_automation_timers()');
