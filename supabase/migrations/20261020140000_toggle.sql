-- "Toggle on/off": a command that switches a device to the opposite of how it
-- is right now (handy for a one-button remote). Turned into an ordinary
-- command before it's stored, using the device's state at that moment:
--   lamps, groups, plugs → set {"on": not on}
--   TVs                  → power {"on": not on}
create function private.on_toggle_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.devices;
  is_on boolean;
begin
  select * into d from public.devices where id = new.device_id;
  if d.id is null or d.kind not in ('light', 'group', 'plug', 'tv') then
    new.status := 'failed';
    new.error := 'This device can''t be toggled';
    return new;
  end if;
  -- The last known state, also for a device that's unreachable right now.
  is_on := coalesce((d.state ->> 'on')::boolean, false);
  new.action := case when d.kind = 'tv' then 'power' else 'set' end;
  new.params := jsonb_build_object('on', not is_on);
  return new;
end;
$$;

revoke all on function private.on_toggle_command() from public;

-- Before the row is stored, so the group and Pi triggers see a normal command.
create trigger commands_toggle
  before insert on public.commands
  for each row
  when (new.action = 'toggle')
  execute function private.on_toggle_command();
