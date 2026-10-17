// Brel Home blinds, through the Brel hub on the local network. The hub speaks
// the Motionblinds UDP protocol (the one Home Assistant's Motionblinds
// integration uses), so this needs no extra libraries.
//
// Commands need the hub's 16-character key: in the Brel Home app, open "Me" and
// tap 5 times on the version number (iOS) or right of the photo (Android).

import crypto from 'node:crypto';
import dgram from 'node:dgram';

const MULTICAST = '238.0.0.18';
const PORT_SEND = 32100;
const PORT_REPORTS = 32101;
const GATEWAY_TYPE = '02000001';
const TIMEOUT_MS = 3000;
const REFRESH_MS = 5 * 60_000;

// Positions run from 0 = fully open to 100 = fully closed, like TRÅDFRI blinds.
const OPERATION = { close: 0, open: 1, stop: 2 };
const MOVING = new Set([0, 1]); // closing, opening
const UNI_DIRECTION = 0; // motors that can't report their position

// The hub expects a UTC timestamp like 20261017103412345 as message ID.
const msgID = () => new Date().toISOString().replace(/\D/g, '').slice(0, 17);

function accessToken(token, key) {
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
}

// BREL_NAMES=c4dee2dd7a6c0001=Woonkamer,c4dee2dd7a6c0002=Slaapkamer
function parseNames(text = '') {
  return Object.fromEntries(
    text
      .split(',')
      .map((pair) => pair.split('=').map((s) => s.trim()))
      .filter(([mac, name]) => mac && name),
  );
}

export function createBrel(cfg, hub, log) {
  const names = parseNames(cfg.names);
  const blinds = new Map(); // mac -> { deviceType, number, online, position, moving, battery_v, reports }
  let host = cfg.host;
  let token = null;
  let socket = null; // requests and their replies
  let reports = null; // the hub's multicast status pushes
  let waiting = null; // reply matcher for the request in flight
  let queue = Promise.resolve();
  let refreshTimer = null;

  const idOf = (mac) => `brel:${mac}`;

  function pushBlind(mac) {
    const b = blinds.get(mac);
    hub.upsertDevice({
      id: idOf(mac),
      integration: 'brel',
      kind: 'blind',
      name: names[mac] ?? `Blind ${b.number}`,
      room: null,
      online: b.online,
      state: {
        position: b.position ?? null,
        moving: Boolean(b.moving),
        reports_position: b.reports,
        battery_v: b.battery_v ?? null,
      },
    });
  }

  function applyStatus(mac, data = {}) {
    const b = blinds.get(mac);
    if (!b) return;
    b.online = true;
    if (data.wirelessMode != null) b.reports = Number(data.wirelessMode) !== UNI_DIRECTION;
    if (data.currentPosition != null && b.reports) b.position = Number(data.currentPosition);
    if (data.operation != null) b.moving = MOVING.has(Number(data.operation));
    if (Number(data.voltageMode) === 1 && Number(data.batteryLevel) > 0) {
      b.battery_v = Number(data.batteryLevel) / 100;
    }
    pushBlind(mac);
  }

  // One request at a time: the hub answers each with "<msgType>Ack".
  function send(msg, to = host) {
    const attempt = () =>
      new Promise((resolve, reject) => {
        const expect = `${msg.msgType}Ack`;
        const timer = setTimeout(() => {
          waiting = null;
          reject(new Error(`The Brel hub didn't answer (${msg.msgType})`));
        }, TIMEOUT_MS);
        waiting = (reply, from) => {
          if (reply.msgType !== expect || (msg.mac && reply.mac !== msg.mac)) return;
          clearTimeout(timer);
          waiting = null;
          resolve({ reply, from });
        };
        socket.send(JSON.stringify({ ...msg, msgID: msgID() }), PORT_SEND, to ?? MULTICAST);
      });
    // UDP can drop a packet, so try twice.
    const run = () => attempt().catch(attempt);
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  async function loadDeviceList() {
    const { reply, from } = await send({ msgType: 'GetDeviceList' });
    host ??= from.address;
    token = reply.token;
    let number = blinds.size;
    for (const { mac, deviceType } of reply.data ?? []) {
      if (deviceType === GATEWAY_TYPE || blinds.has(mac)) continue;
      blinds.set(mac, { deviceType, number: ++number, online: false, reports: true });
    }
  }

  async function deviceRequest(msgType, mac, data) {
    const b = blinds.get(mac);
    if (!b) throw new Error('Blind not found on the Brel hub');
    for (let tries = 0; ; tries++) {
      const msg = { msgType, mac, deviceType: b.deviceType, AccessToken: accessToken(token, cfg.key) };
      if (data) msg.data = data;
      const { reply } = await send(msg);
      if (reply.actionResult == null) {
        applyStatus(mac, reply.data);
        return reply;
      }
      // The token changes when the hub restarts; fetch the new one and retry once.
      if (tries === 0) {
        await loadDeviceList();
        continue;
      }
      throw new Error(`Brel hub refused the command (${reply.actionResult}). Check BREL_KEY.`);
    }
  }

  async function refresh() {
    try {
      await loadDeviceList();
      for (const mac of blinds.keys()) {
        try {
          await deviceRequest('ReadDevice', mac);
        } catch (e) {
          blinds.get(mac).online = false;
          pushBlind(mac);
          log.warn(`reading ${mac} failed:`, e.message);
        }
      }
      hub.status('brel', true);
    } catch (e) {
      log.warn('refresh failed:', e.message);
      hub.status('brel', false, e.message);
    }
  }

  async function start() {
    if (Buffer.byteLength(cfg.key ?? '') !== 16) {
      throw new Error('BREL_KEY must be the 16-character key from the Brel Home app');
    }

    socket = dgram.createSocket('udp4');
    socket.on('message', (buf, from) => {
      try {
        waiting?.(JSON.parse(buf), from);
      } catch {
        // not JSON; ignore
      }
    });
    await new Promise((resolve) => socket.bind(resolve));

    reports = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    reports.on('message', (buf) => {
      try {
        const msg = JSON.parse(buf);
        if (msg.msgType === 'Report') applyStatus(msg.mac, msg.data);
      } catch {
        // not JSON; ignore
      }
    });
    await new Promise((resolve) => reports.bind(PORT_REPORTS, resolve));
    reports.addMembership(MULTICAST);

    log.info(host ? `connecting to hub at ${host}` : 'looking for the hub');
    await loadDeviceList();
    log.info(`hub at ${host}, ${blinds.size} blind(s)`);
    for (const mac of blinds.keys()) await deviceRequest('ReadDevice', mac);
    refreshTimer = setInterval(refresh, REFRESH_MS);
  }

  async function execute(deviceId, action, params) {
    const mac = deviceId.slice('brel:'.length);
    if (action in OPERATION) {
      await deviceRequest('WriteDevice', mac, { operation: OPERATION[action] });
    } else if (action === 'set' && params.position != null) {
      const position = Math.max(0, Math.min(100, Math.round(Number(params.position))));
      await deviceRequest('WriteDevice', mac, { targetPosition: position });
    } else {
      throw new Error(`Unknown Brel action "${action}"`);
    }
  }

  function stop() {
    clearInterval(refreshTimer);
    socket?.close();
    reports?.close();
  }

  return { name: 'brel', start, execute, stop };
}
