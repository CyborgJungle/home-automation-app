# IKEA OBEGRÄNSAD ESP32 display

## Connection

Phone anywhere → signed-in Vercel home app → existing Supabase command queue →
Raspberry Pi agent → display's local HTTP API.

The Pi connects out to Supabase. There is no router port forwarding and no
public ESP32 endpoint. Existing sign-in, command permissions, realtime updates,
command expiry, scenes and automation logic are reused. No Supabase credentials
are added to the display. This works only while the Pi, its internet connection
and the display are reachable.

This custom ESP32 firmware is separate from IKEA DIRIGERA/TRÅDFRI accessories.
The adapter supports the inspected `CyborgJungle/ikea-led-obegraensad` fork's
`GET /api/info` and `PATCH /api/brightness?value=0..255` endpoints. It does not
use `/update`, upload firmware, or require OTA credentials.

## Preparation and installation

The code can be built and tested remotely. This PR does not change the running
Pi, live database or display. To activate it:

1. Apply the new `*_ikea_display.sql` migration to the home-automation database
   through the normal reviewed migration process. It only extends the existing
   device integration constraint; existing policies and permissions remain.
2. Deploy this web version through the normal Vercel Git workflow. The display
   reuses the existing Lights tile, brightness slider, scenes and automations.
3. At home, give the display a DHCP reservation and verify its normal web app
   and `/api/info` are reachable from the Pi. Disable **Scheduled brightness**
   in the IKEA display app, so the home app can control brightness without the
   device's independent scheduler overriding it. Use home-app automations for
   scheduled brightness and on/off instead. Animation scheduling can stay on.
4. Copy/update `agent/` on the Pi using the existing README process. Add to its
   private `.env` (replace the host with its current LAN IP or hostname):

   ```ini
   IKEA_DISPLAY_HOST=ikea-led.local
   IKEA_DISPLAY_NAME=IKEA display
   IKEA_DISPLAY_ROOM=Woonkamer
   ```

   IP addresses are more reliable if the Pi cannot resolve `.local`. Do not put
   `http://`, a path or a password in the host setting. Leave the host blank to
   disable the integration. The adapter currently supports one display.
5. Run `npm run discover` on the Pi. It only reads the display's state and
   does not write commands or Supabase records. Then restart `home-agent`.
6. Confirm it appears under Lights and the Activity integration status is
   healthy. Test Off, On and a chosen brightness locally, then repeat through
   the signed-in Vercel app over mobile data. Check command completion and the
   actual display; mocked tests do not establish hardware compatibility.

## Control behavior

- The device is `ikeadisplay:screen`, kind `light`. Commands are `set` with
  `on` (boolean) and/or `brightness` (0–100 percent).
- Off sends brightness zero; Wi-Fi, animations and OTA remain running. This
  is screen blanking, not mains power switching or deep sleep.
- On restores the last positive base brightness observed by the Pi. It is
  saved in `DATA_DIR/ikea-display.json`, including across agent restarts. If
  the display starts off and no saved value exists, On defaults to 100%.
- An explicit brightness is scaled to 0–255. The reported state uses actual
  displayed brightness. Successful commands require a confirming API read;
  timeouts and HTTP errors fail the command instead of claiming success.
- When the display's built-in brightness schedule is enabled, commands fail
  with a clear instruction to disable it. The integration does not silently
  disable or rewrite that schedule. The detail sheet shows the same guidance.
- The Pi polls every ten seconds; ordinary queue commands are handled through
  the existing realtime/poll mechanism. An unreachable display is marked
  offline. Old queued commands still expire after two minutes.
- Other edits in the IKEA app are reflected by polling. Concurrent brightness
  edits can conflict; use one controller at a time when validating commands.
- Power loss and boot-time flashes are firmware behavior; this adapter cannot
  guarantee that the display remains dark throughout a reboot.

## Remote access scope

The signed-in home automation app provides remote screen on/off, brightness,
scenes and automations through the Pi. No separate IKEA frontend deployment,
VPN or public device endpoint is needed. The full IKEA editor and firmware
upload page stay local. Merely hosting that editor on Vercel would not create
a route to the ESP32; this integration uses the existing cloud command queue
instead. Do not forward the display's port 80 or `/update` to the internet.

## Checks

`cd agent && npm test` exercises the adapter against a mocked display API,
including command errors, offline recovery, brightness restoration after restart,
schedule conflicts and queued command ordering. `cd web && npm run lint` and
`npx next typegen && npx tsc --noEmit` check the web integration. No tests contact the display.
