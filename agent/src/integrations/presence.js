// Devices the Pi can only see on the network, like a game console: awake when
// it answers a ping, asleep when it doesn't. No control, but automations can
// react to them (e.g. "Steam machine goes to sleep → TV off").
//
// PRESENCE_DEVICES=Steam machine=192.168.1.20,Laptop=192.168.1.21
// Give each device a fixed IP in the router.

import { execFile } from 'node:child_process';

// A ping is a single tiny packet, so checking often costs the Pi next to
// nothing. One answer means awake straight away. Asleep takes 5 minutes
// without a single answer: an idle Steam machine (or its Wi-Fi saving power)
// can skip pings for a while, and "asleep" turns the TV off.
const POLL_MS = 2000;
const PING_WAIT_S = 2;
export const ASLEEP_AFTER_MS = 5 * 60 * 1000;

// Awake when it just answered; asleep once it has been silent long enough;
// otherwise keep what we had.
export function nextAwake({ answered, lastAnswerAt, now, was }) {
  if (answered) return true;
  if (now - lastAnswerAt >= ASLEEP_AFTER_MS) return false;
  return was;
}

function parseDevices(text = '') {
  return text
    .split(',')
    .map((pair) => pair.split('=').map((s) => s.trim()))
    .filter(([name, host]) => name && /^[\w.-]+$/.test(host ?? ''))
    .map(([name, host]) => ({ name, host }));
}

const ping = (host) =>
  new Promise((resolve) => {
    execFile('ping', ['-c', '1', '-W', String(PING_WAIT_S), host], { timeout: 4000 }, (error) => resolve(!error));
  });

export function createPresence(cfg, hub, log) {
  const devices = parseDevices(cfg.devices);
  // Counted from start-up too, so a restart doesn't report "asleep" early.
  const startedAt = Date.now();
  const lastAnswer = new Map();
  const awake = new Map();
  let timer = null;
  let checking = false;

  const idOf = (host) => `presence:${host.replace(/\./g, '-')}`;

  async function check(d) {
    const answered = await ping(d.host);
    if (answered) lastAnswer.set(d.host, Date.now());
    const was = awake.get(d.host);
    const now = nextAwake({ answered, lastAnswerAt: lastAnswer.get(d.host) ?? startedAt, now: Date.now(), was });
    // Not sure yet (silent, but not for long): report nothing until we are.
    if (now === undefined || was === now) return;
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
