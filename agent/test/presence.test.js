import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASLEEP_AFTER_MS, nextAwake } from '../src/integrations/presence.js';

const now = 1_000_000_000;

test('an answer means awake straight away', () => {
  assert.equal(nextAwake({ answered: true, lastAnswerAt: now, now, was: false }), true);
});

test('a few missed pings keep an awake device awake', () => {
  assert.equal(nextAwake({ answered: false, lastAnswerAt: now - 60_000, now, was: true }), true);
  assert.equal(nextAwake({ answered: false, lastAnswerAt: now - ASLEEP_AFTER_MS + 1, now, was: true }), true);
});

test('silent for the whole wait means asleep', () => {
  assert.equal(nextAwake({ answered: false, lastAnswerAt: now - ASLEEP_AFTER_MS, now, was: true }), false);
});

test('right after start-up, silence reports nothing until the wait is over', () => {
  assert.equal(nextAwake({ answered: false, lastAnswerAt: now - 10_000, now, was: undefined }), undefined);
});
