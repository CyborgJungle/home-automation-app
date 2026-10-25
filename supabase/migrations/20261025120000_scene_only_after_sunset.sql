-- A device in a scene can be "Only after sunset": {"only_dark": true} on its
-- action. Playing the scene in daylight skips it, so Pip mode can switch the
-- hallway light on in the evening only. "After sunset" is the same as the
-- automations' "dark" check: from sunset until sunrise, from the weather's
-- sun times (local). Without sun times it's played, like before.

create function private.is_dark(at_time timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.automation_rule_value(
    '{"type": "dark", "sunset_offset_minutes": 0, "sunrise_offset_minutes": 0}'::jsonb, at_time, '{}'::jsonb, false);
$$;

create or replace function private.queue_scene(scene_id uuid, source text, user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.scenes;
  act jsonb;
  dark boolean := private.is_dark(now());
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
    if coalesce((act ->> 'only_dark')::boolean, false) and dark is false then
      continue;
    end if;
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

create or replace function private.scene_is_on(scene_id uuid, context jsonb, previous boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  sc public.scenes;
  act jsonb;
  d public.devices;
  state jsonb;
  online boolean;
  ok boolean;
  checked int := 0;
begin
  select * into sc from public.scenes where id = scene_id;
  if not found or sc.kind <> 'custom' then return null; end if;
  for act in select value from jsonb_array_elements(sc.actions) loop
    -- "Only after sunset" devices may rightly be off in daylight: not checked.
    if coalesce((act ->> 'only_dark')::boolean, false) then continue; end if;
    select * into d from public.devices where id = act ->> 'device_id';
    if not found then continue; end if;
    if previous and context ->> 'cause' = 'device' and context ->> 'device_id' = d.id then
      state := context -> 'previous_state';
      online := coalesce((context ->> 'previous_online')::boolean, false);
    else
      state := d.state;
      online := d.online;
    end if;
    if not online then continue; end if;
    ok := private.scene_action_satisfied(act, state);
    if ok is null then continue; end if;
    if not ok then return false; end if;
    checked := checked + 1;
  end loop;
  return checked > 0;
end;
$$;

revoke all on function private.is_dark(timestamptz), private.queue_scene(uuid, text, uuid) from public;
