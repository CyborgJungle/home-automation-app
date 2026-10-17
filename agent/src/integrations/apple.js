// Apple TV and HomePod, through pyatv (the library Home Assistant uses).
// pyatv is Python, so it runs as a small helper process (apple/bridge.py)
// that this module starts, talks JSON lines with, and restarts if it stops.
// Pair once with apple/pair.py; see the README.

import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const BRIDGE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../apple/bridge.py');
const RESTART_MS = 15_000;
const COMMAND_TIMEOUT_MS = 15_000;

export function createApple(cfg, hub, log) {
  let child = null;
  let stopped = false;
  let nextReq = 1;
  const waiting = new Map(); // req -> { resolve, reject, timer }

  const idOf = (id) => `apple:${id}`;

  function onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log.info(line);
      return;
    }
    if (msg.type === 'log') {
      (msg.level === 'warn' ? log.warn : log.info)(msg.msg);
    } else if (msg.type === 'device') {
      hub.upsertDevice({
        id: idOf(msg.id),
        integration: 'apple',
        kind: msg.kind,
        name: msg.name,
        room: msg.name, // Apple names devices after their room
        online: msg.online,
        state: msg.state,
      });
    } else if (msg.type === 'result') {
      const w = waiting.get(msg.req);
      if (!w) return;
      waiting.delete(msg.req);
      clearTimeout(w.timer);
      if (msg.ok) w.resolve();
      else w.reject(new Error(msg.error));
    }
  }

  function launch() {
    child = spawn(cfg.python, [BRIDGE, cfg.names ?? ''], { stdio: ['pipe', 'pipe', 'pipe'] });
    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', (line) => log.warn(line));
    child.on('spawn', () => hub.status('apple', true));
    child.on('error', (e) => log.error('could not start the bridge:', e.message));
    child.on('exit', (code) => {
      child = null;
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.reject(new Error('The Apple bridge stopped'));
      }
      waiting.clear();
      if (stopped) return;
      hub.status('apple', false, 'Apple bridge stopped; restarting');
      log.warn(`bridge exited (${code}); restarting in ${RESTART_MS / 1000} s`);
      setTimeout(launch, RESTART_MS);
    });
  }

  async function start() {
    log.info(`starting bridge${cfg.names ? ` for ${cfg.names}` : ''}`);
    launch();
  }

  function execute(deviceId, action, params) {
    if (!child) throw new Error('The Apple bridge is not running');
    return new Promise((resolve, reject) => {
      const req = nextReq++;
      const timer = setTimeout(() => {
        waiting.delete(req);
        reject(new Error('The Apple device didn’t respond in time'));
      }, COMMAND_TIMEOUT_MS);
      waiting.set(req, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ req, device: deviceId.slice('apple:'.length), action, params })}\n`);
    });
  }

  function stop() {
    stopped = true;
    child?.kill();
  }

  return { name: 'apple', start, execute, stop };
}
