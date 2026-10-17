-- Automations run inside Supabase, so they work with the app closed:
--   * a trigger on devices reacts to state changes ("when the TV turns on"),
--   * a trigger on events reacts to things like doorbell rings,
--   * pg_cron checks time-based rules every minute (Europe/Amsterdam time).
-- An automation's actions are queued as commands, which the Pi agent (or the
-- evohome function) carries out, exactly like a tap in the app.
--
-- trigger:
--   {"type":"time","at":"07:30","days":[1,2,3,4,5]}          days: 0 = Sunday … 6 = Saturday
--   {"type":"device","device_id":"tradfri:65553","key":"on","op":"eq","value":true}
--                                                           op: eq | ne | lt | gt
--   {"type":"event","event":"doorbell.ring","device_id":"eufy:…"}   device_id optional
-- actions:
--   [{"device_id":"tradfri:group:131078","action":"set","params":{"on":true}}]

alter table public.automations
  add constraint automations_trigger_shape check (
    jsonb_typeof(trigger) = 'object' and trigger ->> 'type' in ('time', 'device', 'event')
  ),
  add constraint automations_actions_shape check (jsonb_typeof(actions) = 'array');

-- Only edits count as "updated", not the engine stamping last_run_at.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'last_run_at' - 'updated_at') is distinct from (to_jsonb(old) - 'last_run_at' - 'updated_at') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- Compares a device state value with a rule's value. Missing values never match.
create function private.matches(actual jsonb, op text, expected jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case op
      when 'eq' then actual = expected
      when 'ne' then actual is not null and actual <> expected
      when 'lt' then jsonb_typeof(actual) = 'number' and jsonb_typeof(expected) = 'number'
                     and actual::numeric < expected::numeric
      when 'gt' then jsonb_typeof(actual) = 'number' and jsonb_typeof(expected) = 'number'
                     and actual::numeric > expected::numeric
    end,
    false
  );
$$;

create function private.run_automation(a public.automations, cause jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  act jsonb;
begin
  -- An automation that (indirectly) triggers itself can't loop faster than this.
  if a.last_run_at is not null and a.last_run_at > now() - interval '10 seconds' then
    return;
  end if;
  update public.automations set last_run_at = now() where id = a.id;

  for act in select value from jsonb_array_elements(a.actions)
  loop
    -- Skip devices that were removed since the automation was made.
    if exists (select 1 from public.devices where id = act ->> 'device_id') then
      insert into public.commands (device_id, action, params, source, created_by)
      values (act ->> 'device_id', act ->> 'action', coalesce(act -> 'params', '{}'::jsonb), 'automation:' || a.id, null);
    end if;
  end loop;

  insert into public.events (type, data)
  values ('automation.run', jsonb_build_object('automation_id', a.id, 'name', a.name) || cause);
end;
$$;

create function private.on_device_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.automations;
begin
  for a in
    select * from public.automations
    where enabled and trigger ->> 'type' = 'device' and trigger ->> 'device_id' = new.id
  loop
    -- Fire on the change only ("turns on"), not on every update while it stays on.
    if private.matches(new.state -> (a.trigger ->> 'key'), a.trigger ->> 'op', a.trigger -> 'value')
       and not private.matches(old.state -> (a.trigger ->> 'key'), a.trigger ->> 'op', a.trigger -> 'value')
    then
      perform private.run_automation(a, jsonb_build_object('cause', 'device', 'device_id', new.id));
    end if;
  end loop;
  return new;
end;
$$;

create trigger devices_run_automations
  after update on public.devices
  for each row
  when (old.state is distinct from new.state)
  execute function private.on_device_change();

create function private.on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.automations;
begin
  for a in
    select * from public.automations
    where enabled
      and trigger ->> 'type' = 'event'
      and trigger ->> 'event' = new.type
      and (trigger ->> 'device_id' is null or trigger ->> 'device_id' = new.device_id)
  loop
    perform private.run_automation(a, jsonb_build_object('cause', new.type, 'device_id', new.device_id));
  end loop;
  return new;
end;
$$;

create trigger events_run_automations
  after insert on public.events
  for each row
  when (new.type <> 'automation.run')
  execute function private.on_event();

create function private.run_time_automations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_now timestamp := now() at time zone 'Europe/Amsterdam';
  a public.automations;
begin
  for a in
    select * from public.automations
    where enabled
      and trigger ->> 'type' = 'time'
      and trigger ->> 'at' = to_char(local_now, 'HH24:MI')
      and (trigger -> 'days' is null or trigger -> 'days' @> to_jsonb(extract(dow from local_now)::int))
  loop
    perform private.run_automation(a, jsonb_build_object('cause', 'time'));
  end loop;
end;
$$;

revoke all on function
  private.run_automation(public.automations, jsonb),
  private.on_device_change(),
  private.on_event(),
  private.run_time_automations()
from public;

select cron.schedule('automations-time', '* * * * *', 'select private.run_time_automations()');
