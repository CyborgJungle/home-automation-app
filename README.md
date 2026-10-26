# Home Automation

A self-built smart-home app: lights, heating, blinds, TV, speakers, a robot vacuum and a custom LED display in one iPhone-friendly web app, with scenes and automations that keep running when the app is closed.

**Live:** private (invite-only sign-in) · **Stack:** Next.js, Supabase, Node.js on a Raspberry Pi, Vercel

## What it does

- Controls IKEA lights (TRÅDFRI and DIRIGERA), Honeywell evohome heating and floor heating, Brel blinds, a Sony BRAVIA TV, Sonos speakers, Apple TV and HomePod, a Roborock vacuum, and a custom IKEA OBEGRÄNSAD LED display.
- Four tabs: **Home** (every device by type), **Scenes** (set several devices at once), **Automations** (when-this-then-that rules) and **Activity** (Pi and connection health, plus a timeline).
- Automations trigger on time, devices, doorbell rings, weather and sunrise/sunset, with And/Or conditions.
- Installs on the iPhone home screen and reloads itself after a new deploy.

I built it because no single app talks to all of these brands, and because I wanted rules like "when the doorbell rings, flash the lamps" without running a home server with open ports.

## How it's built

```
 Phone / laptop ──► Vercel (web/)  ◄──►  Supabase (database + realtime)
                                          │      ▲
              evohome function (every 5 min) ──► Honeywell evohome cloud
                                                 │
                     Raspberry Pi (agent/) ──────┘  connects out; no port forwarding
                       ├─► IKEA TRÅDFRI gateway   (your home network)
                       ├─► Brel Home hub          (your home network, UDP)
                       ├─► Sony BRAVIA TV         (your home network, HTTP)
                       └─► Sonos speakers         (your home network, UPnP)
```

- The Pi connects *out* to Supabase, so there is no port forwarding and nothing exposed on the home network.
- Commands go through a queue and expire after 2 minutes, so an old tap never fires late.
- Automations live in the database (triggers and pg_cron), not in the app, so they work with the phone off.
- Only e-mail addresses on an allow-list can sign in; a Postgres hook rejects everyone else.

**The parts:**
- `web/` is a Next.js app on Vercel, made to be added to an iPhone home screen (Safari → Share → **Add to Home Screen**). It has four tabs: **Home** (every device, grouped by type; tap a tile to switch it, tap › for more controls), **Scenes** (tap a card to set several devices at once; the pencil edits it), **Automations** (simple when-this-then-that rules) and **Activity** (Pi and connection health, plus a timeline). After a new deploy the app reloads itself the next time you switch back to it.
- **Scenes** (`supabase/migrations/20261017000700_scenes.sql`) are saved sets of device actions. The app plays one with the `play_scene` function, and automations can play scenes too.
- **Keeping Supabase awake:** free projects pause after a week without user activity. The Pi's heartbeat normally covers that; as a backup, Vercel Cron calls `/api/keepalive` every day (`web/vercel.json`), which writes a timestamp through `public.keepalive()`.
- **Automations run in Supabase** (`supabase/migrations/20261017000600_automation_engine.sql`): database triggers react to device changes and doorbell rings, and pg_cron checks time rules every minute (Amsterdam time). Their actions become ordinary commands, so they work with the app closed.
- The automation editor has three categories: **Time**, **Device**, and **Weather**. Doorbell rings are under Device; sunrise/sunset are under Weather. Add **And / Or** blocks before **Then** to combine checks. And checks match together; Or starts an alternative group. Time also supports ranges, including overnight. The logic engine (`20261017001400_automation_logic.sql`) preserves older rules and queues shared actions once per matching change.
- **Weather** (`supabase/functions/weather/`) uses Open-Meteo for the location configured in `weather_config` (set by postcode). The cloud refreshes outdoor temperature, rain, cloud cover, wind, rain probability, and sunrise/sunset every 15 minutes, independently of the app. Automations offers weather changes, sun-event offsets, and optional weather conditions on every rule. Readings older than 45 minutes are ignored by weather-dependent rules. See the [weather setup and tests](supabase/functions/weather/README.md).
- `supabase/functions/evohome/` talks to the Honeywell cloud. The database runs it every 5 minutes and right away when you press a heating button, so heating works even when the Pi is off.
- `agent/` runs on the Raspberry Pi for the devices that need your home network or an always-on connection: the IKEA gateway, the Brel blinds, the Sony TV and the Sonos speakers.
- `supabase/migrations/` holds the database schema (already applied to the `home-automation` Supabase project).

