// One-time pairing with the TRÅDFRI gateway. Saves the result to .env.
// Usage: npm run pair-tradfri -- <security code from the label under the gateway>

import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import tradfri from 'node-tradfri-client';

const ENV_FILE = '.env';

// Sets KEY=value lines in .env, replacing existing ones, so the key never has to be copied by hand.
async function saveToEnv(values) {
  let text = await fs.readFile(ENV_FILE, 'utf8').catch(() => '');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(ENV_FILE, text, { mode: 0o600 });
}

const { TradfriClient, discoverGateway } = tradfri;

let securityCode = process.argv[2];
if (!securityCode) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  securityCode = (await rl.question('Security code (on the label under the gateway): ')).trim();
  rl.close();
}
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
  await saveToEnv({ TRADFRI_HOST: host, TRADFRI_IDENTITY: identity, TRADFRI_PSK: psk });
  console.log(`\nPaired with ${host}. Saved TRADFRI_HOST, TRADFRI_IDENTITY and TRADFRI_PSK to ${ENV_FILE}.`);
} catch (e) {
  console.error('Pairing failed:', e.message, '\nCheck the security code (it is case-sensitive).');
  process.exitCode = 1;
} finally {
  client.destroy();
}
