-- "Turn everything off" switches all the heating off too: every room, the
-- floor heating and the system (heating_off, see …_room_heating.sql), instead
-- of only the floor heating. Blinds are still left alone.
create or replace function private.all_off_actions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(a), '[]'::jsonb)
  from (
    select jsonb_build_object('device_id', d.id, 'action', 'set', 'params', '{"on": false}'::jsonb) as a
    from public.devices d
    where d.online
      and (
        d.kind = 'plug'
        -- the hub's room groups; app lamp groups are covered by their rooms
        or (d.kind = 'group' and d.integration <> 'app')
        -- lamps in a room are covered by the room's group
        or (d.kind = 'light' and not exists (
          select 1 from public.devices g
          where g.kind = 'group' and g.integration = d.integration and g.name = d.room
        ))
      )
    union all
    select jsonb_build_object('device_id', d.id, 'action', 'power', 'params', '{"on": false}'::jsonb)
    from public.devices d
    where d.kind = 'tv' and d.online
    union all
    select jsonb_build_object('device_id', d.id, 'action', 'pause', 'params', '{}'::jsonb)
    from public.devices d
    where d.kind = 'speaker' and d.online and (d.state ->> 'playing')::boolean
    union all
    -- Only when something is still heating, so an already-off system isn't
    -- sent the same commands again.
    select jsonb_build_object('device_id', d.id, 'action', 'heating_off', 'params', '{}'::jsonb)
    from public.devices d
    where d.integration = 'evohome' and d.kind = 'heating' and d.online
      and (
        d.state ->> 'mode' is distinct from 'HeatingOff'
        or exists (select 1 from public.floor_heating f where f.enabled)
      )
  ) x;
$$;
