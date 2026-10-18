// Talks to the DIRIGERA hub's local API (https://<hub>:8443/v1), verifying the
// hub against IKEA's root certificate. Plain node:https, no extra libraries.

import https from 'node:https';
import { DIRIGERA_CA } from './dirigera-ca.js';

const TIMEOUT_MS = 8000;

// The hub's certificate names the hub, not its IP address, so only the chain is checked.
export const dirigeraAgent = new https.Agent({ ca: [DIRIGERA_CA], checkServerIdentity: () => undefined, keepAlive: true });

export function dirigeraRequest(host, method, path, { token, json, form } = {}) {
  const body = json !== undefined ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port: 8443,
        method,
        path: `/v1${path}`,
        agent: dirigeraAgent,
        timeout: TIMEOUT_MS,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(body ? { 'content-length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`DIRIGERA ${method} ${path} failed (HTTP ${res.statusCode}): ${text.slice(0, 200)}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch {
            resolve(text);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('The DIRIGERA hub didn’t answer in time')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
