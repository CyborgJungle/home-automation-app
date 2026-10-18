-- Lamp groups made in this app (not by a hub), e.g. "Woonkamer spots": shown
-- as one device (group:<uuid>) that switches all its lamps together with the
-- same brightness. The lamps stay available one by one too.

alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('app', 'dirigera', 'tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple'));

-- Lamps that are on a smart plug, shown under Lights as well as Plugs.
alter table public.devices add column also_light boolean not null default false;

create table public.lamp_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  members text[] not null check (cardinality(members) between 2 and 20),
  created_at timestamptz not null default now()
);
alter table public.lamp_groups enable row level security;

create policy "members read lamp groups"
  on public.lamp_groups for select
  to authenticated
  using ((select private.is_member()));

-- The group's device row, worked out from its lamps: on when any lamp is on,
-- the brightest lamp's brightness, and the colour abilities all lamps share.
create function private.refresh_lamp_group(group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.lamp_groups;
  lamps public.devices[];
  lit public.devices[];
  rooms text[];
begin
  select * into g from public.lamp_groups where id = group_id;
  if not found then
    delete from public.devices where id = 'group:' || group_id;
    return;
  end if;
  select coalesce(array_agg(d order by d.name), '{}') into lamps from public.devices d where d.id = any (g.members);
  select coalesce(array_agg(d), '{}') into lit from unnest(lamps) d where d.online and (d.state ->> 'on')::boolean;
  select array_agg(distinct d.room) into rooms from unnest(lamps) d where d.room is not null;

  insert into public.devices (id, integration, kind, name, room, online, state, updated_at)
  values (
    'group:' || g.id, 'app', 'group', g.name,
    case when cardinality(rooms) = 1 then rooms[1] end,
    exists (select 1 from unnest(lamps) d where d.online),
    jsonb_strip_nulls(jsonb_build_object(
      'on', cardinality(lit) > 0,
      'lights', cardinality(g.members),
      'members', to_jsonb(g.members),
      'brightness', (select max((d.state ->> 'brightness')::numeric) from unnest(lit) d),
      'color', case when cardinality(lamps) > 0 and (select bool_and(coalesce((d.state ->> 'color')::boolean, false)) from unnest(lamps) d) then true end,
      'kelvin_warm', case when (select bool_and(d.state ? 'kelvin_warm') from unnest(lamps) d)
        then (select max((d.state ->> 'kelvin_warm')::numeric) from unnest(lamps) d) end,
      'kelvin_cool', case when (select bool_and(d.state ? 'kelvin_cool') from unnest(lamps) d)
        then (select min((d.state ->> 'kelvin_cool')::numeric) from unnest(lamps) d) end,
      'color_temp', case when (select bool_and(d.state ? 'color_temp') from unnest(lit) d)
        then (select max((d.state ->> 'color_temp')::numeric) from unnest(lit) d) end
    )),
    now()
  )
  on conflict (id) do update set
    name = excluded.name, room = excluded.room, online = excluded.online,
    state = excluded.state, updated_at = excluded.updated_at
  where public.devices.state is distinct from excluded.state
     or public.devices.online is distinct from excluded.online
     or public.devices.name is distinct from excluded.name
     or public.devices.room is distinct from excluded.room;
end;
$$;

create function private.on_lamp_group_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_lamp_group(coalesce(new.id, old.id));
  return null;
end;
$$;

create trigger lamp_groups_refresh
  after insert or update or delete on public.lamp_groups
  for each row execute function private.on_lamp_group_change();

create function private.on_lamp_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  for gid in select id from public.lamp_groups where new.id = any (members) loop
    perform private.refresh_lamp_group(gid);
  end loop;
  return null;
end;
$$;

create trigger devices_refresh_lamp_groups
  after insert or update of state, online, name, room on public.devices
  for each row
  when (new.integration <> 'app')
  execute function private.on_lamp_change();

-- A command to a group becomes the same command to each of its lamps.
create function private.fan_out_group_command()
returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.lamp_groups;
begin
  select * into g from public.lamp_groups where 'group:' || id = new.device_id;
  if not found then
    new.status := 'failed';
    new.error := 'This group no longer exists';
    return new;
  end if;
  insert into public.commands (device_id, action, params, source, created_by)
  select m, new.action, new.params, new.source, new.created_by
  from unnest(g.members) m
  where exists (select 1 from public.devices d where d.id = m);
  new.status := 'done';
  new.completed_at := now();
  return new;
end;
$$;

create trigger commands_fan_out_groups
  before insert on public.commands
  for each row
  when (new.device_id like 'group:%')
  execute function private.fan_out_group_command();

revoke all on function private.refresh_lamp_group(uuid), private.on_lamp_group_change(),
  private.on_lamp_change(), private.fan_out_group_command() from public;
