import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatUntil, statusToDevices } from '../src/integrations/evohome.js';

test('formatUntil drops milliseconds', () => {
  assert.equal(formatUntil(new Date('2026-10-17T12:34:56.789Z')), '2026-10-17T12:34:56Z');
});

test('statusToDevices maps the system and its zones', () => {
  const status = {
    locationId: '1',
    gateways: [
      {
        gatewayId: '2',
        temperatureControlSystems: [
          {
            systemId: '3',
            systemModeStatus: { mode: 'Auto', isPermanent: true },
            activeFaults: [],
            zones: [
              {
                zoneId: '10',
                name: 'Living room',
                temperatureStatus: { temperature: 20.5, isAvailable: true },
                setpointStatus: { targetHeatTemperature: 21, setpointMode: 'FollowSchedule' },
                activeFaults: [],
              },
              {
                zoneId: '11',
                name: 'Bedroom',
                temperatureStatus: { isAvailable: false },
                setpointStatus: {
                  targetHeatTemperature: 18,
                  setpointMode: 'TemporaryOverride',
                  until: '2026-10-17T20:00:00Z',
                },
                activeFaults: [{ faultType: 'TempZoneActuatorLowBattery' }],
              },
            ],
          },
        ],
      },
    ],
  };

  const rows = statusToDevices('Home', status);

  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.name, r.online]),
    [
      ['evohome:system:3', 'heating', 'Home', true],
      ['evohome:zone:10', 'zone', 'Living room', true],
      ['evohome:zone:11', 'zone', 'Bedroom', false],
    ],
  );
  assert.deepEqual(rows[1].state, {
    temperature: 20.5,
    setpoint: 21,
    mode: 'FollowSchedule',
    until: null,
    faults: 0,
  });
  assert.equal(rows[2].state.temperature, null);
  assert.equal(rows[2].state.until, '2026-10-17T20:00:00Z');
  assert.equal(rows[2].state.faults, 1);
});
