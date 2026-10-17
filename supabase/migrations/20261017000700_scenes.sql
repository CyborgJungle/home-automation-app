-- Scenes: a named set of device actions ("Movie night": living room at 25 %,
-- blind closed, TV on), played from the app or by an automation. Playing one
-- queues its actions as commands, exactly like taps in the app.
--
-- actions: [{"device_id":"tradfri:group:131078","action":"set","params":{"on":true,"brightness":25}}]
-- An automation plays a scene with the action {"scene_id":"<uuid>"}.

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  tone text not null default 'yellow',   -- card colour
  shape text not null default 'house',   -- card character
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  last_run_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.scenes enable row level security;

create index scenes_created_by_idx on public.scenes (created_by);

create policy "members read scenes"
  on public.scenes for select
  to authenticated
  using ((select private.is_member()));

create policy "members create scenes"
  on public.scenes for insert
  to authenticated
  with check ((select private.is_member()));

create policy "members update scenes"
  on public.scenes for update
  to authenticated
  using ((select private.is_member()))
  with check ((select private.is_member()));

create policy "members delete scenes"
  on public.scenes for delete
  to authenticated
  using ((select private.is_member()));

create trigger scenes_touch_updated_at
  before update on public.scenes
  for each row execute function private.touch_updated_at();

alter publication supabase_realtime add table public.scenes;

-- Queues a scene's actions. `source` says who asked: 'scene:<id>' from the
-- app, or 'automation:<id>' when an automation plays it.
create function private.queue_scene(scene_id uuid, source text, user_id uuid)
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

  for act in select value from jsonb_array_elements(s.actions)
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

-- What the app calls when you tap a scene.
create function public.play_scene(scene_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member() then
    raise exception 'Not on the household list' using errcode = '42501';
  end if;
  perform private.queue_scene(scene_id, 'scene:' || scene_id, auth.uid());
end;
$$;

revoke all on function private.queue_scene(uuid, text, uuid) from public;
revoke all on function public.play_scene(uuid) from public, anon;
grant execute on function public.play_scene(uuid) to authenticated;

-- Automations can now play scenes as one of their actions.
create or replace function private.run_automation(a public.automations, cause jsonb)
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
    if act ? 'scene_id' then
      perform private.queue_scene((act ->> 'scene_id')::uuid, 'automation:' || a.id, null);
    -- Skip devices that were removed since the automation was made.
    elsif exists (select 1 from public.devices where id = act ->> 'device_id') then
      insert into public.commands (device_id, action, params, source, created_by)
      values (act ->> 'device_id', act ->> 'action', coalesce(act -> 'params', '{}'::jsonb), 'automation:' || a.id, null);
    end if;
  end loop;

  insert into public.events (type, data)
  values ('automation.run', jsonb_build_object('automation_id', a.id, 'name', a.name) || cause);
end;
$$;

revoke all on function private.run_automation(public.automations, jsonb) from public;

-- Scene runs are logged as events; they shouldn't start event automations.
drop trigger events_run_automations on public.events;
create trigger events_run_automations
  after insert on public.events
  for each row
  when (new.type not in ('automation.run', 'scene.run'))
  execute function private.on_event();
