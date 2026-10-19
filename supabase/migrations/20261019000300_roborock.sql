-- Roborock vacuum: a new integration and a new kind of device.
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('app', 'dirigera', 'tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple', 'roborock'));

alter table public.devices drop constraint devices_kind_check;
alter table public.devices add constraint devices_kind_check
  check (kind in ('light', 'group', 'plug', 'blind', 'sensor', 'remote', 'zone', 'heating', 'doorbell', 'tv', 'speaker', 'vacuum'));
