import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const action = [{ device_id: 'test-light', action: 'set', params: { on: true } }];
const allDays = [0, 1, 2, 3, 4, 5, 6];
const cold = { type: 'weather', key: 'temperature', op: 'lt', value: 10 };

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email', current_setting('test.email', true))$$;
    create publication supabase_realtime;
    create schema cron;
    create table cron.jobs (name text, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.jobs values ($1,$2,$3); select 1::bigint;
    $$;
    create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);
    create schema net;
    create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$select 1::bigint$$;
  `);
  for (const name of ['20261017000000_init.sql', '20261017000600_automation_engine.sql', '20261017000700_scenes.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`insert into public.devices (id,integration,kind,name) values
    ('test-light','tradfri','light','Test light'),
    ('evohome:zone:sensor','evohome','zone','Woonkamer'),
    ('evohome:zone:helper','evohome','zone','Babykamer');`);
  for (const name of ['20261017001100_floor_heating.sql', '20261017001200_all_off_scene.sql', '20261017001300_weather.sql', '20261017001400_automation_logic.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
  await db.exec(`
    insert into public.allowed_emails (email) values ('member@example.invalid');
    grant usage on schema public,private,auth to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    grant usage on all sequences in schema public to authenticated;
  `);
});

beforeEach(async () => {
  await db.exec(`reset role; delete from public.automations; delete from public.commands; delete from public.events;
    update public.weather set state='{}', observed_at=null, checked_at=null, sun_events='{}', error=null;
    update public.devices set state='{}', online=true where id='test-light';`);
});
after(() => db.close());

async function sample(state, observed = 'now()', sun = {}) {
  await db.query(`update public.weather set state=$1, observed_at=${observed}, sun_events=$2 where id=1`, [JSON.stringify(state), JSON.stringify(sun)]);
}
async function rule(trigger = cold, conditions = [], actions = action) {
  const { rows: [a] } = await db.query(`insert into public.automations (name,trigger,conditions,actions) values ('Test rule',$1,$2,$3) returning *`, [JSON.stringify(trigger), JSON.stringify(conditions), JSON.stringify(actions)]);
  return a;
}
const count = async () => Number((await db.query('select count(*) as n from public.commands')).rows[0].n);

test('migration creates the weather location and cron, without active rules or commands', async () => {
  assert.equal((await db.query('select postcode from public.weather_config')).rows[0].postcode, '1011 AB');
  assert.equal((await db.query("select schedule from cron.jobs where name='weather-poll'")).rows[0].schedule, '*/15 * * * *');
  assert.equal((await db.query('select count(*) as n from public.automations')).rows[0].n, 0);
  assert.equal(await count(), 0);
});

test('fires on a threshold crossing, not every refresh while it remains true', async () => {
  await sample({ temperature: 12 });
  const a = await rule();
  await sample({ temperature: 9 });
  assert.equal(await count(), 1);
  await sample({ temperature: 8 });
  assert.equal(await count(), 1);
  await sample({ temperature: 12 });
  await db.query("update public.automations set last_run_at=now()-interval '1 minute' where id=$1", [a.id]);
  await sample({ temperature: 9 });
  assert.equal(await count(), 2);
});

test('initial data and recovery from an outage do not fire a weather automation', async () => {
  await rule();
  await sample({ temperature: 5 });
  assert.equal(await count(), 0);
  await sample({ temperature: 12 }, "now()-interval '1 hour'");
  await sample({ temperature: 5 });
  assert.equal(await count(), 0);
});

test('unknown rain is not dry, and becoming known is not rain stopping', async () => {
  await sample({ temperature: 12, rain: null });
  await rule({ type: 'weather', key: 'rain', op: 'eq', value: 0 });
  await sample({ temperature: 12, rain: 0 });
  assert.equal(await count(), 0);
  await sample({ temperature: 12, rain: 1 });
  await sample({ temperature: 12, rain: 0 });
  assert.equal(await count(), 1);
});

test('weather conditions are ANDed, and missing or stale weather blocks time rules', async () => {
  const { rows: [clock] } = await db.query("select to_char(now() at time zone 'Europe/Amsterdam','HH24:MI') as at");
  await rule({ type: 'time', at: clock.at, days: allDays }, [cold, { type: 'weather', key: 'is_day', op: 'eq', value: true }]);
  await sample({ temperature: 5, is_day: false });
  await db.exec('select private.run_time_automations()');
  assert.equal(await count(), 0);
  await sample({ temperature: 5, is_day: true }, "now()-interval '1 hour'");
  await db.exec('select private.run_time_automations()');
  assert.equal(await count(), 0);
  await sample({ temperature: 5, is_day: true });
  await db.exec('select private.run_time_automations(); select private.run_time_automations()');
  assert.equal(await count(), 1);
});

test('existing device triggers also honor weather conditions and play scenes', async () => {
  const { rows: [scene] } = await db.query(`insert into public.scenes (name,actions) values ('Test scene',$1) returning id`, [JSON.stringify(action)]);
  await rule({ type: 'device', device_id: 'test-light', key: 'on', op: 'eq', value: true }, [cold], [{ scene_id: scene.id }]);
  await sample({ temperature: 15 });
  await db.exec(`update public.devices set state='{"on":true}' where id='test-light'`);
  assert.equal(await count(), 0);
  await db.exec(`update public.devices set state='{"on":false}' where id='test-light'`);
  await sample({ temperature: 5 });
  await db.exec(`update public.devices set state='{"on":true}' where id='test-light'`);
  assert.equal(await count(), 1);
});

test('sunset offsets use Amsterdam weekdays across the autumn DST transition', async () => {
  const day = '2026-10-25'; // Sunday, after the clocks have moved back.
  const sun = { [day]: { sunrise:'2026-10-25T06:30:00Z', sunset:'2026-10-25T16:30:00Z' } };
  await sample({ temperature: 10 }, "'2026-10-25T16:00:00Z'::timestamptz", sun);
  const a = await rule({ type:'sun', event:'sunset', offset_minutes:-30, days:[1] });
  await db.exec("select private.run_scheduled_automations('2026-10-25T16:00:00Z')");
  assert.equal(await count(), 0);
  await db.query(`update public.automations set trigger=jsonb_set(trigger,'{days}','[0]') where id=$1`, [a.id]);
  await db.exec("select private.run_scheduled_automations('2026-10-25T16:00:00Z')");
  assert.equal(await count(), 1);
});

test('only members can read weather; clients cannot overwrite it or run polling', async () => {
  await db.exec("set role authenticated; set test.email='other@example.invalid'");
  assert.equal((await db.query('select * from public.weather')).rows.length, 0);
  await db.exec("set test.email='member@example.invalid'");
  assert.equal((await db.query('select * from public.weather')).rows.length, 1);
  const result = await db.query("update public.weather set error='tampered' returning id");
  assert.equal(result.rows.length, 0);
  await assert.rejects(db.exec('select public.claim_weather_poll()'), /permission denied/);
  await assert.rejects(db.exec('select private.run_scheduled_automations(now())'), /permission denied/);
  await db.exec('reset role');
});

test('poll claims prevent overlapping weather refreshes', async () => {
  assert.equal((await db.query('select public.claim_weather_poll() as claimed')).rows[0].claimed, true);
  assert.equal((await db.query('select public.claim_weather_poll() as claimed')).rows[0].claimed, false);
  await db.exec("update public.weather set checked_at=now()-interval '6 minutes'");
  assert.equal((await db.query('select public.claim_weather_poll() as claimed')).rows[0].claimed, true);
});

const logic = (...groups) => ({ type: 'logic', groups });
const lampOn = { type: 'device', device_id: 'test-light', key: 'on', op: 'eq', value: true };
const daytime = { type: 'weather', key: 'is_day', op: 'eq', value: true };
const ring = { type: 'event', event: 'doorbell.ring' };
const clock = async () => (await db.query("select to_char(now() at time zone 'Europe/Amsterdam','HH24:MI') as at")).rows[0].at;
const ringBell = async () => db.exec("insert into public.events(type,data) values ('doorbell.ring','{}')");
const resetCooldown = async () => db.exec("update public.automations set last_run_at=now()-interval '1 minute'");

test('And works across device and weather, reacting when either check becomes true', async () => {
  await db.exec(`update public.devices set state='{"on":false}' where id='test-light'`);
  await sample({ temperature: 12 });
  await rule(logic([lampOn, cold]));
  await db.exec(`update public.devices set state='{"on":true}' where id='test-light'`);
  assert.equal(await count(), 0);
  await sample({ temperature: 5 });
  assert.equal(await count(), 1);
  await sample({ temperature: 4 });
  assert.equal(await count(), 1);
  await resetCooldown();
  await db.exec(`update public.devices set state='{"on":false}' where id='test-light'; update public.devices set state='{"on":true}' where id='test-light'`);
  assert.equal(await count(), 2);
});

test('Or starts another And group; unrelated changes never run a matching group again', async () => {
  await sample({ temperature: 15, is_day: true });
  await db.exec(`update public.devices set state='{"on":false}' where id='test-light'`);
  await rule(logic([lampOn, cold], [ring, daytime]));
  await ringBell();
  assert.equal(await count(), 1);
  await resetCooldown();
  await sample({ temperature: 14, is_day: true });
  assert.equal(await count(), 1);
  await sample({ temperature: 5, is_day: false });
  await ringBell();
  assert.equal(await count(), 1);
  await db.exec(`update public.devices set state='{"on":true}' where id='test-light'`);
  assert.equal(await count(), 2);
});

test('missing, stale or recovered weather cannot trigger a logic group', async () => {
  await rule(logic([cold]));
  await sample({ temperature: 5 });
  assert.equal(await count(), 0);
  await sample({ temperature: 15 }, "now()-interval '1 hour'");
  await sample({ temperature: 5 });
  assert.equal(await count(), 0);
  await sample({ temperature: null });
  await sample({ temperature: 5 });
  assert.equal(await count(), 0);
});

test('offline and missing device values do not satisfy And checks', async () => {
  await rule(logic([ring, lampOn]));
  await ringBell();
  assert.equal(await count(), 0);
  await db.exec(`update public.devices set state='{"on":true}',online=false where id='test-light'`);
  await ringBell();
  assert.equal(await count(), 0);
  await db.exec("update public.devices set online=true where id='test-light'");
  await ringBell();
  assert.equal(await count(), 1);
});

test('time and sun can be Or alternatives and run their shared scene', async () => {
  const at = await clock();
  const { rows: [scene] } = await db.query(`insert into public.scenes(name,actions) values ('Logic scene',$1) returning id`, [JSON.stringify(action)]);
  await sample({ temperature: 5 });
  await rule(logic([{ type:'time', at, days: allDays }, cold], [{ type:'sun', event:'sunset', offset_minutes:-30, days:allDays }]), [], [{ scene_id: scene.id }]);
  await db.exec('select private.run_time_automations(); select private.run_time_automations()');
  assert.equal(await count(), 1);
  await resetCooldown();
  await sample({ temperature: 5 }, "'2026-10-25T16:00:00Z'::timestamptz", { '2026-10-25': { sunrise:'2026-10-25T06:30:00Z', sunset:'2026-10-25T16:30:00Z' } });
  await db.exec("select private.run_scheduled_automations('2026-10-25T16:00:00Z')");
  assert.equal(await count(), 2);
});

test('overnight time checks use the starting weekday and Amsterdam daylight saving', async () => {
  const range = { type:'time_range', from:'22:00', until:'03:30', days:[6] }; // Saturday night.
  const result = async instant => (await db.query("select private.automation_rule_value($1,$2,'{}',false) as matches", [JSON.stringify(range), instant])).rows[0].matches;
  assert.equal(await result('2026-10-24T19:59:00Z'), false);
  assert.equal(await result('2026-10-24T20:00:00Z'), true);
  assert.equal(await result('2026-10-25T00:30:00Z'), true);
  assert.equal(await result('2026-10-25T01:30:00Z'), true); // repeated 02:30 after DST.
  assert.equal(await result('2026-10-25T02:30:00Z'), false);
  const at = await clock();
  const [hour, minute] = at.split(':').map(Number);
  const next = (hour * 60 + minute + 1) % 1440;
  const until = `${String(Math.floor(next / 60)).padStart(2,'0')}:${String(next % 60).padStart(2,'0')}`;
  await rule(logic([ring, { type:'time_range', from:at, until, days:allDays }]));
  await ringBell();
  assert.equal(await count(), 1);
});

test('an unavailable Or branch does not block another independent alternative', async () => {
  await rule(logic([cold], [ring]));
  await ringBell();
  assert.equal(await count(), 1);
});

test('logic validation rejects empty groups, nesting, bad times and oversized rules', async () => {
  for (const trigger of [logic(), logic([]), logic([logic([cold])]), logic([{ type:'time',at:'25:99',days:allDays }]), logic([{type:'time_range',from:'12:00',until:'12:00',days:allDays}]), logic(Array(13).fill(cold)), logic([{...cold, value:'bad'}]), logic([{type:'sun',event:'sunset',offset_minutes:0,days:[8]}])]) {
    await assert.rejects(rule(trigger), /automations_trigger_shape/);
  }
});

test('members can save logic rules but cannot call privileged evaluation functions', async () => {
  await db.exec("set role authenticated; set test.email='member@example.invalid'");
  await rule(logic([ring, cold], [{ type:'time',at:'07:30',days:allDays }]));
  await assert.rejects(db.exec("select private.run_logic_automations(now(),'{\"cause\":\"doorbell.ring\"}')"), /permission denied/);
  await assert.rejects(db.exec("select private.automation_rule_value('{}',now(),'{}',false)"), /permission denied/);
  await db.exec('reset role');
});
