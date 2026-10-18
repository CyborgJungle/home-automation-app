-- IKEA DIRIGERA hub (replaces the TRÅDFRI gateway), and remote button presses
-- as triggers: an event automation can now also ask for one press pattern.
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('dirigera', 'tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple'));

create or replace function private.on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.automations;
begin
  for a in
    select * from public.automations
    where enabled
      and trigger ->> 'type' = 'event'
      and trigger ->> 'event' = new.type
      and (trigger ->> 'device_id' is null or trigger ->> 'device_id' = new.device_id)
      and (trigger ->> 'pattern' is null or trigger ->> 'pattern' = new.data ->> 'pattern')
  loop
    perform private.run_automation(a, jsonb_build_object('cause', new.type, 'device_id', new.device_id));
  end loop;
  return new;
end;
$$;

revoke all on function private.on_event() from public;
