import { createClient } from '@supabase/supabase-js';
import pkg from '../package.json' with { type: 'json' };
import { startCommandLoop } from './commands.js';
import { config } from './config.js';
import { createHub } from './hub.js';
import { createIntegrations } from './integrations/index.js';
import { createLogger } from './log.js';

const HEARTBEAT_MS = 30_000;
const RETRY_MS = 60_000;

const log = createLogger('agent');

if (!config.supabaseUrl || !config.supabaseSecretKey) {
  log.error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const hub = createHub(supabase, log.child('hub'), pkg.version);
const integrations = await createIntegrations(config, hub, log);

if (!integrations.length) {
  log.warn('No integrations configured. Fill in at least one integration in .env.');
}

// Start each integration independently; one failing (wrong password,
// gateway unplugged) shouldn't stop the others. Retry until it works.
async function startWithRetry(integration) {
  try {
    await integration.start();
    hub.status(integration.name, true);
  } catch (e) {
    log.error(`${integration.name} failed to start:`, e.message);
    hub.status(integration.name, false, e.message);
    setTimeout(() => startWithRetry(integration), RETRY_MS);
  }
}

log.info(`home-agent ${pkg.version} starting: ${integrations.map((i) => i.name).join(', ') || 'no integrations'}`);
await hub.heartbeat();
setInterval(hub.heartbeat, HEARTBEAT_MS);

for (const integration of integrations) startWithRetry(integration);
startCommandLoop(supabase, new Map(integrations.map((i) => [i.name, i])), log.child('commands'));

function shutdown() {
  log.info('shutting down');
  for (const integration of integrations) {
    try {
      integration.stop();
    } catch {
      // already stopped
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
