import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteSyncPlan } from '../src/integrations/remote-sync.js';

const lamp = (id, on, level) => ({ id, on, level });

test('dimmed up from different levels: all back to the middle one', () => {
  // 50, 50 and 88 held up by 12: the third lamp stops at 100.
  assert.deepEqual(remoteSyncPlan([lamp('1', true, 62), lamp('2', true, 62), lamp('3', true, 100)]), { level: 62, ids: ['3'] });
});

test('dimmed down: the lamp stuck at the bottom does not win', () => {
  assert.deepEqual(remoteSyncPlan([lamp('1', true, 1), lamp('2', true, 30), lamp('3', true, 36)]), { level: 30, ids: ['1', '3'] });
});

test('lamps already together are left alone (1% either way is together)', () => {
  assert.equal(remoteSyncPlan([lamp('1', true, 62), lamp('2', true, 63), lamp('3', true, 62)]), null);
});

test('a lamp left off is switched on at the others’ level', () => {
  assert.deepEqual(remoteSyncPlan([lamp('1', true, 50), lamp('2', true, 50), lamp('3', false, 100)]), { level: 50, ids: ['3'] });
});

test('nothing to do when the remote switched everything off', () => {
  assert.equal(remoteSyncPlan([lamp('1', false, 62), lamp('2', false, 62), lamp('3', false, 100)]), null);
});

test('a single lamp is never "out of sync"', () => {
  assert.equal(remoteSyncPlan([lamp('1', true, 40)]), null);
});
