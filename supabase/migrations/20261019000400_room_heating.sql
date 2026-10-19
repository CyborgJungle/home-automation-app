-- Heating per room, the simple way: a room is "on at X°" or "off", and the
-- system mode follows on its own.
--
--   room_on  {"setpoint": 20} on a zone → that room heats to 20°. If the
--            system is Off (or Eco/Away), it switches to Schedule first, and
--            rooms that were only following the schedule are set to off, so
--            only the rooms you switched on heat.
--   room_off {} on a zone              → that room off (5°). When no room is
--            on any more, the whole system switches Off.
--   heating_off {} on the system       → every room off and the system Off.
--
-- The living room is the floor-heating zone: on/off there become
-- floor_target/floor_off (the helper zone is handled by the floor thermostat).
-- These become ordinary commands before they're stored, so the Honeywell
-- function only ever sees set_mode / set_temperature.

create function private.on_room_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.floor_heating;
  sys public.devices;
  z public.devices;
  setpoint numeric;
  others_on boolean;
begin
  select * into f from public.floor_heating where id = 1;
  select * into sys from public.devices where integration = 'evohome' and kind = 'heating' limit 1;

  if new.action = 'heating_off' then
    if sys.id is null then
      new.status := 'failed';
      new.error := 'No heating system found';
      return new;
    end if;
    new.device_id := sys.id;
    new.action := 'set_mode';
    new.params := '{"mode": "HeatingOff"}'::jsonb;
    for z in
      select * from public.devices
      where integration = 'evohome' and kind = 'zone'
        and id is distinct from f.helper_zone and id is distinct from f.sensor_zone
        and coalesce((state ->> 'setpoint')::numeric, 0) > 5
    loop
      insert into public.commands (device_id, action, params, source, created_by)
      values (z.id, 'set_temperature', '{"setpoint": 5}'::jsonb, new.source, new.created_by);
    end loop;
    if f.enabled then
      insert into public.commands (device_id, action, params, source, created_by)
      values (f.sensor_zone, 'floor_off', '{}'::jsonb, new.source, new.created_by);
    end if;
    return new;
  end if;

  select * into z from public.devices where id = new.device_id;
  if z.id is null or z.kind <> 'zone' or z.id = f.helper_zone then
    new.status := 'failed';
    new.error := 'That is not a room that can be heated';
    return new;
  end if;

  if new.action = 'room_on' then
    setpoint := coalesce((new.params ->> 'setpoint')::numeric, f.target, 20);
    if setpoint < 5 or setpoint > 30 then
      new.status := 'failed';
      new.error := 'Choose a temperature between 5° and 30°';
      return new;
    end if;
    if z.id = f.sensor_zone then
      new.action := 'floor_target';
      new.params := jsonb_build_object('target', setpoint);
    else
      new.action := 'set_temperature';
      new.params := jsonb_build_object('setpoint', setpoint);
    end if;
    -- Heating isn't running: switch it on, and keep rooms that only follow
    -- the schedule off, so only the rooms you chose heat.
    if sys.id is not null and sys.state ->> 'mode' is distinct from 'Auto' then
      insert into public.commands (device_id, action, params, source, created_by)
      values (sys.id, 'set_mode', '{"mode": "Auto"}'::jsonb, new.source, new.created_by);
      insert into public.commands (device_id, action, params, source, created_by)
      select o.id, 'set_temperature', '{"setpoint": 5}'::jsonb, new.source, new.created_by
      from public.devices o
      where o.integration = 'evohome' and o.kind = 'zone' and o.id <> z.id
        and o.id is distinct from f.helper_zone and o.id is distinct from f.sensor_zone
        and o.state ->> 'mode' = 'FollowSchedule';
    end if;
    return new;
  end if;

  -- room_off
  if z.id = f.sensor_zone then
    new.action := 'floor_off';
    new.params := '{}'::jsonb;
  else
    new.action := 'set_temperature';
    new.params := '{"setpoint": 5}'::jsonb;
  end if;
  -- Was this the last room on? Then switch the whole system off.
  select exists (
    select 1 from public.devices o
    where o.integration = 'evohome' and o.kind = 'zone' and o.id <> z.id
      and o.id is distinct from f.helper_zone and o.id is distinct from f.sensor_zone
      and o.state ->> 'mode' in ('PermanentOverride', 'TemporaryOverride')
      and coalesce((o.state ->> 'setpoint')::numeric, 0) > 5
  ) or (f.enabled and z.id is distinct from f.sensor_zone)
  into others_on;
  if not others_on and sys.id is not null and sys.state ->> 'mode' is distinct from 'HeatingOff' then
    insert into public.commands (device_id, action, params, source, created_by)
    values (sys.id, 'set_mode', '{"mode": "HeatingOff"}'::jsonb, new.source, new.created_by);
  end if;
  return new;
end;
$$;

revoke all on function private.on_room_command() from public;

-- Before the row is stored, so the floor and Honeywell triggers see the
-- ordinary command it became.
create trigger commands_room_heating
  before insert on public.commands
  for each row
  when (new.action in ('room_on', 'room_off', 'heating_off'))
  execute function private.on_room_command();
