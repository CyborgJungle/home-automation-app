-- Apple TV and HomePod (via pyatv on the Pi). Apple TVs use the existing
-- 'tv' kind and HomePods the 'speaker' kind.
alter table public.devices drop constraint devices_integration_check;
alter table public.devices add constraint devices_integration_check
  check (integration in ('tradfri', 'evohome', 'eufy', 'brel', 'bravia', 'sonos', 'apple'));
