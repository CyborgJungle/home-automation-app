-- Brel Home blinds and the Sony BRAVIA TV, both run by the Pi agent.
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('tradfri', 'evohome', 'eufy', 'brel', 'bravia'));

alter table public.devices drop constraint devices_kind_check;
alter table public.devices add constraint devices_kind_check
  check (kind in ('light', 'group', 'plug', 'blind', 'sensor', 'remote', 'zone', 'heating', 'doorbell', 'tv'));
