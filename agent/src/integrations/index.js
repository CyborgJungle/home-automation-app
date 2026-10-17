import { createEufy } from './eufy.js';
import { createTradfri } from './tradfri.js';

// Integrations that run on the Pi. Honeywell evohome runs in Supabase instead
// (supabase/functions/evohome), since it only needs Honeywell's cloud.
export const AGENT_INTEGRATIONS = ['tradfri', 'eufy'];

// Builds the integrations that have credentials in .env.
export function createIntegrations(config, hub, log) {
  const list = [];
  if (config.tradfri) list.push(createTradfri(config.tradfri, hub, log.child('tradfri')));
  if (config.eufy) list.push(createEufy(config.eufy, hub, log.child('eufy')));
  return list;
}
