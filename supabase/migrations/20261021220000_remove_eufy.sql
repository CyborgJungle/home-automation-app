-- The Eufy doorbell integration is gone. Doorbells stay a device kind (and
-- 'doorbell.ring' an automation trigger), ready for a new doorbell.
delete from public.integration_status where name = 'eufy';

alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('app', 'dirigera', 'tradfri', 'evohome', 'brel', 'bravia', 'sonos', 'apple', 'roborock', 'ikeadisplay', 'presence'));