## Run it locally

```sh
cd web && cp .env.example .env.local && npm install && npm run dev
node --experimental-strip-types --test supabase/functions/evohome/honeywell.test.ts
```

You need your own Supabase project, Google OAuth client and devices; the setup below walks through all of it.

## Setup

### 1. Sign-in

Only emails in the `allowed_emails` table can sign in or see anything. Add each of you in the Supabase **SQL editor**:

```sql
insert into allowed_emails (email) values ('someone@gmail.com');
```

**Google sign-in** (one-time setup):

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project → **APIs & Services → OAuth consent screen**. Choose *External*, give the app a name, and add both your Google addresses as **test users**.
2. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized redirect URIs* add `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. Copy the client ID and secret.
3. Supabase → **Authentication → Sign In / Providers → Google**: enable it and paste the client ID and secret. Leave **Allow new users to sign up** on; the hook below blocks anyone not on the list.
4. Supabase → **Authentication → URL Configuration**: set *Site URL* to `https://<your-app>.vercel.app`, and add these redirect URLs:
   `https://<your-app>.vercel.app/auth/callback`, `https://*-<your-team>.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`
5. Supabase → **Authentication → Hooks → Before User Created** → Postgres → `public.hook_allowlist_signup`. This rejects any new account whose email isn't on the list.

Email and password still works as a fallback: **Authentication → Users → Add user** (tick *Auto Confirm User*).
### 2. Honeywell evohome

Supabase → **Edge Functions → Secrets**: add `EVOHOME_USERNAME` and `EVOHOME_PASSWORD` (your evohome app login). Within 5 minutes your zones appear on the website.

If the login fails with a DNS or 404 error, also add `EVOHOME_HOST=https://tccna.honeywell.com`. After a wrong password the function waits 30 minutes before trying again, so Honeywell doesn't lock the account.
### 3. Raspberry Pi (IKEA, Brel, Sony TV, Sonos)

You need an Ethernet cable (the Pi 2 has no Wi-Fi) and Raspberry Pi OS Lite (32-bit), flashed with Raspberry Pi Imager. In the Imager settings, set the hostname to `home-agent`, the user to `pi`, and enable SSH. Leave Raspberry Pi Connect off.

Node.js goes in the `pi` user's home folder, so installing and updating it needs no `sudo`. Node 22 is the last version with builds for the Pi 2's 32-bit ARM chip.

```sh
# On the Pi: Node.js 22 (armv7l for a Pi 2, arm64 for a 64-bit Pi 3/4)
ARCH=$(uname -m | sed 's/aarch64/arm64/')
F=node-v22.23.3-linux-$ARCH.tar.xz
curl -fsSLO https://nodejs.org/dist/v22.23.3/$F
curl -fsSL https://nodejs.org/dist/v22.23.3/SHASUMS256.txt | grep " $F$" | sha256sum -c -
mkdir -p ~/.local/node && tar -xJf $F -C ~/.local/node --strip-components=1 && rm $F
echo 'export PATH="$HOME/.local/node/bin:$PATH"' >> ~/.profile && . ~/.profile
node -v
```

The repo is private, so copy the agent from your computer instead of cloning it on the Pi:

```sh
# On your computer, from the repo root
rsync -a --delete --exclude node_modules --exclude .env --exclude data agent/ pi@home-agent.local:home-automation/agent/
```

```sh
# On the Pi
cd ~/home-automation/agent
npm ci --omit=dev
cp .env.example .env
nano .env
```

Fill in `.env` one integration at a time and test with **`npm run discover`** after each one. It logs in, lists what it finds and exits, without touching Supabase.

