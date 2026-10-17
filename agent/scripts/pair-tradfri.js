// One-time pairing with the TRÅDFRI gateway.
// Usage: npm run pair-tradfri -- <security code from the label under the gateway>

import tradfri from 'node-tradfri-client';

const { TradfriClient, discoverGateway } = tradfri;

const securityCode = process.argv[2];
if (!securityCode) {
  console.error('Usage: npm run pair-tradfri -- <security code from the label under the gateway>');
  process.exit(1);
}

let host = process.env.TRADFRI_HOST;
if (!host) {
  console.log('Looking for the gateway on your network...');
  const found = await discoverGateway();
  if (!found) {
    console.error('No gateway found. Set TRADFRI_HOST=<gateway IP> in .env (see your router) and try again.');
    process.exit(1);
  }
  host = found.addresses.find((a) => a.includes('.')) ?? found.addresses[0] ?? found.host;
  console.log(`Found ${found.name} at ${host}`);
}

const client = new TradfriClient(host);
try {
  const { identity, psk } = await client.authenticate(securityCode);
  console.log('\nPaired. Add these lines to agent/.env:\n');
  console.log(`TRADFRI_HOST=${host}`);
  console.log(`TRADFRI_IDENTITY=${identity}`);
  console.log(`TRADFRI_PSK=${psk}`);
} catch (e) {
  console.error('Pairing failed:', e.message, '\nCheck the security code (it is case-sensitive).');
  process.exitCode = 1;
} finally {
  client.destroy();
}
