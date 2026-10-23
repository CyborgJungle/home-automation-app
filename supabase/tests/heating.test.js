import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const SENSOR = 'evohome:zone:woonkamer';
const HELPER = 'evohome:zone:babykamer';
const KANTOOR = 'evohome:zone:kantoor';
const SLAAP = 'evohome:zone:slaapkamer';
const SYSTEM = 'evohome:system:home';
const limits = { min_setpoint: 15, max_setpoint: 25 };

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
    create publication supabase_realtime;
    create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
  `);
  await db.exec(await readFile(new URL('../migrations/20261017000000_init.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.devices (id,integration,kind,name) values
    ('${SENSOR}','evohome','zone','Woonkamer'),
    ('${HELPER}','evohome','zone','Babykamer'),
    ('${KANTOOR}','evohome','zone','Kantoor'),
    ('${SLAAP}','evohome','zone','Slaapkamer'),
    ('${SYSTEM}','evohome','heating','Home');`);
  for (const name of ['20261017001100_floor_heating.sql', '20261019000400_room_heating.sql', '20261019000500_zone_limits.sql', '20261023120000_floor_borrows_boiler.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
});

// The living room wants heat (17.5° with a 20° target); nobody else is on.
beforeEach(async () => {
  await db.exec(`
    delete from public.commands;
    update public.floor_heating set enabled = false, heating = false, boiler_via = null, target = 20;
    update public.devices set online = true, state = '${JSON.stringify({ mode: 'Auto' })}' where id = '${SYSTEM}';
  `);
  await zone(SENSOR, { mode: 'FollowSchedule', setpoint: 15, temperature: 17.5 });
  await zone(HELPER, { mode: 'PermanentOverride', setpoint: 15, temperature: 16.5 });
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 15, temperature: 17.5 });
  await zone(SLAAP, { mode: 'PermanentOverride', setpoint: 15, temperature: 17 });
  await db.exec('delete from public.commands; update public.floor_heating set enabled = true');
});
after(() => db.close());

async function zone(id, state) {
  await db.query('update public.devices set state = $1 where id = $2', [JSON.stringify({ ...limits, ...state }), id]);
}
// Honeywell has done everything that was asked (and reported it back), including
// whatever that in turn queued.
async function settle() {
  for (let round = 0; round < 5; round++) {
    const { rows } = await db.query("select * from public.commands where status = 'pending' and action = 'set_temperature' order by id");
    await db.exec("update public.commands set status = 'done' where status = 'pending'");
    if (!rows.length) return;
    for (const c of rows) {
      await db.query(`update public.devices set state = state || jsonb_build_object('setpoint', $1::numeric, 'mode', 'PermanentOverride') where id = $2`, [c.params.setpoint, c.device_id]);
    }
  }
}
const helperAsks = async () =>
  (await db.query(`select (params ->> 'setpoint')::numeric as sp from public.commands where device_id = '${HELPER}' order by id desc limit 1`)).rows[0]?.sp;
const floor = async () => (await db.query('select heating, boiler_via from public.floor_heating')).rows[0];

test('with no other room on, the helper fires the boiler for the floor', async () => {
  assert.equal(Number(await helperAsks()), 25);
  assert.deepEqual(await floor(), { heating: true, boiler_via: null });
});

test('a room calling for heat carries the floor, and the helper stays off', async () => {
  await settle();
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 17.5 });
  assert.equal(Number(await helperAsks()), 15);
  await settle();
  assert.equal(Number((await db.query(`select state ->> 'setpoint' as sp from public.devices where id = '${HELPER}'`)).rows[0].sp), 15);
  assert.deepEqual(await floor(), { heating: true, boiler_via: KANTOOR });
});

test('once that room is nearly warm, the helper takes over again', async () => {
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 17.5 });
  await settle();
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 19.7 });
  assert.equal((await floor()).boiler_via, KANTOOR, 'still 0.3° to go: keeps carrying');
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 19.9 });
  assert.equal((await floor()).boiler_via, null);
  assert.equal(Number(await helperAsks()), 25);
});

test('a room only just below its target does not start carrying the floor', async () => {
  await settle();
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 19.7 });
  assert.equal((await floor()).boiler_via, null);
});

test('a room switched off stops carrying the floor', async () => {
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 20, temperature: 17.5 });
  await settle();
  await zone(KANTOOR, { mode: 'PermanentOverride', setpoint: 15, temperature: 17.5 });
  assert.equal((await floor()).boiler_via, null);
  assert.equal(Number(await helperAsks()), 25);
});

test('switching two rooms on quickly keeps both on', async () => {
  await db.exec(`update public.floor_heating set enabled = false, heating = false; delete from public.commands;
    update public.devices set state = '{"mode":"HeatingOff"}' where id = '${SYSTEM}'`);
  await zone(KANTOOR, { mode: 'FollowSchedule', setpoint: 15, temperature: 17.5 });
  await zone(SLAAP, { mode: 'FollowSchedule', setpoint: 15, temperature: 17 });
  await db.exec('delete from public.commands');

  await db.exec(`insert into public.commands (device_id, action, params) values ('${KANTOOR}', 'room_on', '{"setpoint": 20}')`);
  await db.exec(`insert into public.commands (device_id, action, params) values ('${SLAAP}', 'room_on', '{"setpoint": 19}')`);

  const { rows } = await db.query("select device_id, action, params from public.commands order by id");
  assert.equal(rows.filter((c) => c.action === 'set_mode').length, 1, 'Schedule is switched on once');
  const last = (id) => rows.filter((c) => c.device_id === id).at(-1).params.setpoint;
  assert.equal(Number(last(KANTOOR)), 20);
  assert.equal(Number(last(SLAAP)), 19);
});
