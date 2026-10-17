import { createEufy } from './eufy.js';
import { createEvohome } from './evohome.js';
import { createTradfri } from './tradfri.js';

// Builds the integrations that have credentials in .env.
export function createIntegrations(config, hub, log) {
  const list = [];
  if (config.tradfri) list.push(createTradfri(config.tradfri, hub, log.child('tradfri')));
  if (config.evohome) list.push(createEvohome(config.evohome, hub, log.child('evohome')));
  if (config.eufy) list.push(createEufy(config.eufy, hub, log.child('eufy')));
  return list;
}
