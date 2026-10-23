-- Two heating fixes.
--
-- 1. The floor heating borrows the boiler. When another radiator room is
--    calling for heat, the boiler fires anyway and the floor pump carries that
--    water into the living-room floor too, so the helper zone (Babykamer) can
--    stay off. A room counts while it's clearly below its own target: from
--    0.5° under it, and once it's carrying the floor, until it's 0.2° under
--    (its radiator knob closes as it gets there). Then the helper takes over
--    again. `boiler_via` says which room is carrying the floor, for the app.
--
-- 2. Switching several rooms on in quick succession. The first one switches
--    the system to Schedule and turns schedule-only rooms off. The next tap
--    arrived before Honeywell reported Schedule, did it again, and turned off
--    the room you had just switched on (it still looked schedule-only). Now a
--    recent switch to Schedule isn't repeated, and rooms with a fresh command
--    are left alone.

alter table public.floor_heating add column boiler_via text;

create or replace function private.run_floor_heating()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.floor_heating;
  temperature numeric;
  helper_setpoint numeric;
  helper_min numeric;
  helper_max numeric;
  want boolean;
  via text;
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
  select (state ->> 'setpoint')::numeric, (state ->> 'min_setpoint')::numeric, (state ->> 'max_setpoint')::numeric
  into helper_setpoint, helper_min, helper_max
  from public.devices where id = f.helper_zone;

  want := case
    when not f.enabled or temperature is null then false  -- off, or no reading: fail safe
    when temperature < f.target then true
    when temperature >= f.target + 0.5 then false
    else f.heating                                        -- in between: keep going
  end;

  -- Another room making the boiler fire: the one furthest below its target.
  if want then
    select o.id into via
    from public.devices o
    where o.integration = 'evohome' and o.kind = 'zone' and o.online
      and o.id <> f.helper_zone and o.id <> f.sensor_zone
      and (o.state ->> 'setpoint')::numeric > private.zone_min(o.state)
      and (o.state ->> 'temperature')::numeric
          < (o.state ->> 'setpoint')::numeric - case when o.id = f.boiler_via then 0.2 else 0.5 end
      and exists (
        select 1 from public.devices s
        where s.integration = 'evohome' and s.kind = 'heating' and s.state ->> 'mode' is distinct from 'HeatingOff'
      )
    order by (o.state ->> 'setpoint')::numeric - (o.state ->> 'temperature')::numeric desc, o.id
    limit 1;
  end if;

  -- As high and as low as the helper zone allows (Honeywell clamps to its limits).
  desired := case
    when want and via is null then least(30, coalesce(helper_max, 30))
    else greatest(5, coalesce(helper_min, 5))
  end;

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
  if via is distinct from f.boiler_via then
    update public.floor_heating set boiler_via = via where id = 1;
  end if;
end;
$$;

-- Any room reporting in can start or stop carrying the floor, so re-check on
-- every zone, not only the living room and the helper.
create or replace function private.on_floor_zone_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.floor_heating where enabled or heating) then
    perform private.run_floor_heating();
  end if;
  return new;
end;
$$;

create or replace function private.on_room_command()
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
        and coalesce((state ->> 'setpoint')::numeric, 0) > private.zone_min(state)
    loop
      insert into public.commands (device_id, action, params, source, created_by)
      values (z.id, 'set_temperature', jsonb_build_object('setpoint', private.zone_min(z.state)), new.source, new.created_by);
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
    -- Within the room's own limits (Honeywell would clamp anyway).
    setpoint := least(greatest(setpoint, private.zone_min(z.state)), coalesce((z.state ->> 'max_setpoint')::numeric, 30));
    if z.id = f.sensor_zone then
      new.action := 'floor_target';
      new.params := jsonb_build_object('target', setpoint);
    else
      new.action := 'set_temperature';
      new.params := jsonb_build_object('setpoint', setpoint);
    end if;
    -- Heating isn't running: switch it on, and keep rooms that only follow
    -- the schedule off, so only the rooms you chose heat. Not again while an
    -- earlier switch to Schedule is still on its way, and never for a room
    -- that was just given its own temperature.
    if sys.id is not null and sys.state ->> 'mode' is distinct from 'Auto'
       and not exists (
         select 1 from public.commands c
         where c.device_id = sys.id and c.action = 'set_mode' and c.params ->> 'mode' = 'Auto'
           and c.status <> 'failed' and c.created_at > now() - interval '2 minutes'
       )
    then
      insert into public.commands (device_id, action, params, source, created_by)
      values (sys.id, 'set_mode', '{"mode": "Auto"}'::jsonb, new.source, new.created_by);
      insert into public.commands (device_id, action, params, source, created_by)
      select o.id, 'set_temperature', jsonb_build_object('setpoint', private.zone_min(o.state)), new.source, new.created_by
      from public.devices o
      where o.integration = 'evohome' and o.kind = 'zone' and o.id <> z.id
        and o.id is distinct from f.helper_zone and o.id is distinct from f.sensor_zone
        and o.state ->> 'mode' = 'FollowSchedule'
        and not exists (
          select 1 from public.commands c
          where c.device_id = o.id and c.status <> 'failed' and c.created_at > now() - interval '2 minutes'
        );
    end if;
    return new;
  end if;

  -- room_off
  if z.id = f.sensor_zone then
    new.action := 'floor_off';
    new.params := '{}'::jsonb;
  else
    new.action := 'set_temperature';
    new.params := jsonb_build_object('setpoint', private.zone_min(z.state));
  end if;
  -- Was this the last room on? Then switch the whole system off.
  select exists (
    select 1 from public.devices o
    where o.integration = 'evohome' and o.kind = 'zone' and o.id <> z.id
      and o.id is distinct from f.helper_zone and o.id is distinct from f.sensor_zone
      and o.state ->> 'mode' in ('PermanentOverride', 'TemporaryOverride')
      and coalesce((o.state ->> 'setpoint')::numeric, 0) > private.zone_min(o.state)
  ) or (f.enabled and z.id is distinct from f.sensor_zone)
  into others_on;
  if not others_on and sys.id is not null and sys.state ->> 'mode' is distinct from 'HeatingOff' then
    insert into public.commands (device_id, action, params, source, created_by)
    values (sys.id, 'set_mode', '{"mode": "HeatingOff"}'::jsonb, new.source, new.created_by);
  end if;
  return new;
end;
$$;

revoke all on function private.run_floor_heating(), private.on_floor_zone_change(), private.on_room_command() from public;
