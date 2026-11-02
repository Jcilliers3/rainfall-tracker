// Runs the real migrations on PGlite (Postgres in WebAssembly).
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const HOUR = 3_600_000;
const startOfHour = Math.floor(Date.now() / HOUR) * HOUR;
const at = (hoursFromNow) => new Date(startOfHour + hoursFromNow * HOUR).toISOString();
const row = (hoursFromNow, mm, hours = 1) => ({ valid_from: at(hoursFromNow), hours, mm });

async function save(town, rows, now = at(0)) {
  await db.query(
    'select public.save_forecast($1, $2, $3, $4, $5, $6)',
    [town, JSON.stringify(rows), now, 'lm', at(1), now],
  );
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const towns = async () => (await db.query('select * from public.towns')).rows;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;`);
  for (const file of ['20261102000001_schema.sql', '20261102000002_seed_towns.sql']) {
    await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
});

test('all 19 towns are seeded', async () => {
  assert.equal((await towns()).length, 19);
});

test('past hours freeze and future hours are replaced', async () => {
  await save(1, [row(-2, 5), row(-1, 3), row(0, 1), row(1, 2)], at(-2));
  await save(1, [row(0, 9), row(1, 8)], at(0));
  const rows = (await db.query(
    'select valid_from, mm::float as mm from public.rain_periods where town_id = 1 order by 1')).rows;
  assert.deepEqual(rows.map((r) => r.mm), [5, 3, 9, 8]);
});

test('a late fetch cannot rewrite a past hour', async () => {
  await save(2, [row(-1, 4)], at(-1));
  await save(2, [row(-1, 99), row(0, 1)], at(0));
  const r = await one('select mm::float as mm from public.rain_periods where town_id = 2 and valid_from = $1', [at(-1)]);
  assert.equal(r.mm, 4);
});

test('a forecast that starts later than this hour keeps the existing current hour', async () => {
  await save(3, [row(0, 2), row(1, 2)], at(0));
  await save(3, [row(1, 5)], at(0));
  const rows = (await db.query('select mm::float as mm from public.rain_periods where town_id = 3 order by valid_from')).rows;
  assert.deepEqual(rows.map((r) => r.mm), [2, 5]);
});

test('a six-hour block overlapping new hourly rows is trimmed so nothing counts twice', async () => {
  await save(4, [row(-2, 12, 6)], at(-2));
  await save(4, [row(0, 1), row(1, 1)], at(0));
  const r = await one(`select sum(mm)::float as total, count(*)::int as n from public.rain_hourly where town_id = 4`);
  assert.deepEqual(r, { total: 6, n: 4 }); // 2 kept hours at 2 mm + 2 new hours at 1 mm
});

test('six-hour blocks split evenly and totals respect South African days', async () => {
  await save(5, [row(30, 6, 6)], at(0));
  const hourly = await one(`select count(*)::int as n, min(mm)::float as mm from public.rain_hourly where town_id = 5`);
  assert.deepEqual(hourly, { n: 6, mm: 1 });
  const daily = await one(`select sum(mm)::float as mm, sum(hours)::int as h from public.rain_daily where town_id = 5`);
  assert.deepEqual(daily, { mm: 6, h: 6 });

  await db.exec(`insert into public.rain_periods (town_id, valid_from, mm) values
    (6, '2026-01-14 21:00:00+00', 2), (6, '2026-01-14 22:00:00+00', 3)`);
  const days = (await db.query(`select day::text as day, mm::float as mm from public.rain_daily where town_id = 6 order by day`)).rows;
  assert.deepEqual(days, [{ day: '2026-01-14', mm: 2 }, { day: '2026-01-15', mm: 3 }]);
});

test('town_summary separates past from forecast and reports coverage', async () => {
  const rows = [];
  for (let h = -10; h < 0; h++) rows.push(row(h, 1));
  rows.push(row(0, 2), row(30, 6, 6), row(200, 50));
  await save(7, rows, at(-10));
  const s = await one(`select mm_24h::float, hours_24h, mm_7d::float, hours_7d, next_24h::float, next_7d::float, tracking_since
    from public.town_summary where id = 7`);
  assert.equal(s.mm_24h, 10);
  assert.equal(s.hours_24h, 10);
  assert.equal(s.mm_7d, 10);
  assert.equal(s.hours_7d, 10);
  assert.equal(s.next_24h, 2);
  assert.equal(s.next_7d, 8);
});

test('a town with no data shows zero hours, not an error', async () => {
  const s = await one(`select mm_7d::float, hours_7d, tracking_since from public.town_summary where id = 19`);
  assert.deepEqual(s, { mm_7d: 0, hours_7d: 0, tracking_since: null });
});

test('paused towns leave the dashboard but keep their data', async () => {
  await db.exec(`update public.towns set active = false where id = 7`);
  assert.equal((await db.query('select 1 from public.town_summary where id = 7')).rows.length, 0);
  assert.ok((await db.query('select 1 from public.rain_periods where town_id = 7')).rows.length > 0);
  await db.exec(`update public.towns set active = true where id = 7`);
});

test('the public role can read but cannot write', async () => {
  await db.exec('set role anon');
  try {
    assert.ok((await db.query('select * from public.town_summary')).rows.length > 0);
    await assert.rejects(db.query(`insert into public.towns (name, lat, lon) values ('x', 1, 1)`), /permission denied/);
    await assert.rejects(db.query(`update public.towns set name = 'x'`), /permission denied/);
    await assert.rejects(db.query(`delete from public.rain_periods`), /permission denied/);
    await assert.rejects(db.query(`select * from public.collector_runs`), /permission denied/);
    await assert.rejects(
      db.query(`select public.save_forecast(1, '[]', now(), 'x', now())`), /permission denied/);
  } finally {
    await db.exec('reset role');
  }
});

test('the same coordinates cannot be added twice', async () => {
  await assert.rejects(db.query(
    `insert into public.towns (name, lat, lon) values ('Again', -29.5390, 31.2144)`), /duplicate key/);
});
