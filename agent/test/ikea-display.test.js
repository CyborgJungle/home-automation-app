import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIkeaDisplay } from '../src/integrations/ikea-display.js';
import { AGENT_INTEGRATIONS, createIntegrations } from '../src/integrations/index.js';

const ID = 'ikeadisplay:screen';
const logger = { info() {}, warn() {}, child() { return this; } };

function fixture(t, { brightness = 128, stateFile, schedule = false } = {}) {
  const rows = new Map();
  const health = new Map();
  const writes = [];
  const device = { brightness, baseBrightness: brightness, brightnessSchedule: { enabled: schedule } };
  let httpError = false;
  let confirmed = true;
  const hub = {
    devices: rows,
    async upsertDevice(row) { rows.set(row.id, structuredClone(row)); },
    async status(name, ok, error) { health.set(name, { ok, error }); },
  };
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, 'http://display.local');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (httpError) return new Response('', { status: 503 });
    if (options.method === 'PATCH') {
      assert.equal(url.pathname, '/api/brightness');
      const value = Number(url.searchParams.get('value'));
      writes.push(value);
      if (confirmed) device.baseBrightness = device.brightness = value;
      return Response.json({ status: 'success' });
    }
    assert.equal(url.pathname, '/api/info');
    return Response.json(device);
  };
  const adapter = createIkeaDisplay({ host: 'display.local', stateFile }, hub, logger, { fetchImpl });
  t.after(() => adapter.stop());
  return { adapter, rows, health, writes, device, fail: (value) => { httpError = value; }, unconfirmed: () => { confirmed = false; } };
}

test('configured registry routes the display integration without enabling it by default', async () => {
  assert.ok(AGENT_INTEGRATIONS.includes('ikeadisplay'));
  assert.deepEqual(await createIntegrations({}, {}, logger), []);
  const list = await createIntegrations({ ikeadisplay: { host: 'display.local' } }, {}, logger);
  assert.equal(list[0].name, 'ikeadisplay');
});

test('publishes a normal light and scales actual brightness', async (t) => {
  const f = fixture(t);
  await f.adapter.start();
  assert.equal(f.rows.get(ID).kind, 'light');
  assert.equal(f.rows.get(ID).integration, 'ikeadisplay');
  assert.equal(f.rows.get(ID).state.brightness, 50);
  assert.equal(f.rows.get(ID).state.on, true);
  assert.deepEqual(f.writes, []); // discovery/start never changes the display
});

test('Off blanks LEDs and On restores brightness, including after a restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ikea-display-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'display.json');
  const first = fixture(t, { brightness: 64, stateFile });
  await first.adapter.start();
  await first.adapter.execute(ID, 'set', { on: false });
  assert.equal(first.rows.get(ID).state.on, false);
  first.adapter.stop();
  const next = fixture(t, { brightness: 0, stateFile });
  await next.adapter.start();
  await next.adapter.execute(ID, 'set', { on: true });
  assert.deepEqual(next.writes, [64]);
  assert.equal(next.rows.get(ID).state.on, true);
});

test('scales percentage commands and serializes rapid Off/On', async (t) => {
  const f = fixture(t);
  await f.adapter.start();
  await f.adapter.execute(ID, 'set', { on: true, brightness: 25 });
  await Promise.all([
    f.adapter.execute(ID, 'set', { on: false }),
    f.adapter.execute(ID, 'set', { on: true }),
  ]);
  assert.deepEqual(f.writes, [64, 0, 64]);
});

test('an initially dark display without history defaults to full brightness', async (t) => {
  const f = fixture(t, { brightness: 0 });
  await f.adapter.start();
  await f.adapter.execute(ID, 'set', { on: true });
  assert.deepEqual(f.writes, [255]);
});

test('rejects commands overridden by the firmware brightness schedule without changing it', async (t) => {
  const f = fixture(t, { schedule: true });
  await f.adapter.start();
  await assert.rejects(f.adapter.execute(ID, 'set', { on: false }), /Disable Scheduled brightness/);
  assert.equal(f.rows.get(ID).state.brightnessScheduleEnabled, true);
  assert.equal(f.device.brightnessSchedule.enabled, true);
  assert.deepEqual(f.writes, []);
});

test('HTTP failures mark a known device offline and later commands recover', async (t) => {
  const f = fixture(t);
  await f.adapter.start();
  f.fail(true);
  await assert.rejects(f.adapter.execute(ID, 'set', { on: false }), /HTTP 503/);
  assert.equal(f.rows.get(ID).online, false);
  assert.equal(f.health.get('ikeadisplay').ok, false);
  f.fail(false);
  await f.adapter.execute(ID, 'set', { on: false });
  assert.equal(f.rows.get(ID).online, true);
  assert.equal(f.health.get('ikeadisplay').ok, true);
});

test('does not report success when the device ignores the write', async (t) => {
  const f = fixture(t);
  await f.adapter.start();
  f.unconfirmed();
  await assert.rejects(f.adapter.execute(ID, 'set', { on: false }), /did not confirm/);
});

test('rejects invalid actions, device IDs, colors and values before any write', async (t) => {
  const f = fixture(t);
  for (const params of [{}, { on: 'false' }, { brightness: NaN }, { brightness: 101 }, { brightness: -1 }, { hue: 20 }]) {
    await assert.rejects(f.adapter.execute(ID, 'set', params), /needs on/);
  }
  await assert.rejects(f.adapter.execute('ikeadisplay:other', 'set', { on: false }), /Unknown IKEA display/);
  await assert.rejects(f.adapter.execute(ID, 'upload', {}), /Unknown IKEA display action/);
  assert.deepEqual(f.writes, []);
});

test('a mismatched API cannot register a light', async (t) => {
  const f = fixture(t);
  f.device.brightness = '128';
  await assert.rejects(f.adapter.start(), /valid brightness/);
  assert.equal(f.rows.size, 0);
});
