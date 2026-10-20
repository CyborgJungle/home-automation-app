import os from 'node:os';
import path from 'node:path';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR || 'data');

// Each integration is enabled only when its credentials are present in .env,
// so you can bring devices online one at a time.
export const config = {
  supabaseUrl: env.SUPABASE_URL,
  supabaseSecretKey: env.SUPABASE_SECRET_KEY,
  dataDir,

  // IKEA DIRIGERA hub: run `npm run pair-dirigera -- <hub IP>`.
  dirigera: env.DIRIGERA_HOST && env.DIRIGERA_TOKEN
    ? {
        host: env.DIRIGERA_HOST,
        token: env.DIRIGERA_TOKEN,
      }
    : null,

  // The older IKEA TRÅDFRI gateway (replaced by DIRIGERA).
  tradfri: env.TRADFRI_HOST
    ? {
        host: env.TRADFRI_HOST,
        identity: env.TRADFRI_IDENTITY,
        psk: env.TRADFRI_PSK,
      }
    : null,

  eufy: env.EUFY_USERNAME
    ? {
        username: env.EUFY_USERNAME,
        password: env.EUFY_PASSWORD,
        country: env.EUFY_COUNTRY || undefined,
        verifyCode: env.EUFY_VERIFY_CODE || undefined,
        captchaId: env.EUFY_CAPTCHA_ID || undefined,
        captchaCode: env.EUFY_CAPTCHA_CODE || undefined,
        dataDir: path.join(dataDir, 'eufy'),
      }
    : null,

  brel: env.BREL_KEY
    ? {
        key: env.BREL_KEY,
        host: env.BREL_HOST || undefined, // found automatically when empty
        names: env.BREL_NAMES,
      }
    : null,

  // No key needed: speakers are found on the network. SONOS_HOST is optional,
  // a speaker to ask first.
  sonos: env.SONOS === 'on' || env.SONOS_HOST
    ? {
        host: env.SONOS_HOST || undefined,
      }
    : null,

  // Apple TV / HomePod via pyatv (installed in ~/.local/pyatv, see README).
  // APPLE_DEVICES limits it to those names; APPLE=on takes every one found.
  apple: env.APPLE === 'on' || env.APPLE_DEVICES
    ? {
        names: env.APPLE_DEVICES || '',
        python: env.APPLE_PYTHON || path.join(os.homedir(), '.local/pyatv/bin/python'),
      }
    : null,

  // Roborock vacuum: its IP address and 32-character device token (see README).
  roborock: env.ROBOROCK_HOST && /^[0-9a-f]{32}$/i.test(env.ROBOROCK_TOKEN ?? '')
    ? {
        host: env.ROBOROCK_HOST,
        token: env.ROBOROCK_TOKEN,
        name: env.ROBOROCK_NAME || 'Roborock',
      }
    : null,

  ikeadisplay: env.IKEA_DISPLAY_HOST
    ? {
        host: env.IKEA_DISPLAY_HOST,
        name: env.IKEA_DISPLAY_NAME || 'IKEA display',
        room: env.IKEA_DISPLAY_ROOM || null,
        stateFile: path.join(dataDir, 'ikea-display.json'),
      }
    : null,

  bravia: env.BRAVIA_HOST && env.BRAVIA_PSK
    ? {
        host: env.BRAVIA_HOST,
        psk: env.BRAVIA_PSK,
      }
    : null,
};
