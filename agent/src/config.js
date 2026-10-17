import path from 'node:path';

const env = process.env;
const dataDir = path.resolve(env.DATA_DIR || 'data');

// Each integration is enabled only when its credentials are present in .env,
// so you can bring devices online one at a time.
export const config = {
  supabaseUrl: env.SUPABASE_URL,
  supabaseSecretKey: env.SUPABASE_SECRET_KEY,
  dataDir,

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

  bravia: env.BRAVIA_HOST
    ? {
        host: env.BRAVIA_HOST,
        psk: env.BRAVIA_PSK,
      }
    : null,
};
