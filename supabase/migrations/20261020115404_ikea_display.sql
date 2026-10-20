-- Register the custom ESP32 display alongside the existing integrations.
-- It uses ordinary light state/commands and the existing RLS policies.
-- Apply before starting a Pi agent configured with IKEA_DISPLAY_HOST.
begin;
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('app', 'dirigera', 'tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple', 'roborock', 'ikeadisplay'));
commit;