- **IKEA DIRIGERA:** run `npm run pair-dirigera -- <hub IP>` and press the action button on the bottom of the hub when asked. It saves the hub address and its key to `.env` for you. Lamps, plugs, blinds, motion sensors and shortcut buttons show up with the names and rooms from the IKEA Home smart app; each room with lamps also becomes a "room lights" tile. Motion and button presses can start automations. Lamps linked to the same IKEA remote go back to one brightness a few seconds after you use it, since dimming with a remote moves each lamp from its own level.
- **IKEA TRÅDFRI** (the older gateway): run `npm run pair-tradfri -- <security code>`. The code is on the label under the gateway.
- **Brel Home blinds:** in the Brel Home app, open **Me** and tap 5 times on the version number (iOS) or right of the photo (Android) to show the hub's 16-character key. Put it in `BREL_KEY`. The hub is found automatically. Blinds are called "Blind 1", "Blind 2"…; name them with `BREL_NAMES` (the macs are in `npm run discover`).
- **Apple TV / HomePod:** install pyatv once in its own folder: `python3 -m venv ~/.local/pyatv && ~/.local/pyatv/bin/pip install pyatv` (ready-made packages, about 2 minutes on a Pi 2). Set `APPLE_DEVICES=Woonkamer,Kantoor` (names as in the Home app). HomePods need no pairing; for an Apple TV run `~/.local/pyatv/bin/python apple/pair.py "Woonkamer"` and type the codes shown on the TV, then restart the agent. Turn on *Control TVs and Receivers* on the Apple TV so it also switches the TV on and off.
- **Roborock vacuum (S5 and other miIO models):** the robot talks to the Pi over the local network, no cloud. Put its IP address in `ROBOROCK_HOST` and its 32-character device token in `ROBOROCK_TOKEN`. The token comes from your Xiaomi/Roborock account: for an S5 that is paired in the Mi Home app, the [Xiaomi Cloud Tokens Extractor](https://github.com/PiotrMachowski/Xiaomi-cloud-tokens-extractor) lists it; the Roborock app itself doesn't show it. Give the robot a fixed IP in your router. Restart the agent; "Roborock" then shows under Cleaning with start, pause, dock, find and suction.
- **Sonos:** nothing to set up beyond `SONOS_HOST=<a speaker's IP>` (or `SONOS=on`); speakers are found on the network. Sonos favourites (the heart in the Sonos app) can be played from the app, scenes and automations.
- **Sony TV:** on the TV, go to **Settings → Network & Internet → Home network → IP control**. Set **Authentication** to *Normal and Pre-Shared Key*, choose a **Pre-Shared Key**, and turn on **Remote start** (so the TV can be switched on from standby). Put the TV's IP address in `BRAVIA_HOST` and the key in `BRAVIA_PSK`. To keep the TV on the right input, add which device sits on which HDMI port, e.g. `BRAVIA_HDMI_2=presence:192-168-1-237` (Steam machine) and `BRAVIA_HDMI_3=apple:…` (Apple TV): when one comes on, when the TV comes on, or when the TV lands on an empty input, the agent switches to the input of the device that's on.

When `discover` looks right, add the Supabase secret key to `.env` (Project Settings → API Keys → **secret**) and run the agent as a service:

```sh
sudo cp home-agent.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/journald.conf.d && sudo cp journald-size.conf /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald
sudo systemctl enable --now home-agent
journalctl -u home-agent -f     # live log
```
### IKEA OBEGRÄNSAD LED display

The ESP32 display uses the Pi directly, independently of the DIRIGERA hub. It
appears under Lights with on/off and brightness, and can be used in scenes and
automations. Off blanks the LEDs; the ESP32 stays powered for Wi-Fi and OTA.

**Camera mode.** The display firmware ([my fork of ikea-led-obegraensad](https://github.com/CyborgJungle/ikea-led-obegraensad)) has a **Camera** mode: your phone's camera shown live on the lamp in 16×16 greyscale, with brightness, contrast, front/back and invert. Phones only allow camera access on secure pages, so it runs on the display's own HTTPS page, and the display's app walks you through trusting its certificate once. It is used from the display's own app on the home network; this home app controls power, brightness, scenes and automations.

See [display setup and remote access](docs/ikea-display.md). The existing Vercel
app and Pi connection provide remote control; the display itself remains on the
home LAN.
### 4. Test

Open the Vercel URL and sign in.
- Each section shows whether its connection works (● Connected) or what's wrong. The **Raspberry Pi agent** box should say *Online*.
- Press a light's or heating zone's button. The **Command log** shows `done` and how long it took, or `failed` with the reason.

## Known limits

- The TRÅDFRI gateway doesn't pass on motion-sensor or remote-button presses. Those devices appear (with battery level) but can't trigger anything.
- The Honeywell API is unofficial (the same one Home Assistant uses). Heating status refreshes every 5 minutes because Honeywell rate-limits the API.
- Commands older than 2 minutes are dropped, so taps made while something was offline don't all fire when it comes back.

## About

A personal project by [CyborgJungle](https://github.com/CyborgJungle), built with [Claude Code](https://claude.com/claude-code) and hosted on [Vercel](https://vercel.com). It is shared as part of my portfolio: feel free to copy it and make it your own.

## License

MIT, see [LICENSE](LICENSE).
