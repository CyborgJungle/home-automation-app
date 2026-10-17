# Home automation

Personal home automation, starting with Honeywell Evohome through **Total Connect
Comfort Europe/UK**. The first integration reads locations, heating zones, current
temperatures, target temperatures, and operating modes. It does not change heating
settings. A private web dashboard and API can run on Vercel, using the same
integration as the command-line tool. It requires an Evohome controller/gateway
already working in the TCC app.

## Website and backend

The FastAPI application in `app.py` serves both the dashboard and
`GET /api/evohome/status`. Your TCC credentials stay on the server. All dashboard
and API routes require HTTP Basic authentication, using a **separate dashboard
password**. The app refuses access until that password has been configured.
Use HTTPS for deployed apps; local HTTP is only for development on your machine.

For local development:

1. Run `uv sync --locked`.
2. Copy `.env.example` to `.env` and fill in `DASHBOARD_PASSWORD` with a strong,
   unique password. Keep `DASHBOARD_USERNAME=owner` or choose your own username.
3. Run `uv run --env-file .env uvicorn app:app --host 127.0.0.1 --port 8000`.
4. Open the local server in your browser and use your **dashboard** login.

The dashboard starts with labelled sample data. To connect your heating, fill in
`EVOHOME_USERNAME` and `EVOHOME_PASSWORD` in `.env`, restart the server, and select
**My Evohome**. Your Honeywell credentials are never included in browser responses.

### Deploy to Vercel

1. Import this GitHub repository as a Vercel project, selecting the branch that
   contains this application and the repository root as its root directory.
2. Select the **FastAPI** framework. `app.py` exports the ASGI app; `.python-version`
   selects Python 3.13, and `pyproject.toml` / `uv.lock` describe the package and
   dependencies. No frontend build or output directory is needed.
3. In Vercel's environment settings, configure `DASHBOARD_USERNAME` (e.g. `owner`)
   and a strong, unique `DASHBOARD_PASSWORD`. Configure `EVOHOME_USERNAME` and
   `EVOHOME_PASSWORD` as sensitive server environment variables to enable live
   readings. Never use frontend/public environment variables for these values.
4. Deploy, sign in, and check **Demo home**, then **My Evohome**. Redeploy after
   changing environment variables. Only add production Honeywell credentials to
   trusted deployments; preview deployments can use demo mode instead.

Vercel builds and deployment need separate validation once account access is
connected. The application is tested locally; that does not verify deployment.

The app reuses its Honeywell session and access tokens while a server instance is
warm. Readings and failures are cached for five minutes per instance. Serverless
instances can restart or run concurrently: this cache is **not** durable and does
not impose an account-wide rate limit. The dashboard does not poll automatically.

### Adding devices and automations

The planned devices are a Raspberry Pi gateway, Eufy doorbell, IKEA TRADFRI bridge
with lights and sensors, and Honeywell Evohome. See [the roadmap](docs/roadmap.md)
for their roles and the next steps.

Device adapters belong in `src/home_automation/`, with API routes in `web.py`.
The Evohome adapter is independent of the website and can be reused by a job
runner. Before enabling automations, add a managed database for devices, rules,
shared token storage and execution logs, plus a scheduler/queue with durable
retries, deduplication and a shared API rate limit. Vercel Cron can trigger simple
schedules, subject to your plan's current frequency and runtime limits.

Vercel functions are not an always-running home hub. Devices requiring local
network access or ongoing connections need an external worker or the Raspberry
Pi at home. This first version has **no active automations or heating controls**.

## Get started

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Python 3.13
or newer, then run from this repository:

```sh
uv sync --locked
uv run home-automation evohome status --demo
uv run home-automation evohome status
```

The live command prompts for your TCC email and password in your terminal. The
password is hidden. Use your **Total Connect Comfort Europe/UK** account, not a US
TCC or Honeywell Home developer account. No developer API key is required.

For unattended use, provide `EVOHOME_USERNAME` and `EVOHOME_PASSWORD` using your
runtime's secure environment settings, then run:

```sh
uv run home-automation evohome status --no-input --json
```

Do not put credentials in code, GitHub issues, chat, or command arguments. `.env`
files are ignored but are **not automatically loaded**. The command saves no
passwords or access tokens to disk. Tokens are reused in memory for each run;
each separate live invocation signs in again. This initial command is for manual
connection checks, not frequent polling. A long-running integration with token
reuse should precede scheduled automation.

`--demo` uses clearly labelled sample data and needs no account or network access.
`--json` provides the same data as structured JSON, with a UTC observation time and
an explicit `source` of `demo` or `evohome`. Temperatures are in Celsius; an
unavailable sensor is represented by `null` and displayed as `unavailable`.
All account locations, gateways, and heating systems are included. Domestic hot
water and heating controls are future work.

## Development

```sh
uv sync --locked
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Tests run offline with simulated clients. Live account access must be checked
separately with the live command above.

The integration uses [evohome-async](https://github.com/zxdavb/evohome-async),
also used by Home Assistant, rather than implementing Honeywell authentication
from scratch. Cloud access requires HTTPS to `tccna.resideo.com`. The HTTP client
uses standard proxy environment settings and verifies TLS certificates. Start
the web server as described above when developing the website. The CLI needs no
background service.

## Troubleshooting

- **Missing credentials:** run interactively, or set both variables in secure
  environment settings. `--no-input` fails promptly when either is missing.
- **Sign-in failure:** confirm your credentials in the TCC Europe/UK app and
  accept any updated terms there. The CLI deliberately omits raw API errors.
- **Rate limit:** stop retrying and wait before running again. There are no
  automatic retries or background polling.
- **Connection failure:** check Internet/proxy access to `tccna.resideo.com`.
- **No locations or heating zones:** check that your Evohome installation is
  visible in the same TCC account. This is reported as an error, not a successful
  connection.

GitHub Actions runs the offline tests and lint checks for pushes and pull requests.
