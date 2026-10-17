import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../migrations/20261017001200_all_off_scene.sql', import.meta.url), 'utf8');
const sceneMigration = await readFile(new URL('../migrations/20261017000700_scenes.sql', import.meta.url), 'utf8');
// Exercise the production queue function as well as creating the scene.
const queueFunction = sceneMigration.slice(
  sceneMigration.indexOf('create function private.queue_scene'),
  sceneMigration.indexOf('-- What the app calls'),
);

async function database(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema private;
    create table public.devices (
      id text primary key, integration text, kind text, online boolean default true
    );
    create table public.floor_heating (sensor_zone text, helper_zone text);
    create table public.scenes (
      id uuid primary key default gen_random_uuid(), name text, tone text,
      shape text, actions jsonb, last_run_at timestamptz
    );
    create table public.commands (
      sequence bigint generated always as identity, device_id text, action text,
      params jsonb, source text, created_by uuid
    );
    create table public.events (type text, data jsonb);
  `);
  await db.exec(queueFunction);
  return db;
}

async function devices(db) {
  await db.exec(`
    insert into public.devices (id, integration, kind, online) values
      ('light-online', 'tradfri', 'light', true),
      ('light-offline', 'tradfri', 'light', false),
      ('plug', 'tradfri', 'plug', true),
      ('group', 'tradfri', 'group', true),
      ('floor-sensor', 'evohome', 'zone', true),
      ('floor-helper', 'evohome', 'zone', true),
      ('radiator', 'evohome', 'zone', true),
      ('heating', 'evohome', 'heating', true),
      ('doorbell', 'eufy', 'doorbell', true),
      ('sensor', 'tradfri', 'sensor', true),
      ('remote', 'tradfri', 'remote', true),
      ('blind', 'brel', 'blind', true),
      ('tv', 'bravia', 'tv', true),
      ('speaker', 'sonos', 'speaker', true);
    insert into public.floor_heating values ('floor-sensor', 'floor-helper');
  `);
}

test('creates the scoped scene without running devices; playback uses existing commands', async (t) => {
  const db = await database(t);
  await devices(db);
  await db.exec(migration);
  const { rows: [scene] } = await db.query('select * from public.scenes');
  assert.equal(scene.name, 'All off');
  assert.equal(scene.last_run_at, null);
  assert.deepEqual(scene.actions.map(a => [a.device_id, a.action, a.params]), [
    ['floor-sensor', 'floor_off', {}],
    ['heating', 'set_mode', { mode: 'HeatingOff' }],
    ['light-offline', 'set', { on: false }],
    ['light-online', 'set', { on: false }],
    ['plug', 'set', { on: false }],
  ]);
  assert.equal((await db.query('select * from public.commands')).rows.length, 0);
  assert.equal((await db.query('select * from public.events')).rows.length, 0);

  await db.query("select private.queue_scene($1, 'test', null)", [scene.id]);
  const { rows: commands } = await db.query('select * from public.commands order by sequence');
  assert.deepEqual(commands.map(c => [c.device_id, c.action, c.params]),
    scene.actions.map(a => [a.device_id, a.action, a.params]));
  const { rows: events } = await db.query('select * from public.events');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'scene.run');
});

test('rerunning does not duplicate the scene or overwrite household edits', async (t) => {
  const db = await database(t);
  await devices(db);
  await db.exec(migration);
  await db.exec(`update public.scenes set name = ' ALL OFF ', tone = 'pink', actions = '[]'`);
  await db.exec(migration);
  const { rows } = await db.query('select name, tone, actions from public.scenes');
  assert.deepEqual(rows, [{ name: ' ALL OFF ', tone: 'pink', actions: [] }]);
});

test('no eligible devices means no empty scene', async (t) => {
  const db = await database(t);
  await db.exec("insert into public.devices (id, integration, kind) values ('doorbell', 'eufy', 'doorbell')");
  await db.exec(migration);
  assert.equal((await db.query('select * from public.scenes')).rows.length, 0);
});

test('works without a floor thermostat and covers multiple heating systems', async (t) => {
  const db = await database(t);
  await db.exec(`insert into public.devices (id, integration, kind) values
    ('system-1', 'evohome', 'heating'), ('system-2', 'evohome', 'heating')`);
  await db.exec(migration);
  const { rows: [scene] } = await db.query('select * from public.scenes');
  assert.deepEqual(scene.actions.map(a => a.device_id), ['system-1', 'system-2']);
  assert.ok(scene.actions.every(a => a.params.mode === 'HeatingOff'));
});
