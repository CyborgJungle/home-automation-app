// Devices the Pi can only see on the network, like a game console: awake when
// it answers a ping, asleep when it doesn't. No control, but automations can
// react to them (e.g. "Steam machine goes to sleep → TV off").
//
// PRESENCE_DEVICES=Steam machine=192.168.1.20,Laptop=192.168.1.21
// Give each device a fixed IP in the router.

import { execFile } from 'node:child_process';

// A ping is a single tiny packet, so checking often costs the Pi next to
// nothing; two misses in a row (one dropped packet isn't sleep) means a
// device is seen asleep 2–5 seconds after it really is.
const POLL_MS = 2000;
const MISSES_FOR_ASLEEP = 2;

function parseDevices(text = '') {
  return text
    .split(',')
    .map((pair) => pair.split('=').map((s) => s.trim()))
    .filter(([name, host]) => name && /^[\w.-]+$/.test(host ?? ''))
    .map(([name, host]) => ({ name, host }));
}

const ping = (host) =>
  new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', '1', host], { timeout: 3000 }, (error) => resolve(!error));
  });

export function createPresence(cfg, hub, log) {
  const devices = parseDevices(cfg.devices);
  const misses = new Map();
  const awake = new Map();
  let timer = null;
  let checking = false;

  const idOf = (host) => `presence:${host.replace(/\./g, '-')}`;

  async function check(d) {
    const answers = await ping(d.host);
    misses.set(d.host, answers ? 0 : (misses.get(d.host) ?? 0) + 1);
    const now = answers ? true : misses.get(d.host) >= MISSES_FOR_ASLEEP ? false : awake.get(d.host) ?? false;
    if (awake.get(d.host) === now) return;
    awake.set(d.host, now);
    log.info(`${d.name} is ${now ? 'awake' : 'asleep'}`);
    hub.upsertDevice({
      id: idOf(d.host),
      integration: 'presence',
      kind: 'console',
      name: d.name,
      room: null,
      online: true,
      state: { awake: now },
    });
  }

  // Never start a round while the last one is still waiting for answers.
  async function poll() {
    if (checking) return;
    checking = true;
    try {
      await Promise.all(devices.map(check));
    } finally {
      checking = false;
    }
  }

  async function start() {
    if (!devices.length) throw new Error('PRESENCE_DEVICES has no "Name=IP" entries');
    log.info(`watching ${devices.map((d) => `${d.name} (${d.host})`).join(', ')}`);
    await poll();
    timer = setInterval(() => poll().catch((e) => log.warn('check failed:', e.message)), POLL_MS);
  }

  async function execute() {
    throw new Error('This device can only be watched, not controlled');
  }

  function stop() {
    clearInterval(timer);
  }

  return { name: 'presence', start, execute, stop };
}
