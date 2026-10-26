import test from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_GRACE_MS, COOLDOWN_MS, decide, JUST_ON_MS, OFF_COOLDOWN_MS, OTHER_RECENT_MS, portOf } from '../src/integrations/tv-inputs.js';

const NOW = 10_000_000;
const LONG_AGO = 0;
const source = (port) => (on, extra = {}) => ({ port, on, onSince: LONG_AGO, offSince: 0, goneAt: 0, ...extra });
const steam = source(2);
const apple = source(3);
const run = (sources, current, extra = {}) =>
  decide({ sources, current, shown: null, tvOnSince: LONG_AGO, lastSwitchAt: LONG_AGO, lastOffAt: LONG_AGO, now: NOW, ...extra });
const watching = (port, since = 1_000) => ({ shown: { port, since } });

test('reads the HDMI port from plain and HDMI-CEC addresses', () => {
  assert.equal(portOf('extInput:hdmi?port=2'), 2);
  assert.equal(portOf('extInput:cec?type=player&port=3&logicalAddr=4'), 3);
  assert.equal(portOf('extInput:composite?port=1'), 'other');
  assert.equal(portOf(null), null);
  assert.equal(portOf('com.google.android.youtube.tv'), null);
});

// --- Switching inputs ------------------------------------------------------

test('an empty input is corrected to the device that is on', () => {
  assert.deepEqual(run([steam(false), apple(true)], 4), { port: 3 });
  assert.deepEqual(run([steam(true), apple(false)], 1), { port: 2 });
  assert.deepEqual(run([steam(true), apple(false)], 'other'), { port: 2 });
});

test('a device that just came on gets its input, even from an app', () => {
  assert.deepEqual(run([steam(true), apple(true, { onSince: NOW - 5_000 })], 2), { port: 3 });
  assert.deepEqual(run([steam(false), apple(true, { onSince: NOW - 5_000 })], null), { port: 3 });
});

test('when the TV just came on it goes to the device that is on', () => {
  assert.deepEqual(run([steam(true), apple(false)], null, { tvOnSince: NOW - 3_000 }), { port: 2 });
});

test('your own choice is left alone once things have settled', () => {
  assert.equal(run([steam(true), apple(true)], 2), null, 'both on, you picked HDMI 2');
  assert.equal(run([steam(true), apple(false)], null), null, 'an app on the TV itself');
  assert.equal(run([steam(true), apple(false)], 3), null, "HDMI 3 is Apple TV's, so it's in use");
});

test('nothing on: nothing to follow', () => {
  assert.equal(run([steam(false), apple(false)], 4), null);
});

test('already right, or switched a moment ago: no switch', () => {
  assert.equal(run([steam(true, { onSince: NOW - 1_000 }), apple(false)], 2), null);
  assert.equal(run([steam(false), apple(true)], 4, { lastSwitchAt: NOW - COOLDOWN_MS + 1 }), null);
  assert.deepEqual(run([steam(false), apple(true)], 4, { lastSwitchAt: NOW - COOLDOWN_MS }), { port: 3 });
});

test('"just came on" ends after a minute', () => {
  assert.equal(run([steam(false), apple(true, { onSince: NOW - JUST_ON_MS })], null), null);
});

test('a console that left its input is not switched back to', () => {
  // Network still says awake, but the TV jumped off HDMI 2 by itself.
  assert.equal(run([steam(true, { goneAt: NOW - 1_000 }), apple(false)], 4), null);
  // It wakes up again (on → off → on): it counts again.
  assert.deepEqual(run([steam(true, { goneAt: NOW - 60_000, onSince: NOW - 5_000 }), apple(false)], 4), { port: 2 });
});

// --- Switching off ---------------------------------------------------------

test('the Apple TV you were watching turns off: the TV goes off', () => {
  const away = NOW - AWAY_GRACE_MS;
  assert.deepEqual(run([steam(false), apple(false, { offSince: away })], 3, watching(3)), { off: true });
  // Also with the Steam machine idling awake in the background.
  assert.deepEqual(run([steam(true), apple(false, { offSince: away })], 4, watching(3)), { off: true });
});

test('the Steam machine you were playing on goes to sleep: the TV goes off', () => {
  // The TV jumped from HDMI 2 to an empty input before the network noticed.
  assert.deepEqual(run([steam(true, { goneAt: NOW - AWAY_GRACE_MS }), apple(false)], 4, watching(2)), { off: true });
  // Or the network noticed first.
  assert.deepEqual(run([steam(false, { offSince: NOW - 20_000 }), apple(false)], 2, watching(2)), { off: true });
});

test('a moment’s hiccup is not enough', () => {
  assert.equal(run([steam(false), apple(false, { offSince: NOW - AWAY_GRACE_MS + 1 })], 3, watching(3)), null);
});

test('not when you just turned the other device on', () => {
  const sources = [steam(true, { onSince: NOW - OTHER_RECENT_MS + 5_000 }), apple(false, { offSince: NOW - 20_000 })];
  assert.notDeepEqual(run(sources, 3, watching(3)), { off: true });
});

test('not for a device that was already off before you watched it', () => {
  // TV switched on by hand to HDMI 3 while the Apple TV was off.
  assert.equal(run([steam(false), apple(false, { offSince: 500 })], 3, watching(3, 1_000)), null);
});

test('not again after you switched the TV back on yourself', () => {
  const sources = [steam(false), apple(false, { offSince: NOW - 120_000 })];
  assert.equal(run(sources, null, { ...watching(3), tvOnSince: NOW - 30_000 }), null);
});

test('one switch-off attempt a minute', () => {
  const sources = [steam(false), apple(false, { offSince: NOW - 20_000 })];
  assert.equal(run(sources, 3, { ...watching(3), lastOffAt: NOW - OFF_COOLDOWN_MS + 1 }), null);
});

test('no input watched yet (just started): nothing to switch off', () => {
  assert.equal(run([steam(false), apple(false, { offSince: NOW - 20_000 })], 3), null);
});

test('the Steam machine sleeps: its input loses the signal and the TV goes off 3 seconds later', () => {
  const sources = (goneAt) => [steam(true, { goneAt }), apple(false)];
  assert.equal(run(sources(NOW - AWAY_GRACE_MS + 1), 2, watching(2)), null, 'not on a short drop');
  assert.deepEqual(run(sources(NOW - AWAY_GRACE_MS), 2, watching(2)), { off: true });
});
