import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Every migration, in order, so the rules are checked as they run in production.
const db = new PGlite();
const LAMP = 'test-lamp';
const TV = 'test-tv';

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
    create publication supabase_realtime;
    create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create function cron.unschedule(text) returns boolean language sql as $$select true$$;
    create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
    create schema net;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
  `);
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
    if (name === '20261017001100_floor_heating.sql') {
      await db.exec(`insert into public.devices (id,integration,kind,name) values
        ('evohome:zone:a','evohome','zone','Woonkamer'), ('evohome:zone:b','evohome','zone','Babykamer')`);
    }
    try {
      // pg_net and pg_cron aren't in PGlite; the stubs above stand in for them.
      await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/create extension[^;]*;/gi, ''));
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
  await db.exec(`insert into public.devices (id,integration,kind,name,state) values
    ('${LAMP}','dirigera','light','Lamp','{"on":false}'), ('${TV}','bravia','tv','TV','{"on":false}')`);
});
beforeEach(async () => {
  await db.exec(`delete from public.commands; delete from public.automations; delete from public.events; delete from public.scenes;
    update public.devices set state = '{"on":false}' where id in ('${LAMP}','${TV}')`);
});
after(() => db.close());

async function scene(name, actions) {
  const { rows: [s] } = await db.query('insert into public.scenes (name, actions) values ($1, $2) returning id', [name, JSON.stringify(actions)]);
  return s.id;
}
const lampOn = [{ device_id: LAMP, action: 'set', params: { on: true } }];
const lastPlayed = (id, value = true) => ({ type: 'scene', scene_id: id, value, latest: true });
const check = async (rule) => (await db.query('select private.automation_rule_value($1, now(), $2, false) as v', [JSON.stringify(rule), '{"cause":"test"}'])).rows[0].v;

test('a scene is "played last" from playing it until another scene is played', async () => {
  const pip = await scene('Pip mode', lampOn);
  const other = await scene('Avond', lampOn);
  assert.equal(await check(lastPlayed(pip)), false, 'never played yet');
  await db.query("update public.scenes set last_run_at = now() - interval '1 minute' where id = $1", [pip]);
  assert.equal(await check(lastPlayed(pip)), true);
  assert.equal(await check(lastPlayed(pip, false)), false);
  // The lamp changing doesn't matter, unlike "is on".
  await db.exec(`update public.devices set state = '{"on":false}' where id = '${LAMP}'`);
  assert.equal(await check(lastPlayed(pip)), true);
  await db.query('update public.scenes set last_run_at = now() where id = $1', [other]);
  assert.equal(await check(lastPlayed(pip)), false);
  assert.equal(await check(lastPlayed(pip, false)), true);
});

test('a removed scene is unknown, not "not played last"', async () => {
  assert.equal(await check(lastPlayed('00000000-0000-0000-0000-000000000000', false)), null);
});

test('"is on" still looks at the devices', async () => {
  const pip = await scene('Pip mode', lampOn);
  await db.query('update public.scenes set last_run_at = now() where id = $1', [pip]);
  assert.equal(await check({ type: 'scene', scene_id: pip, value: true }), false);
  await db.exec(`update public.devices set state = '{"on":true}' where id = '${LAMP}'`);
  assert.equal(await check({ type: 'scene', scene_id: pip, value: true }), true);
});

test('"TV turns on" is skipped while Pip mode was played last, and runs again after another scene', async () => {
  const pip = await scene('Pip mode', lampOn);
  const avond = await scene('Avond', lampOn);
  await db.query(`insert into public.automations (name, trigger, conditions, actions) values ('TV on: volume 15', $1, '[]', $2)`, [
    JSON.stringify({ type: 'logic', groups: [[{ type: 'device', device_id: TV, key: 'on', op: 'eq', value: true, mode: 'becomes' }, lastPlayed(pip, false)]] }),
    JSON.stringify([{ device_id: TV, action: 'volume', params: { volume: 15 } }]),
  ]);
  const volumes = async () => Number((await db.query(`select count(*) n from public.commands where device_id = '${TV}' and action = 'volume'`)).rows[0].n);

  await db.query('update public.scenes set last_run_at = now() where id = $1', [pip]);
  await db.exec(`update public.devices set state = '{"on":true}' where id = '${TV}'`);
  assert.equal(await volumes(), 0, 'Pip mode keeps its own volume');

  await db.exec(`update public.devices set state = '{"on":false}' where id = '${TV}'`);
  await db.query('update public.scenes set last_run_at = now() + interval \'1 second\' where id = $1', [avond]);
  await db.exec(`update public.devices set state = '{"on":true}' where id = '${TV}'`);
  assert.equal(await volumes(), 1);
});

// --- "Only after sunset" ------------------------------------------------------

async function sun(darkNow) {
  const day = darkNow
    ? { sunrise: "now() + interval '10 hours'", sunset: "now() - interval '1 hour'" }
    : { sunrise: "now() - interval '2 hours'", sunset: "now() + interval '2 hours'" };
  await db.exec(`update public.weather set sun_events = jsonb_build_object(to_char(now(), 'YYYY-MM-DD'),
    jsonb_build_object('sunrise', ${day.sunrise}, 'sunset', ${day.sunset})) where id = 1`);
}
const hallwayAfterSunset = [
  { device_id: TV, action: 'power', params: { on: true } },
  { device_id: LAMP, action: 'set', params: { on: true }, only_dark: true },
];
const queued = async () => (await db.query('select device_id from public.commands order by id')).rows.map((r) => r.device_id);

test('in daylight a scene skips its "only after sunset" devices', async () => {
  await sun(false);
  const id = await scene('Pip mode', hallwayAfterSunset);
  await db.query("select private.queue_scene($1, 'test', null)", [id]);
  assert.deepEqual(await queued(), [TV]);
});

test('after sunset it switches them on too', async () => {
  await sun(true);
  const id = await scene('Pip mode', hallwayAfterSunset);
  await db.query("select private.queue_scene($1, 'test', null)", [id]);
  assert.deepEqual(await queued(), [TV, LAMP]);
});

test('an "only after sunset" device that is off does not make the scene "off"', async () => {
  const id = await scene('Pip mode', hallwayAfterSunset);
  await db.exec(`update public.devices set state = '{"on":true}' where id = '${TV}'`);
  assert.equal(await check({ type: 'scene', scene_id: id, value: true }), true);
});
