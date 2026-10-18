// IKEA DIRIGERA hub, over its local API: lamps, plugs, blinds, motion sensors
// and remotes. A websocket pushes every change the moment it happens, so motion
// and button presses can start automations. Pair once with
// `npm run pair-dirigera -- <hub IP>`.
//
// Each room with lamps also becomes a "group" device (dirigera:room:<id>),
// switched by sending the command to every lamp in it.

import WebSocket from 'ws';
import { DIRIGERA_CA } from './dirigera-ca.js';
import { dirigeraRequest } from './dirigera-api.js';

const RESYNC_MS = 10 * 60_000; // full refresh in case an event was missed
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
const BUTTON_DEDUPE_MS = 400;

const KIND_BY_TYPE = {
  light: 'light',
  outlet: 'plug',
  blinds: 'blind',
  motionSensor: 'sensor',
  occupancySensor: 'sensor',
  lightController: 'remote',
  shortcutController: 'remote',
  blindsController: 'remote',
  soundController: 'remote',
};

export function createDirigera(cfg, hub, log) {
  const devices = new Map(); // DIRIGERA id -> device JSON (attributes merged from events)
  let ws = null;
  let stopped = false;
  let reconnectMs = RECONNECT_MIN_MS;
  let resyncTimer = null;
  let pingTimer = null;
  const lastPress = new Map();

  const api = (method, path, json) => dirigeraRequest(cfg.host, method, path, { token: cfg.token, json });
  const idOf = (d) => `dirigera:${d.id}`;
  const roomId = (id) => `dirigera:room:${id}`;
  const nameOf = (d) => d.attributes?.customName || d.attributes?.model || 'IKEA device';

  function deviceRow(d) {
    const kind = KIND_BY_TYPE[d.deviceType];
    if (!kind || d.isHidden) return null;
    const a = d.attributes ?? {};
    const state = {};
    if (kind === 'light') {
      state.on = Boolean(a.isOn);
      if (a.lightLevel != null) state.brightness = a.lightLevel;
      if (a.colorTemperature != null) state.color_temp = a.colorTemperature;
    } else if (kind === 'plug') {
      state.on = Boolean(a.isOn);
    } else if (kind === 'blind') {
      state.position = a.blindsCurrentLevel ?? null; // 0 = open, 100 = closed
    } else if (kind === 'sensor') {
      state.motion = Boolean(a.isDetected);
      if (a.batteryPercentage != null) state.battery = a.batteryPercentage;
    } else if (kind === 'remote') {
      if (a.batteryPercentage != null) state.battery = a.batteryPercentage;
      const press = lastPress.get(d.id);
      if (press) Object.assign(state, press);
    }
    return {
      id: idOf(d),
      integration: 'dirigera',
      kind,
      name: nameOf(d),
      room: d.room?.name ?? null,
      online: d.isReachable !== false,
      state,
    };
  }

  // A room's lamps as one device, named after the room.
  function roomRows() {
    const rooms = new Map();
    for (const d of devices.values()) {
      if (d.deviceType !== 'light' || !d.room || d.isHidden) continue;
      if (!rooms.has(d.room.id)) rooms.set(d.room.id, { room: d.room, lights: [] });
      rooms.get(d.room.id).lights.push(d);
    }
    return [...rooms.values()].map(({ room, lights }) => {
      const lit = lights.filter((l) => l.isReachable !== false && l.attributes?.isOn);
      return {
        id: roomId(room.id),
        integration: 'dirigera',
        kind: 'group',
        name: room.name,
        room: room.name,
        online: lights.some((l) => l.isReachable !== false),
        state: {
          on: lit.length > 0,
          lights: lights.length,
          ...(lit.length ? { brightness: Math.max(...lit.map((l) => l.attributes?.lightLevel ?? 0)) } : {}),
        },
      };
    });
  }

  function publish(d) {
    const row = deviceRow(d);
    if (row) hub.upsertDevice(row);
    if (d.deviceType === 'light') for (const r of roomRows()) hub.upsertDevice(r);
  }

  async function resync() {
    const list = await api('GET', '/devices');
    devices.clear();
    for (const d of list) devices.set(d.id, d);
    for (const d of devices.values()) {
      const row = deviceRow(d);
      if (row) hub.upsertDevice(row);
    }
    for (const r of roomRows()) hub.upsertDevice(r);
    return list.length;
  }

  function onEvent(event) {
    const data = event.data ?? {};
    if (event.type === 'deviceStateChanged') {
      const d = devices.get(data.id);
      if (!d) return;
      if (data.attributes) d.attributes = { ...d.attributes, ...data.attributes };
      if (data.isReachable != null) d.isReachable = data.isReachable;
      if (data.room) d.room = data.room;
      publish(d);
    } else if (event.type === 'remotePressEvent') {
      const now = Date.now();
      if (now - (lastPress.get(data.id)?.at ?? 0) < BUTTON_DEDUPE_MS) return;
      const pattern = data.clickPattern ?? 'singlePress';
      const at = new Date(now).toISOString();
      lastPress.set(data.id, { last_press: pattern, last_press_at: at, at: now });
      const d = devices.get(data.id);
      hub.event('button.press', `dirigera:${data.id}`, { pattern, name: d ? nameOf(d) : null });
      if (d) publish(d);
    } else if (/^(device(Added|Removed|ConfigurationChanged)|room(Created|Updated|Deleted))$/.test(event.type)) {
      resync().catch((e) => log.warn('resync failed:', e.message));
    }
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocket(`wss://${cfg.host}:8443/v1`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      ca: [DIRIGERA_CA],
      checkServerIdentity: () => undefined,
    });
    ws.on('open', () => {
      log.info('listening for changes');
      reconnectMs = RECONNECT_MIN_MS;
      hub.status('dirigera', true);
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.ping(), 30_000);
      // Catch up on anything that changed while we were disconnected.
      resync().catch((e) => log.warn('resync failed:', e.message));
    });
    ws.on('message', (buf) => {
      try {
        onEvent(JSON.parse(buf));
      } catch (e) {
        log.warn('bad event:', e.message);
      }
    });
    ws.on('error', (e) => log.warn('websocket error:', e.message));
    ws.on('close', () => {
      clearInterval(pingTimer);
      if (stopped) return;
      hub.status('dirigera', false, 'Lost connection to the DIRIGERA hub; reconnecting');
      setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
    });
  }

  async function start() {
    log.info(`connecting to hub at ${cfg.host}`);
    const count = await resync();
    log.info(`found ${count} devices`);
    connect();
    resyncTimer = setInterval(() => resync().catch((e) => log.warn('resync failed:', e.message)), RESYNC_MS);
  }

  function attributesFor(action, params) {
    if (action !== 'set') throw new Error(`Unknown DIRIGERA action "${action}"`);
    const a = {};
    if (params.on != null) a.isOn = Boolean(params.on);
    if (params.brightness != null) a.lightLevel = Math.max(1, Math.min(100, Math.round(Number(params.brightness))));
    if (params.color_temp != null) a.colorTemperature = Math.round(Number(params.color_temp));
    if (params.position != null) a.blindsTargetLevel = Math.max(0, Math.min(100, Math.round(Number(params.position))));
    if (!Object.keys(a).length) throw new Error('Nothing to change');
    return a;
  }

  async function patch(d, attributes) {
    // Brightness only applies to a lamp that's on, so switch it on first.
    if (attributes.lightLevel != null && attributes.isOn) {
      await api('PATCH', `/devices/${d.id}`, [{ attributes: { isOn: true } }]);
      const { isOn, ...rest } = attributes;
      void isOn;
      attributes = rest;
    }
    await api('PATCH', `/devices/${d.id}`, [{ attributes }]);
  }

  async function execute(deviceId, action, params) {
    const attributes = attributesFor(action, params);
    const room = deviceId.match(/^dirigera:room:(.+)$/);
    if (room) {
      const lights = [...devices.values()].filter((d) => d.deviceType === 'light' && d.room?.id === room[1] && d.isReachable !== false);
      if (!lights.length) throw new Error('No reachable lamps in that room');
      const results = await Promise.allSettled(lights.map((d) => patch(d, attributes)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === lights.length) throw failed[0].reason;
      return;
    }
    const d = devices.get(deviceId.slice('dirigera:'.length));
    if (!d) throw new Error('Device not found on the DIRIGERA hub');
    if (d.isReachable === false) throw new Error('The hub reports this device as unreachable');
    await patch(d, attributes);
  }

  function stop() {
    stopped = true;
    clearInterval(resyncTimer);
    clearInterval(pingTimer);
    ws?.close();
  }

  return { name: 'dirigera', start, execute, stop };
}
