# home-automation

A first version for testing the connections: can we reach the IKEA lights, the Honeywell heating and the Eufy doorbell, and do they respond?

```
 Phone / laptop ──► Vercel (web/)  ◄──►  Supabase (database + realtime)
                                               ▲
                     Raspberry Pi (agent/) ────┘  connects out; no port forwarding
                       ├─► IKEA TRÅDFRI gateway   (your home network)
                       ├─► Honeywell evohome      (Honeywell cloud)
                       └─► Eufy doorbell          (Eufy cloud + push)
```

- `web/` is a Next.js app on Vercel. It has a login and one page listing every device, with one test button per device and a log showing whether each command worked.
- `agent/` runs on the Raspberry Pi. It reports devices to Supabase and carries out the commands the web app queues.
- `supabase/migrations/` holds the database schema (already applied to the `home-automation` Supabase project).

## 1. Accounts (Supabase)

1. Supabase dashboard → **Authentication → Users → Add user → Create new user**. Enter an email and password and tick **Auto Confirm User**. Do this once for each person.
2. Only emails in the `allowed_emails` table can see or control anything. Add each of you in the **SQL editor**:
   ```sql
   insert into allowed_emails (email) values ('someone@example.com');
   ```
3. **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**.

## 2. Raspberry Pi

You need an Ethernet cable (the Pi 2 has no Wi-Fi) and Raspberry Pi OS Lite, flashed with Raspberry Pi Imager. In the Imager settings, set the user to `pi` and enable SSH.

```sh
# Node.js 22 (official build; armv7l for a Pi 2, arm64 for a 64-bit Pi 3/4)
ARCH=$(uname -m | sed 's/aarch64/arm64/')
curl -fsSLO https://nodejs.org/dist/v22.23.3/node-v22.23.3-linux-$ARCH.tar.xz
sudo tar -xJf node-v22.23.3-linux-$ARCH.tar.xz -C /usr/local --strip-components=1
node -v

# The code
sudo apt install -y git
git clone https://github.com/cyborgjungle/home-automation.git
cd home-automation/agent
npm ci --omit=dev
cp .env.example .env
nano .env
```

Fill in `.env` one integration at a time and test with **`npm run discover`** after each one. It logs in, lists what it finds and exits, without touching Supabase.

- **IKEA TRÅDFRI:** run `npm run pair-tradfri -- <security code>`. The code is on the label under the gateway. Paste the three lines it prints into `.env`.
- **Honeywell evohome:** use the email and password you use in the evohome app.
- **Eufy:** ideally a second Eufy account that the doorbell is shared with (Eufy app → device settings → share). That way the agent won't sign your phone out. On the first login Eufy may email a code or ask for a captcha. The agent log tells you which `.env` line to fill in, then run it again.

When `discover` looks right, add the Supabase secret key to `.env` (Project Settings → API Keys → **secret**) and run the agent as a service:

```sh
sudo cp home-agent.service /etc/systemd/system/
sudo systemctl enable --now home-agent
journalctl -u home-agent -f     # live log
```

## 3. Test

Open the Vercel URL and sign in.
- The **Raspberry Pi agent** box should say *Online*, with a green dot per integration.
- Press a light's button. The **Command log** shows `done` and how long it took, or `failed` with the reason.
- Ring the doorbell. A row should appear under **Events** within a few seconds.

## Known limits

- The TRÅDFRI gateway doesn't pass on motion-sensor or remote-button presses. Those devices appear (with battery level) but can't trigger anything.
- The Honeywell and Eufy APIs are unofficial (the same ones Home Assistant uses). Heating status refreshes every 5 minutes because Honeywell rate-limits the API.
- Commands older than 2 minutes are dropped, so taps made while the Pi was offline don't all fire when it comes back.

## Development

```sh
cd web && cp .env.example .env.local && npm install && npm run dev
cd agent && npm install && npm test
```
