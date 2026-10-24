// Devices the Pi can only see on the network, like a game console: awake when
// it answers a ping, asleep when it doesn't. No control, but automations can
// react to them (e.g. "Steam machine goes to sleep → TV off").
//
// PRESENCE_DEVICES=Steam machine=192.168.1.20,Laptop=192.168.1.21
// Give each device a fixed IP in the router.

import { execFile } from 'node:child_process';

// A ping is a single tiny packet, so checking often costs the Pi next to
// nothing. Single pings aren't trusted either way: an idle Steam machine (or
// its Wi-Fi saving power) skips some, and a sleeping one still answers one now
// and then. So it's the share of answers that counts:
//   awake:  at least 3 answers in the last 10 seconds (seen within seconds)
//   asleep: at most 1 in 10 answered over the last 2 minutes
// "Asleep" turns the TV off, so it waits for the full 2 minutes of pings.
const POLL_MS = 2000;
const PING_WAIT_S = 2;
export const AWAKE_WINDOW_MS = 10 * 1000;
export const AWAKE_ANSWERS = 3;
export const ASLEEP_WINDOW_MS = 2 * 60 * 1000;
export const ASLEEP_SHARE = 0.1;

// history: [{ at, answered }] oldest first, at least the last 2 minutes.
// Returns true/false, or `was` while it isn't clear yet (undefined at start).
export function nextAwake({ history, now, was, since }) {
  const answers = (ms) => history.filter((h) => h.at > now - ms && h.answered).length;
  if (answers(AWAKE_WINDOW_MS) >= AWAKE_ANSWERS) return true;
  const recent = history.filter((h) => h.at > now - ASLEEP_WINDOW_MS);
  // Only once there are 2 minutes of pings to go on (also after a restart).
  if (now - since >= ASLEEP_WINDOW_MS && recent.length && answers(ASLEEP_WINDOW_MS) <= recent.length * ASLEEP_SHARE) return false;
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
  const startedAt = Date.now();
  const history = new Map();
  const awake = new Map();
  let timer = null;
  let checking = false;

  const idOf = (host) => `presence:${host.replace(/\./g, '-')}`;

  async function check(d) {
    const answered = await ping(d.host);
    const at = Date.now();
    const seen = (history.get(d.host) ?? []).filter((h) => h.at > at - ASLEEP_WINDOW_MS);
    seen.push({ at, answered });
    history.set(d.host, seen);
    const was = awake.get(d.host);
    const now = nextAwake({ history: seen, now: at, was, since: startedAt });
    // Not sure yet (just started): report nothing until we are.
    if (now === undefined || was === now) return;
    awake.set(d.host, now);
    const share = `${seen.filter((h) => h.answered).length} of ${seen.length} pings answered in the last 2 min`;
    log.info(`${d.name} is ${now ? 'awake' : 'asleep'} (${share})`);
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
