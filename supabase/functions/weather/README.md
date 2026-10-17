# Weather

The `weather` Edge Function polls Open-Meteo for the household location. The
location is set by postcode, for example postcode 1011 AB. PDOK resolves the postcode once;
the resulting latitude/longitude are stored in `weather_config`. No street address
is requested or stored. Location and weather rows are only readable by household
members through RLS.

The function requests Celsius, millimetres, km/h, and Amsterdam time explicitly.
Rain includes both rain and showers; next-hour rain probability is separate from
current rain. Sunrise/sunset are stored as UTC instants for three forecast days,
and schedules use `Europe/Amsterdam` weekdays and daylight-saving rules.

## Deployment

1. Apply `supabase/migrations/20261017001300_weather.sql` to the project. It adds
   weather tables, validation, cloud polling, weather conditions, and sun rules.
   It creates no automations and sends no device commands.
2. Deploy this function with `supabase functions deploy weather --no-verify-jwt`.
   The function enforces its own private bearer secret, so leaving out platform
   JWT verification does not make polling public.
3. Generate a random authentication value and securely set the **same value** as
   the Edge Function secret `WEATHER_CRON_SECRET` and Vault's
   `weather_cron_secret`. Never commit or log that value. The existing Vault
   `project_url` secret is also required, as for Evohome.
4. Run `select private.invoke_weather();` once, then check the `weather` row and
   the `weather-poll` cron job. The job polls every 15 minutes. `checked_at` claims
   prevent overlapping polls within five minutes.

The dashboard only reads cached data and subscribes to changes. Opening it never
calls Open-Meteo. Current conditions are area-level model estimates, not a local
rain sensor. The dashboard provides the Open-Meteo attribution link.

## Rules

- Weather triggers fire on a transition into a matching condition, not on every
  poll while the condition remains true. The first reading, missing values, and
  recovery after stale data are not threshold crossings.
- `conditions` are an AND list of weather predicates. They apply to time, device,
  doorbell, weather, and sunrise/sunset automations. Missing readings or data older
  than 45 minutes block weather-dependent actions.
- Sunrise/sunset rules support offsets from -180 to +180 minutes and selected
  weekdays. The existing minute-based cloud scheduler evaluates them.
- Existing device actions, custom scenes, and the dynamic Everything off scene
  continue through the same command queue. New rules are created by the owner in
  the app; no weather automations are enabled by deployment.
- **Run now** deliberately plays the chosen actions without evaluating the
  trigger or conditions, as its label in the editor explains.

To change the location, update `weather_config` as an administrator and clear its
latitude/longitude. Clear `weather.observed_at`, `state`, and `sun_events` before
the next poll so readings for the old location cannot affect rules.

## Tests

From the repository root:

```sh
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
```

The suite runs the production database migrations in isolated PostgreSQL/PGlite,
including the existing device/scene engine and RLS, and tests provider parsing
without contacting the live project or operating household devices.
