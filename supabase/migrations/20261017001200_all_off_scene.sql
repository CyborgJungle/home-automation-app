-- Creates the requested scene; does not play it or queue any device commands.
-- Use individual lights/plugs rather than room groups so no device is included
-- twice. Include offline devices: they should still belong to the saved scene.
-- A saved scene is a snapshot; add future devices through the scene editor.
-- Re-running this leaves an existing "All off" scene and its edits untouched.

with device_actions as (
  -- Disable the floor thermostat first, before turning the heating system off.
  -- Otherwise its next check could ask the helper radiator for heat again.
  select 0 as priority, d.id,
    jsonb_build_object(
      'device_id', d.id, 'action', 'floor_off', 'params', '{}'::jsonb,
      'option', 'floor_off', 'value', null
    ) as action
  from public.floor_heating f
  join public.devices d on d.id = f.sensor_zone
  where d.integration = 'evohome' and d.kind = 'zone'

  union all

  -- Use Evohome's Heating Off mode, retaining its frost protection and schedules.
  -- Do not overwrite every radiator's target or operate the helper separately.
  select 1, d.id,
    jsonb_build_object(
      'device_id', d.id, 'action', 'set_mode',
      'params', jsonb_build_object('mode', 'HeatingOff'),
      'option', 'off', 'value', null
    )
  from public.devices d
  where d.integration = 'evohome' and d.kind = 'heating'

  union all

  select 2, d.id,
    jsonb_build_object(
      'device_id', d.id, 'action', 'set',
      'params', jsonb_build_object('on', false),
      'option', 'off', 'value', null
    )
  from public.devices d
  where d.integration = 'tradfri' and d.kind in ('light', 'plug')
), scene_actions as (
  select coalesce(jsonb_agg(action order by priority, id), '[]'::jsonb) as actions
  from device_actions
)
insert into public.scenes (name, tone, shape, actions)
select 'All off', 'sage', 'house', actions
from scene_actions
where jsonb_array_length(actions) > 0
  and not exists (
    select 1 from public.scenes where lower(trim(name)) = 'all off'
  );
