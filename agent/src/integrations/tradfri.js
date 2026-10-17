// IKEA TRÅDFRI gateway (the older square gateway), over the local network.
// Pair once with `npm run pair-tradfri -- <security code>` to get the identity/PSK.
//
// Note: the gateway doesn't expose motion-sensor or remote button events,
// only their battery level. They show up as devices but can't trigger anything.

import tradfri from 'node-tradfri-client';

const { TradfriClient, AccessoryTypes } = tradfri;

const KIND_BY_TYPE = {
  [AccessoryTypes.lightbulb]: 'light',
  [AccessoryTypes.plug]: 'plug',
  [AccessoryTypes.blind]: 'blind',
  [AccessoryTypes.motionSensor]: 'sensor',
  [AccessoryTypes.remote]: 'remote',
  [AccessoryTypes.slaveRemote]: 'remote',
  [AccessoryTypes.soundRemote]: 'remote',
};

function isOn(accessory) {
  if (accessory.type === AccessoryTypes.lightbulb) return Boolean(accessory.lightList[0]?.onOff);
  if (accessory.type === AccessoryTypes.plug) return Boolean(accessory.plugList[0]?.onOff);
  return false;
}

export function createTradfri(cfg, hub, log) {
  const client = new TradfriClient(cfg.host, { watchConnection: true });
  const accessories = new Map(); // instanceId -> Accessory
  const groups = new Map(); // instanceId -> Group

  function roomOf(instanceId) {
    for (const group of groups.values()) {
      if (group.deviceIDs.includes(instanceId)) return group.name;
    }
    return null;
  }

  function accessoryRow(a) {
    const kind = KIND_BY_TYPE[a.type];
    if (!kind) return null; // repeaters, air purifiers, ...

    const state = {};
    if (kind === 'light') {
      const light = a.lightList[0];
      state.on = Boolean(light.onOff);
      if (light.isDimmable) state.brightness = Math.round(light.dimmer);
      if (light.spectrum !== 'none') state.color_temp = Math.round(light.colorTemperature);
    } else if (kind === 'plug') {
      state.on = Boolean(a.plugList[0]?.onOff);
    } else if (kind === 'blind') {
      state.position = a.blindList[0]?.position;
    }
    if (kind !== 'light' && kind !== 'plug' && a.deviceInfo?.battery != null) {
      state.battery = a.deviceInfo.battery;
    }

    return {
      id: `tradfri:${a.instanceId}`,
      integration: 'tradfri',
      kind,
      name: a.name,
      room: roomOf(a.instanceId),
      online: Boolean(a.alive),
      state,
    };
  }

  function groupRow(group) {
    const members = group.deviceIDs
      .map((id) => accessories.get(id))
      .filter((a) => a && (a.type === AccessoryTypes.lightbulb || a.type === AccessoryTypes.plug));
    if (!members.length) return null;

    return {
      id: `tradfri:group:${group.instanceId}`,
      integration: 'tradfri',
      kind: 'group',
      name: group.name,
      room: group.name,
      online: members.some((a) => a.alive),
      // The gateway's own group on/off value is just the last command sent,
      // so derive it from the member lights instead.
      state: { on: members.some(isOn), lights: members.length },
    };
  }

  function pushAccessory(a) {
    const row = accessoryRow(a);
    if (row) hub.upsertDevice(row);
  }

  function pushGroupsContaining(instanceId) {
    for (const group of groups.values()) {
      if (!group.deviceIDs.includes(instanceId)) continue;
      const row = groupRow(group);
      if (row) hub.upsertDevice(row);
    }
  }

  async function start() {
    client
      .on('device updated', (a) => {
        accessories.set(a.instanceId, a);
        pushAccessory(a);
        pushGroupsContaining(a.instanceId);
      })
      .on('device removed', (id) => accessories.delete(id))
      .on('group updated', (group) => {
        if (group.name === 'SuperGroup') return; // the gateway's built-in "everything" group
        groups.set(group.instanceId, group);
        const row = groupRow(group);
        if (row) hub.upsertDevice(row);
        // Room names come from groups, so refresh the members.
        for (const id of group.deviceIDs) {
          const a = accessories.get(id);
          if (a) pushAccessory(a);
        }
      })
      .on('group removed', (id) => groups.delete(id))
      .on('error', (e) => log.warn('gateway error:', e.message))
      .on('connection lost', () => hub.status('tradfri', false, 'Lost connection to the gateway'))
      .on('connection alive', () => hub.status('tradfri', true))
      .on('give up', () => hub.status('tradfri', false, 'Gave up reconnecting to the gateway'));

    log.info(`connecting to gateway at ${cfg.host}`);
    await client.connect(cfg.identity, cfg.psk);
    await client.observeDevices();
    await client.observeGroupsAndScenes();
    log.info(`found ${accessories.size} devices and ${groups.size} groups`);
  }

  async function execute(deviceId, action, params) {
    if (action !== 'set') throw new Error(`Unknown TRÅDFRI action "${action}"`);

    const groupMatch = deviceId.match(/^tradfri:group:(\d+)$/);
    if (groupMatch) {
      const group = groups.get(Number(groupMatch[1]));
      if (!group) throw new Error('Group not found on the gateway');
      const op = {};
      if (params.on != null) op.onOff = Boolean(params.on);
      if (params.brightness != null) op.dimmer = Number(params.brightness);
      await client.operateGroup(group, op, true);
      return;
    }

    const a = accessories.get(Number(deviceId.split(':')[1]));
    if (!a) throw new Error('Device not found on the gateway');
    if (!a.alive) throw new Error('The gateway reports this device as unreachable');

    if (a.type === AccessoryTypes.lightbulb) {
      const op = {};
      if (params.on != null) op.onOff = Boolean(params.on);
      if (params.brightness != null) op.dimmer = Number(params.brightness);
      if (params.color_temp != null) op.colorTemperature = Number(params.color_temp);
      await client.operateLight(a, op, true);
    } else if (a.type === AccessoryTypes.plug) {
      await client.operatePlug(a, { onOff: Boolean(params.on) }, true);
    } else if (a.type === AccessoryTypes.blind) {
      await client.operateBlind(a, { position: Number(params.position) }, true);
    } else {
      throw new Error('This device type has no controls');
    }
  }

  function stop() {
    client.destroy();
  }

  return { name: 'tradfri', start, execute, stop };
}
