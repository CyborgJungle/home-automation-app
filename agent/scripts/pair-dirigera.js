// One-time pairing with the IKEA DIRIGERA hub. Saves the hub address and key to .env.
// Usage: npm run pair-dirigera -- <hub IP address>
// You'll be asked to press the action button on the bottom of the hub.

import crypto from 'node:crypto';
import os from 'node:os';
import readline from 'node:readline/promises';
import { dirigeraRequest } from '../src/integrations/dirigera-api.js';
import { ENV_FILE, saveToEnv } from './env.js';

const host = process.argv[2] || process.env.DIRIGERA_HOST;
if (!host) {
  console.error('Usage: npm run pair-dirigera -- <hub IP address>');
  process.exit(1);
}

// PKCE: a random verifier, and its SHA-256 as the challenge.
async function requestCode() {
  const verifier = crypto.randomBytes(64).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const { code } = await dirigeraRequest(
    host,
    'GET',
    `/oauth/authorize?${new URLSearchParams({
      audience: 'homesmart.local',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`,
  );
  return { code, verifier };
}

// The hub only accepts the code for about a minute after asking, and only once
// its button was pressed, so ask for a fresh one each try.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let token;
for (let attempt = 1; !token; attempt++) {
  await rl.question('Press Enter to start (then you have 60 seconds)… ');
  const { code, verifier } = await requestCode();
  await rl.question('Now press the action button on the bottom of the DIRIGERA hub, then press Enter here… ');
  try {
    ({ access_token: token } = await dirigeraRequest(host, 'POST', '/oauth/token', {
      form: { code, name: `home-agent (${os.hostname()})`, grant_type: 'authorization_code', code_verifier: verifier },
    }));
  } catch (e) {
    if (attempt >= 5) throw e;
    console.log(`The hub said no (${e.message.replace(/^DIRIGERA /, '')}). Let's try again.\n`);
  }
}
rl.close();

await saveToEnv({ DIRIGERA_HOST: host, DIRIGERA_TOKEN: token });
console.log(`\nPaired with the hub at ${host}. Saved DIRIGERA_HOST and DIRIGERA_TOKEN to ${ENV_FILE}.`);
