-- The living-room floor heating is always on: switch it on, and leave it out
-- of "Turn everything off". Only its target temperature is set in the app.
update public.floor_heating set enabled = true where id = 1;

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
  ) x;
$$;
