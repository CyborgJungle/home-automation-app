// Connection test: logs in to every configured integration, prints the devices
// it finds, and exits. Doesn't touch Supabase, so it works before anything else is set up.
// Usage: npm run discover

import { config } from '../src/config.js';
import { createIntegrations } from '../src/integrations/index.js';
import { createLogger } from '../src/log.js';

const WAIT_MS = 30_000;

const log = createLogger('discover');
const devices = new Map();
const status = {};

const hub = {
  devices,
  upsertDevice: async (row) => devices.set(row.id, row),
  patchState: async (id, patch) => {
    const row = devices.get(id);
    if (row) devices.set(id, { ...row, state: { ...row.state, ...patch } });
  },
  event: async (type, deviceId) => log.info(`event ${type} from ${deviceId}`),
  status: (name, ok, error = null) => (status[name] = { ok, error }),
  heartbeat: async () => {},
};

const integrations = createIntegrations(config, hub, log);
if (!integrations.length) {
  log.error('Nothing configured. Fill in TRÅDFRI, evohome and/or Eufy settings in .env first.');
  process.exit(1);
}

await Promise.all(
  integrations.map(async (integration) => {
    try {
      await integration.start();
      status[integration.name] ??= { ok: true, error: null };
    } catch (e) {
      status[integration.name] = { ok: false, error: e.message };
    }
  }),
);

log.info(`waiting ${WAIT_MS / 1000}s for devices to report in...`);
await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

console.log('\n=== Integrations ===');
for (const integration of integrations) {
  const s = status[integration.name];
  console.log(`${s?.ok ? 'OK  ' : 'FAIL'} ${integration.name}${s?.error ? `: ${s.error}` : ''}`);
}

console.log('\n=== Devices ===');
const rows = [...devices.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const d of rows) {
  console.log(`${d.online ? ' ' : '!'} ${d.id.padEnd(32)} ${d.kind.padEnd(9)} ${d.name}  ${JSON.stringify(d.state)}`);
}
console.log(`\n${rows.length} device(s). "!" = offline/unreachable.`);

for (const integration of integrations) {
  try {
    integration.stop();
  } catch {
    // never started
  }
}
process.exit(0);
