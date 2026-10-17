// Run with: node --experimental-strip-types --test supabase/functions/evohome/honeywell.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { commandRequest, formatUntil, statusToDevices } from "./honeywell.ts";

test("formatUntil drops milliseconds", () => {
  assert.equal(formatUntil(new Date("2026-10-17T12:34:56.789Z")), "2026-10-17T12:34:56Z");
});

test("statusToDevices maps the system and its zones", () => {
  const status = {
    gateways: [
      {
        temperatureControlSystems: [
          {
            systemId: "3",
            systemModeStatus: { mode: "Auto", isPermanent: true },
            activeFaults: [],
            zones: [
              {
                zoneId: "10",
                name: "Living room",
                temperatureStatus: { temperature: 20.5, isAvailable: true },
                setpointStatus: { targetHeatTemperature: 21, setpointMode: "FollowSchedule" },
                activeFaults: [],
              },
              {
                zoneId: "11",
                name: "Bedroom",
                temperatureStatus: { isAvailable: false },
                setpointStatus: {
                  targetHeatTemperature: 18,
                  setpointMode: "TemporaryOverride",
                  until: "2026-10-17T20:00:00Z",
                },
                activeFaults: [{ faultType: "TempZoneActuatorLowBattery" }],
              },
            ],
          },
        ],
      },
    ],
  };

  const location = {
    id: "1",
    name: "Home",
    zones: {
      "10": { zoneType: "UnderfloorHeating", modelType: "HeatingZone" },
      "11": { zoneType: "RadiatorZone", modelType: "HeatingZone" },
    },
    systemType: "EvoTouch",
    hotWater: false,
  };
  const rows = statusToDevices("Home", status, location);

  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.name, r.online]),
    [
      ["evohome:system:3", "heating", "Home", true],
      ["evohome:zone:10", "zone", "Living room", true],
      ["evohome:zone:11", "zone", "Bedroom", false],
    ],
  );
  assert.deepEqual(rows[1].state, {
    temperature: 20.5,
    setpoint: 21,
    mode: "FollowSchedule",
    until: null,
    faults: 0,
    fault_types: [],
    zone_type: "UnderfloorHeating",
    model_type: "HeatingZone",
  });
  assert.equal(rows[0].state.system_type, "EvoTouch");
  assert.equal(rows[2].state.temperature, null);
  assert.equal(rows[2].state.faults, 1);
  assert.deepEqual(rows[2].state.fault_types, ["TempZoneActuatorLowBattery"]);
  assert.equal(rows[2].state.zone_type, "RadiatorZone");
});

test("commandRequest builds a temporary override", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");
  assert.deepEqual(commandRequest("evohome:zone:10", "set_temperature", { setpoint: 22, minutes: 30 }, now), {
    path: "temperatureZone/10/heatSetpoint",
    body: { SetpointMode: "TemporaryOverride", HeatSetpointValue: 22, TimeUntil: "2026-10-17T12:30:00Z" },
  });
});

test("commandRequest builds follow-schedule and system mode", () => {
  assert.deepEqual(commandRequest("evohome:zone:10", "follow_schedule", {}).body, {
    SetpointMode: "FollowSchedule",
    HeatSetpointValue: 0,
    TimeUntil: null,
  });
  assert.deepEqual(commandRequest("evohome:system:3", "set_mode", { mode: "AutoWithEco" }), {
    path: "temperatureControlSystem/3/mode",
    body: { SystemMode: "AutoWithEco", TimeUntil: null, Permanent: true },
  });
});

test("commandRequest rejects silly setpoints and unknown actions", () => {
  assert.throws(() => commandRequest("evohome:zone:10", "set_temperature", { setpoint: 90 }));
  assert.throws(() => commandRequest("evohome:zone:10", "explode", {}));
});
