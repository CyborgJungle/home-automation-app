// Integrations that run on the Pi. Honeywell evohome runs in Supabase instead
// (supabase/functions/evohome), since it only needs Honeywell's cloud.
export const AGENT_INTEGRATIONS = ['tradfri', 'eufy', 'brel', 'bravia', 'sonos', 'apple'];

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
  if (config.brel) {
    const { createBrel } = await import('./brel.js');
    list.push(createBrel(config.brel, hub, log.child('brel')));
  }
  if (config.sonos) {
    const { createSonos } = await import('./sonos.js');
    list.push(createSonos(config.sonos, hub, log.child('sonos')));
  }
  if (config.apple) {
    const { createApple } = await import('./apple.js');
    list.push(createApple(config.apple, hub, log.child('apple')));
  }
  if (config.bravia) {
    const { createBravia } = await import('./bravia.js');
    list.push(createBravia(config.bravia, hub, log.child('bravia')));
  }
  return list;
}
