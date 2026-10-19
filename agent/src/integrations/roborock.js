// Roborock S5 (and other miIO vacuums), over the local network. The robot
// speaks Xiaomi's miIO protocol: encrypted UDP packets on port 54321. No
// cloud and no extra libraries. It needs the robot's IP address and its
// 32-character device token (see the README).

import crypto from 'node:crypto';
import dgram from 'node:dgram';

const PORT = 54321;
const TIMEOUT_MS = 4000;
const POLL_MS = 30_000;
const POLL_ACTIVE_MS = 8_000; // while it's cleaning
const HELLO = Buffer.from('21310020ffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'hex');

// get_status "state" codes.
const STATES = {
  1: 'Starting',
  2: 'Charger disconnected',
  3: 'Idle',
  4: 'Remote control',
  5: 'Cleaning',
  6: 'Returning to dock',
  7: 'Manual mode',
  8: 'Charging',
  9: 'Charging problem',
  10: 'Paused',
  11: 'Spot cleaning',
  12: 'Error',
  13: 'Shutting down',
  14: 'Updating',
  15: 'Docking',
  16: 'Going to target',
  17: 'Zone cleaning',
  18: 'Room cleaning',
  100: 'Fully charged',
};
const CLEANING = new Set([5, 7, 11, 16, 17, 18]);
const DOCKED = new Set([8, 100]);

// Fan power ("suction") levels.
const FAN = { quiet: 101, balanced: 102, turbo: 103, max: 104 };
const FAN_NAME = Object.fromEntries(Object.entries(FAN).map(([k, v]) => [v, k]));

const md5 = (...parts) => crypto.createHash('md5').update(Buffer.concat(parts)).digest();

export function createRoborock(cfg, hub, log) {
  const token = Buffer.from(cfg.token, 'hex');
  const key = md5(token);
  const iv = md5(key, token);
  const id = `roborock:${cfg.host.replace(/\./g, '-')}`;

  let socket = null;
  let deviceId = null;
  let stampOffset = 0; // robot clock minus ours, in seconds
  // The robot remembers request IDs across restarts and ignores repeats, so
  // start somewhere new each time.
  let counter = 1000 + Math.floor(Math.random() * 90_000);
  let queue = Promise.resolve();
  let timer = null;
  let stopped = false;
  let lastState = null;

  const encrypt = (buf) => {
    const c = crypto.createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([c.update(buf), c.final()]);
  };
  const decrypt = (buf) => {
    const d = crypto.createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([d.update(buf), d.final()]);
  };

  function packet(payload) {
    const body = encrypt(payload);
    const header = Buffer.alloc(32);
    header.writeUInt16BE(0x2131, 0);
    header.writeUInt16BE(32 + body.length, 2);
    header.writeUInt32BE(deviceId, 8);
    // Its clock plus one: the robot ignores packets that aren't newer.
    header.writeUInt32BE(Math.floor(Date.now() / 1000) + stampOffset + 1, 12);
    token.copy(header, 16);
    md5(header, body).copy(header, 16);
    return Buffer.concat([header, body]);
  }

  function send(buf) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        socket.off('message', onMessage);
        fn(v);
      };
      const onMessage = (msg, rinfo) => {
        if (rinfo.address !== cfg.host) return;
        finish(resolve, msg);
      };
      const t = setTimeout(() => finish(reject, new Error('The vacuum didn’t answer in time')), TIMEOUT_MS);
      socket.on('message', onMessage);
      socket.send(buf, PORT, cfg.host, (err) => err && finish(reject, err));
    });
  }

  // Learn the robot's device ID and clock.
  async function hello() {
    const msg = await send(HELLO);
    deviceId = msg.readUInt32BE(8);
    stampOffset = msg.readUInt32BE(12) - Math.floor(Date.now() / 1000);
  }

  // One request at a time: the robot answers each by its own ID.
  function call(method, params = []) {
    const run = async () => {
      if (!deviceId) await hello();
      const idNow = counter++;
      const payload = Buffer.from(JSON.stringify({ id: idNow, method, params }));
      let reply;
      try {
        reply = await send(packet(payload));
      } catch (e) {
        deviceId = null; // start with a fresh hello next time
        throw e;
      }
      if (reply.length <= 32) throw new Error('Empty answer from the vacuum');
      const text = decrypt(reply.subarray(32)).toString('utf8').replace(/\0+$/, '');
      const json = JSON.parse(text);
      if (json.error) throw new Error(`Vacuum error: ${json.error.message ?? JSON.stringify(json.error)}`);
      return json.result;
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }

  async function refresh() {
    try {
      const [s] = await call('get_status');
      const state = Number(s.state);
      lastState = state;
      hub.upsertDevice({
        id,
        integration: 'roborock',
        kind: 'vacuum',
        name: cfg.name,
        room: null,
        online: true,
        state: {
          cleaning: CLEANING.has(state),
          docked: DOCKED.has(state),
          status: STATES[state] ?? `State ${state}`,
          battery: s.battery,
          fan: FAN_NAME[s.fan_power] ?? null,
          area_m2: s.clean_area ? Math.round(s.clean_area / 10000) / 100 : 0,
          minutes: s.clean_time ? Math.round(s.clean_time / 60) : 0,
          error: s.error_code ? Number(s.error_code) : null,
          paused: state === 10,
        },
      });
      hub.status('roborock', true);
    } catch (e) {
      log.warn('status failed:', e.message);
      hub.status('roborock', false, e.message);
      const row = { id, integration: 'roborock', kind: 'vacuum', name: cfg.name, room: null, online: false, state: {} };
      hub.upsertDevice(row);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(async () => {
      await refresh();
      schedule();
    }, CLEANING.has(lastState) ? POLL_ACTIVE_MS : POLL_MS);
  }

  async function start() {
    socket = dgram.createSocket('udp4');
    socket.on('error', (e) => log.warn('socket error:', e.message));
    await new Promise((resolve) => socket.bind(resolve));
    log.info(`connecting to the vacuum at ${cfg.host}`);
    await hello();
    await refresh();
    schedule();
  }

  async function execute(_deviceId, action, params) {
    switch (action) {
      case 'start':
        // A paused run continues; otherwise a new one starts.
        await call('app_start');
        break;
      case 'pause':
        await call('app_pause');
        break;
      case 'dock':
        await call('app_stop').catch(() => {});
        await call('app_charge');
        break;
      case 'spot':
        await call('app_spot');
        break;
      case 'find':
        await call('find_me');
        break;
      case 'fan': {
        const level = FAN[params.level];
        if (!level) throw new Error(`Unknown suction level "${params.level}"`);
        await call('set_custom_mode', [level]);
        break;
      }
      default:
        throw new Error(`Unknown vacuum action "${action}"`);
    }
    // The robot takes a moment to change state.
    setTimeout(refresh, 2000);
    setTimeout(refresh, 8000);
    lastState = action === 'start' ? 5 : lastState;
    schedule();
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  }

  return { name: 'roborock', start, execute, stop };
}
