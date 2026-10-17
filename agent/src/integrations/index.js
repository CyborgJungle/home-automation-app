// Integrations that run on the Pi. Honeywell evohome runs in Supabase instead
// (supabase/functions/evohome), since it only needs Honeywell's cloud.
export const AGENT_INTEGRATIONS = ['tradfri', 'eufy'];

// Builds the integrations that have credentials in .env. Each one is imported
// only when configured: the Eufy library is large, and a Pi 2 shouldn't load
// it (or even install it) until the doorbell is set up.
export async function createIntegrations(config, hub, log) {
  const list = [];
  if (config.tradfri) {
    const { createTradfri } = await import('./tradfri.js');
    list.push(createTradfri(config.tradfri, hub, log.child('tradfri')));
  }
  if (config.eufy) {
    const { createEufy } = await import('./eufy.js');
    list.push(createEufy(config.eufy, hub, log.child('eufy')));
  }
  return list;
}
