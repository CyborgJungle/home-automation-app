-- "Everything off": a scene that works out its actions when it's played, so
-- new devices are always included (and IKEA devices keep working after moving
-- to another hub, when their ids change).
--
-- Turns off every light (whole rooms, plus lamps that aren't in a room), plug
-- and TV, pauses speakers that are playing, and switches off the floor
-- heating. Blinds and the rest of the heating are left alone.

alter table public.scenes
  add column kind text not null default 'custom' check (kind in ('custom', 'all_off'));

create function private.all_off_actions()
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
        d.kind in ('group', 'plug')
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
    select jsonb_build_object('device_id', f.sensor_zone, 'action', 'floor_off', 'params', '{}'::jsonb)
    from public.floor_heating f
    where f.enabled
  ) x;
$$;

revoke all on function private.all_off_actions() from public;

create or replace function private.queue_scene(scene_id uuid, source text, user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.scenes;
  act jsonb;
begin
  select * into s from public.scenes where id = scene_id;
  if not found then
    return;
  end if;

  for act in
    select value from jsonb_array_elements(
      case when s.kind = 'all_off' then private.all_off_actions() else s.actions end
    )
  loop
    if exists (select 1 from public.devices where id = act ->> 'device_id') then
      insert into public.commands (device_id, action, params, source, created_by)
      values (act ->> 'device_id', act ->> 'action', coalesce(act -> 'params', '{}'::jsonb), source, user_id);
    end if;
  end loop;

  update public.scenes set last_run_at = now() where id = s.id;
  insert into public.events (type, data)
  values ('scene.run', jsonb_build_object('scene_id', s.id, 'name', s.name, 'source', source));
end;
$$;

revoke all on function private.queue_scene(uuid, text, uuid) from public;

insert into public.scenes (name, tone, shape, kind, actions)
values ('Everything off', 'lavender', 'cloud', 'all_off', '[]'::jsonb);
