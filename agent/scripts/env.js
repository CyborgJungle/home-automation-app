// Sets KEY=value lines in .env for the pairing scripts, so keys never have to be copied by hand.
import fs from 'node:fs/promises';

export const ENV_FILE = '.env';

export async function saveToEnv(values) {
  let text = await fs.readFile(ENV_FILE, 'utf8').catch(() => '');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
  }
  await fs.writeFile(ENV_FILE, text, { mode: 0o600 });
}
