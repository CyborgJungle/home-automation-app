import test from 'node:test';
import assert from 'node:assert/strict';
import { COOLDOWN_MS, inputToSwitch, JUST_ON_MS, portOf } from '../src/integrations/tv-inputs.js';

const NOW = 10_000_000;
const LONG_AGO = 0;
const steam = (on, onSince = LONG_AGO) => ({ port: 2, on, onSince });
const apple = (on, onSince = LONG_AGO) => ({ port: 3, on, onSince });
const decide = (sources, current, extra = {}) =>
  inputToSwitch({ sources, current, tvOnSince: LONG_AGO, lastSwitchAt: LONG_AGO, now: NOW, ...extra });

test('reads the HDMI port from plain and HDMI-CEC addresses', () => {
  assert.equal(portOf('extInput:hdmi?port=2'), 2);
  assert.equal(portOf('extInput:cec?type=player&port=3&logicalAddr=4'), 3);
  assert.equal(portOf('extInput:composite?port=1'), 'other');
  assert.equal(portOf(null), null);
  assert.equal(portOf('com.google.android.youtube.tv'), null);
});

test('an empty input is corrected to the device that is on', () => {
  assert.equal(decide([steam(false), apple(true)], 4), 3);
  assert.equal(decide([steam(true), apple(false)], 1), 2);
  assert.equal(decide([steam(true), apple(false)], 'other'), 2);
});

test('a device that just came on gets its input, even from an app', () => {
  assert.equal(decide([steam(true), apple(true, NOW - 5_000)], 2), 3);
  assert.equal(decide([steam(false), apple(true, NOW - 5_000)], null), 3);
});

test('when the TV just came on it goes to the device that is on', () => {
  assert.equal(decide([steam(true), apple(false)], null, { tvOnSince: NOW - 3_000 }), 2);
});

test('your own choice is left alone once things have settled', () => {
  assert.equal(decide([steam(true), apple(true)], 2), null, 'both on, you picked HDMI 2');
  assert.equal(decide([steam(true), apple(false)], null), null, 'an app on the TV itself');
  assert.equal(decide([steam(true), apple(false)], 3), null, "HDMI 3 is Apple TV's, so it's in use");
});

test('nothing on: nothing to follow', () => {
  assert.equal(decide([steam(false), apple(false)], 4), null);
});

test('already right, or switched a moment ago: no switch', () => {
  assert.equal(decide([steam(true, NOW - 1_000), apple(false)], 2), null);
  assert.equal(decide([steam(false), apple(true)], 4, { lastSwitchAt: NOW - COOLDOWN_MS + 1 }), null);
  assert.equal(decide([steam(false), apple(true)], 4, { lastSwitchAt: NOW - COOLDOWN_MS }), 3);
});

test('"just came on" ends after a minute', () => {
  assert.equal(decide([steam(false), apple(true, NOW - JUST_ON_MS)], null), null);
});
