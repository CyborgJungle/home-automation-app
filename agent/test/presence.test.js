import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextAwake } from '../src/integrations/presence.js';

const now = 1_000_000_000;
const since = now - 60 * 60 * 1000;
// Two minutes of pings every 2 s, oldest first; `answered(i)` says which got an answer.
const pings = (answered) =>
  Array.from({ length: 60 }, (_, i) => ({ at: now - (59 - i) * 2000, answered: answered(i) }));

test('a few answers in a row mean awake within seconds', () => {
  const history = pings((i) => i >= 57);
  assert.equal(nextAwake({ history, now, was: false, since }), true);
});

test('one stray answer from a sleeping machine keeps it asleep', () => {
  const history = pings((i) => i === 59 || i === 20);
  assert.equal(nextAwake({ history, now, was: false, since }), false);
});

test('an idle machine that skips some pings stays awake', () => {
  const history = pings((i) => i % 3 === 0 && i < 50);
  assert.equal(nextAwake({ history, now, was: true, since }), true);
});

test('almost no answers for two minutes means asleep', () => {
  const history = pings((i) => i === 5 || i === 30 || i === 52);
  assert.equal(nextAwake({ history, now, was: true, since }), false);
});

test('right after start-up, silence reports nothing until there are 2 minutes of pings', () => {
  const history = pings(() => false).slice(-10);
  assert.equal(nextAwake({ history, now, was: undefined, since: now - 20_000 }), undefined);
});
