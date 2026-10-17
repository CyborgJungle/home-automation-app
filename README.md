# home-automation

A first version for testing the connections: can we reach the IKEA lights, the Honeywell heating, the Brel blinds, the Sony TV and the Eufy doorbell, and do they respond?

```
 Phone / laptop ──► Vercel (web/)  ◄──►  Supabase (database + realtime)
                                          │      ▲
              evohome function (every 5 min) ──► Honeywell evohome cloud
                                                 │
                     Raspberry Pi (agent/) ──────┘  connects out; no port forwarding
                       ├─► IKEA TRÅDFRI gateway   (your home network)
                       ├─► Brel Home hub          (your home network, UDP)
                       ├─► Sony BRAVIA TV         (your home network, HTTP)
                       ├─► Sonos speakers         (your home network, UPnP)
                       └─► Eufy doorbell          (Eufy cloud + push)
```

- `web/` is a Next.js app on Vercel, made to be added to an iPhone home screen (Safari → Share → **Add to Home Screen**). It has four tabs: **Home** (every device, grouped by type; tap a tile to switch it, tap › for more controls), **Scenes** (tap a card to set several devices at once; the pencil edits it), **Automations** (simple when-this-then-that rules) and **Activity** (Pi and connection health, plus a timeline). After a new deploy the app reloads itself the next time you switch back to it.
- **Scenes** (`supabase/migrations/20261017000700_scenes.sql`) are saved sets of device actions. The app plays one with the `play_scene` function, and automations can play scenes too.
- **Keeping Supabase awake:** free projects pause after a week without user activity. The Pi's heartbeat normally covers that; as a backup, Vercel Cron calls `/api/keepalive` every day (`web/vercel.json`), which writes a timestamp through `public.keepalive()`.
- **Automations run in Supabase** (`supabase/migrations/20261017000600_automation_engine.sql`): database triggers react to device changes and doorbell rings, and pg_cron checks time rules every minute (Amsterdam time). Their actions become ordinary commands, so they work with the app closed.
- `supabase/functions/evohome/` talks to the Honeywell cloud. The database runs it every 5 minutes and right away when you press a heating button, so heating works even when the Pi is off.
- `agent/` runs on the Raspberry Pi for the devices that need your home network or an always-on connection: the IKEA gateway, the Brel blinds, the Sony TV and the Eufy doorbell.
- `supabase/migrations/` holds the database schema (already applied to the `home-automation` Supabase project).

## 1. Sign-in

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

## 2. Honeywell evohome

Supabase → **Edge Functions → Secrets**: add `EVOHOME_USERNAME` and `EVOHOME_PASSWORD` (your evohome app login). Within 5 minutes your zones appear on the website.

If the login fails with a DNS or 404 error, also add `EVOHOME_HOST=https://tccna.honeywell.com`. After a wrong password the function waits 30 minutes before trying again, so Honeywell doesn't lock the account.

## 3. Raspberry Pi (IKEA, Brel, Sony TV, Eufy)

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
npm ci --omit=dev --omit=optional   # skips the large Eufy library until you need it
cp .env.example .env
nano .env
```

When you add Eufy later, run `npm ci --omit=dev` once to install its library.

Fill in `.env` one integration at a time and test with **`npm run discover`** after each one. It logs in, lists what it finds and exits, without touching Supabase.

- **IKEA TRÅDFRI:** run `npm run pair-tradfri -- <security code>`. The code is on the label under the gateway. It saves the gateway address and its key to `.env` for you.
- **Brel Home blinds:** in the Brel Home app, open **Me** and tap 5 times on the version number (iOS) or right of the photo (Android) to show the hub's 16-character key. Put it in `BREL_KEY`. The hub is found automatically. Blinds are called "Blind 1", "Blind 2"…; name them with `BREL_NAMES` (the macs are in `npm run discover`).
- **Apple TV / HomePod:** install pyatv once in its own folder: `python3 -m venv ~/.local/pyatv && ~/.local/pyatv/bin/pip install pyatv` (ready-made packages, about 2 minutes on a Pi 2). Set `APPLE_DEVICES=Woonkamer,Kantoor` (names as in the Home app). HomePods need no pairing; for an Apple TV run `~/.local/pyatv/bin/python apple/pair.py "Woonkamer"` and type the codes shown on the TV, then restart the agent. Turn on *Control TVs and Receivers* on the Apple TV so it also switches the TV on and off.
- **Sonos:** nothing to set up beyond `SONOS_HOST=<a speaker's IP>` (or `SONOS=on`); speakers are found on the network. Sonos favourites (the heart in the Sonos app) can be played from the app, scenes and automations.
- **Sony TV:** on the TV, go to **Settings → Network & Internet → Home network → IP control**. Set **Authentication** to *Normal and Pre-Shared Key*, choose a **Pre-Shared Key**, and turn on **Remote start** (so the TV can be switched on from standby). Put the TV's IP address in `BRAVIA_HOST` and the key in `BRAVIA_PSK`.
- **Eufy:** ideally a second Eufy account that the doorbell is shared with (Eufy app → device settings → share). That way the agent won't sign your phone out. On the first login Eufy may email a code or ask for a captcha. The agent log tells you which `.env` line to fill in, then run it again.

When `discover` looks right, add the Supabase secret key to `.env` (Project Settings → API Keys → **secret**) and run the agent as a service:

```sh
sudo cp home-agent.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/journald.conf.d && sudo cp journald-size.conf /etc/systemd/journald.conf.d/
sudo systemctl restart systemd-journald
sudo systemctl enable --now home-agent
journalctl -u home-agent -f     # live log
```

## 4. Test

Open the Vercel URL and sign in.
- Each section shows whether its connection works (● Connected) or what's wrong. The **Raspberry Pi agent** box should say *Online*.
- Press a light's or heating zone's button. The **Command log** shows `done` and how long it took, or `failed` with the reason.
- Ring the doorbell. A row should appear under **Events** within a few seconds.

## Known limits

- The TRÅDFRI gateway doesn't pass on motion-sensor or remote-button presses. Those devices appear (with battery level) but can't trigger anything.
- The Honeywell and Eufy APIs are unofficial (the same ones Home Assistant uses). Heating status refreshes every 5 minutes because Honeywell rate-limits the API.
- Commands older than 2 minutes are dropped, so taps made while something was offline don't all fire when it comes back.

## Development

```sh
cd web && cp .env.example .env.local && npm install && npm run dev
node --experimental-strip-types --test supabase/functions/evohome/honeywell.test.ts
```
