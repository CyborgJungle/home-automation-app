-- Group commands from the app were refused: the insert policy only accepts
-- 'pending' commands, and the fan-out marked them 'done' before the check.
-- Fan out after the insert instead, then mark the group command done.
drop trigger commands_fan_out_groups on public.commands;

create or replace function private.fan_out_group_command()
returns trigger language plpgsql security definer set search_path = '' as $$
declare g public.lamp_groups;
begin
  select * into g from public.lamp_groups where 'group:' || id = new.device_id;
  if not found then
    update public.commands set status = 'failed', error = 'This group no longer exists', completed_at = now()
    where id = new.id;
    return null;
  end if;
  insert into public.commands (device_id, action, params, source, created_by)
  select m, new.action, new.params, new.source, new.created_by
  from unnest(g.members) m
  where exists (select 1 from public.devices d where d.id = m);
  update public.commands set status = 'done', completed_at = now() where id = new.id;
  return null;
end;
$$;

create trigger commands_fan_out_groups
  after insert on public.commands
  for each row
  when (new.device_id like 'group:%')
  execute function private.fan_out_group_command();
