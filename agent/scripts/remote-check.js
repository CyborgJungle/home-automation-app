// Read-only DIRIGERA remote diagnostics. Prints no access tokens and sends no
// device commands. Run on the Pi: npm run remote-check -- "Remote Round"
import WebSocket from 'ws';
import { config } from '../src/config.js';
import { DIRIGERA_CA } from '../src/integrations/dirigera-ca.js';
import { dirigeraRequest } from '../src/integrations/dirigera-api.js';

async function main() {
  const cfg = config.dirigera;
  if (!cfg) throw new Error('DIRIGERA is not configured in this Pi’s .env.');
  const wanted = process.argv.slice(2).join(' ').trim().toLowerCase();
  if (!wanted) throw new Error('Usage: npm run remote-check -- "Remote Round"');
  const all = await dirigeraRequest(cfg.host, 'GET', '/devices', { token: cfg.token });
  const matches = all.filter(device => /Controller$/.test(device.deviceType ?? '') &&
    (device.attributes?.customName ?? '').toLowerCase() === wanted);
  const roots = [...new Set(matches.map(device => device.id.replace(/_[0-9]+$/, '')))];
  if (roots.length !== 1) throw new Error('Use the exact remote name shown in the IKEA app; one matching remote is needed.');
  for (const device of all.filter(device => device.id.replace(/_[0-9]+$/, '') === roots[0])) {
    console.log(JSON.stringify({ id: device.id, deviceType: device.deviceType, isHidden: device.isHidden,
      model: device.attributes?.model, productCode: device.attributes?.productCode,
      switchLabel: device.attributes?.switchLabel, capabilities: device.capabilities }));
  }
  const ws = new WebSocket(`wss://${cfg.host}:8443/v1`, {
    headers: { authorization: `Bearer ${cfg.token}` }, ca: [DIRIGERA_CA], checkServerIdentity: () => undefined,
  });
  const timer = setTimeout(() => ws.close(), 60_000);
  ws.on('open', () => console.log('Listening for 60 seconds. Press each button, then try holding and double-pressing.'));
  ws.on('message', buffer => {
    try {
      const event = JSON.parse(buffer);
      if (event.type === 'remotePressEvent' && typeof event.data?.id === 'string' &&
          event.data.id.replace(/_[0-9]+$/, '') === roots[0]) console.log(JSON.stringify(event));
    } catch { /* Ignore non-JSON keepalives. */ }
  });
  ws.on('error', () => { console.error('Could not listen to the DIRIGERA hub.'); process.exitCode = 1; ws.close(); });
  ws.on('close', () => clearTimeout(timer));
}
main().catch(error => { console.error(error.cause ? 'Could not reach DIRIGERA from this Pi.' : error.message); process.exitCode = 1; });
