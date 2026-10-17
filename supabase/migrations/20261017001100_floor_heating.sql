-- A thermostat for the living-room floor heating.
--
-- evohome can't fire the boiler for the living room: that zone has no radiator
-- knob or relay. A "helper" radiator zone (the Babykamer, whose radiator is
-- closed underneath) does it instead: when the living room is below target, the
-- helper is set to 30° so its knob asks for heat; at target + 0.5° it's set to
-- 5°. The always-on floor pump carries the boiler's water into the floor.
-- Only the living room's temperature (the evohome controller) counts; the
-- helper room's own temperature is ignored.

create table public.floor_heating (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  target numeric(3, 1) not null default 20 check (target between 5 and 28),
  sensor_zone text not null,  -- whose temperature counts: the living room
  helper_zone text not null,  -- radiator zone whose knob makes the boiler fire
  heating boolean not null default false,
  last_switch_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.floor_heating enable row level security;

create policy "members read floor heating"
  on public.floor_heating for select
  to authenticated
  using ((select private.is_member()));

create policy "members change floor heating"
  on public.floor_heating for update
  to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

insert into public.floor_heating (sensor_zone, helper_zone)
select
  (select id from public.devices where integration = 'evohome' and kind = 'zone' and name = 'Woonkamer'),
  (select id from public.devices where integration = 'evohome' and kind = 'zone' and name = 'Babykamer');

alter publication supabase_realtime add table public.floor_heating;

create function private.run_floor_heating()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.floor_heating;
  temperature numeric;
  helper_setpoint numeric;
  want boolean;
  desired numeric;
begin
  select * into f from public.floor_heating where id = 1 for update;
  if not found then
    return;
  end if;

  -- Switched off and already off: leave the helper zone alone.
  if not f.enabled and not f.heating then
    return;
  end if;

  select (state ->> 'temperature')::numeric into temperature
  from public.devices where id = f.sensor_zone and online;
  select (state ->> 'setpoint')::numeric into helper_setpoint
  from public.devices where id = f.helper_zone;

  want := case
    when not f.enabled or temperature is null then false  -- off, or no reading: fail safe
    when temperature < f.target then true
    when temperature >= f.target + 0.5 then false
    else f.heating                                        -- in between: keep going
  end;
  desired := case when want then 30 else 5 end;

  if helper_setpoint is distinct from desired
     and not exists (
       select 1 from public.commands
       where device_id = f.helper_zone and status in ('pending', 'running')
         and created_at > now() - interval '2 minutes'
     )
  then
    insert into public.commands (device_id, action, params, source)
    values (f.helper_zone, 'set_temperature', jsonb_build_object('setpoint', desired), 'floor_heating');
  end if;

  if want is distinct from f.heating then
    update public.floor_heating set heating = want, last_switch_at = now() where id = 1;
  end if;
end;
$$;

-- Re-check whenever the living room or the helper reports in (every ~5 min) ...
create function private.on_floor_zone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.floor_heating where new.id in (sensor_zone, helper_zone)) then
    perform private.run_floor_heating();
  end if;
  return new;
end;
$$;

create trigger devices_floor_heating
  after update on public.devices
  for each row
  when (new.id like 'evohome:zone:%' and old.state is distinct from new.state)
  execute function private.on_floor_zone_change();

-- ... and straight away when someone changes the target or switches it.
create function private.on_floor_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger floor_heating_touch
  before update on public.floor_heating
  for each row
  when (old.enabled is distinct from new.enabled or old.target is distinct from new.target)
  execute function private.on_floor_settings_change();

create function private.after_floor_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.run_floor_heating();
  return new;
end;
$$;

create trigger floor_heating_apply
  after update on public.floor_heating
  for each row
  when (old.enabled is distinct from new.enabled or old.target is distinct from new.target)
  execute function private.after_floor_settings_change();

-- Scenes and automations control it through commands on the living-room zone:
--   floor_target {"target": 20}  → on, with that target
--   floor_off {}                 → off
-- These are handled here and marked done, so the evohome function skips them.
-- (Named so it runs before commands_invoke_evohome.)
create function private.on_floor_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  failure text;
begin
  begin
    if new.action = 'floor_target' then
      update public.floor_heating
      set enabled = true, target = (new.params ->> 'target')::numeric
      where id = 1;
    else
      update public.floor_heating set enabled = false where id = 1;
    end if;
  exception when others then
    failure := sqlerrm;
  end;
  update public.commands
  set status = case when failure is null then 'done' else 'failed' end, error = failure, completed_at = now()
  where id = new.id;
  return new;
end;
$$;

create trigger commands_a_floor_heating
  after insert on public.commands
  for each row
  when (new.action in ('floor_target', 'floor_off'))
  execute function private.on_floor_command();

revoke all on function
  private.run_floor_heating(),
  private.on_floor_zone_change(),
  private.on_floor_settings_change(),
  private.after_floor_settings_change(),
  private.on_floor_command()
from public;

-- Safety net in case an update is missed.
select cron.schedule('floor-heating', '*/5 * * * *', 'select private.run_floor_heating()');
