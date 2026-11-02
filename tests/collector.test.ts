import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFetchTime, parseForecast, yrUrl } from '../supabase/functions/_shared/yr.ts';
import { collect } from '../supabase/functions/_shared/collect.ts';
import { sameSecret, secretKey, validateTown } from '../supabase/functions/_shared/admin.ts';

const body = {
  properties: {
    meta: { updated_at: '2026-11-02T09:19:03Z' },
    timeseries: [
      { time: '2026-11-02T09:00:00Z', data: { next_1_hours: { details: { precipitation_amount: 1.2 } } } },
      { time: '2026-11-04T23:00:00Z', data: {
        next_1_hours: { details: { precipitation_amount: 0 } },
        next_6_hours: { details: { precipitation_amount: 9 } } } },
      { time: '2026-11-05T00:00:00Z', data: { next_6_hours: { details: { precipitation_amount: 3.4 } } } },
      { time: '2026-11-11T12:00:00Z', data: { instant: { details: {} } } },
    ],
  },
};

test('parseForecast takes hourly values first, then six-hour, and skips the rest', () => {
  assert.deepEqual(parseForecast(body), {
    updatedAt: '2026-11-02T09:19:03Z',
    rows: [
      { valid_from: '2026-11-02T09:00:00Z', hours: 1, mm: 1.2 },
      { valid_from: '2026-11-04T23:00:00Z', hours: 1, mm: 0 },
      { valid_from: '2026-11-05T00:00:00Z', hours: 6, mm: 3.4 },
    ],
  });
});

test('parseForecast rejects a response with no timeseries', () => {
  assert.throws(() => parseForecast({ error: 'nope' }), /no timeseries/);
});

test('yrUrl never sends more than 4 decimals', () => {
  assert.match(yrUrl(-29.538971, 31.214392), /lat=-29\.5390&lon=31\.2144$/);
});

test('nextFetchTime waits past Expires, within limits', () => {
  const now = new Date('2026-11-02T10:00:00Z');
  const at = (expires: string | null, r = 0) => nextFetchTime(expires, now, () => r).toISOString();
  assert.equal(at('Mon, 02 Nov 2026 10:30:00 GMT'), '2026-11-02T10:31:00.000Z');
  assert.equal(at('Mon, 02 Nov 2026 10:30:00 GMT', 1), '2026-11-02T10:35:00.000Z');
  assert.equal(at('Mon, 02 Nov 2026 09:00:00 GMT'), '2026-11-02T10:10:00.000Z');
  assert.equal(at('Tue, 03 Nov 2026 09:00:00 GMT'), '2026-11-02T13:00:00.000Z');
  assert.equal(at(null), '2026-11-02T10:31:00.000Z');
});

function fakeStore(towns: any[]) {
  const log: any[] = [];
  return {
    log,
    dueTowns: async (limit: number) => towns.slice(0, limit),
    saveForecast: async (t: any, rows: any[], _u: any, lastModified: any) => { log.push(['save', t.id, rows.length, lastModified]); },
    markUnchanged: async (t: any) => { log.push(['unchanged', t.id]); },
    markFailed: async (t: any, message: string) => { log.push(['failed', t.id, message]); },
    delayTowns: async (ts: any[]) => { log.push(['delayed', ts.map((t) => t.id)]); },
    logRun: async (s: any) => { log.push(['run', s]); },
  };
}

const towns = [1, 2, 3].map((id) => ({ id, name: `T${id}`, lat: -29, lon: 31, last_modified: id === 2 ? 'Mon, 02 Nov 2026 09:00:00 GMT' : null }));
const sleep = async () => {};

test('collect saves, handles 304, sends identification and If-Modified-Since', async () => {
  const seen: any[] = [];
  const fetchFn = (async (_url: string, init: any) => {
    seen.push(init.headers);
    if (init.headers['If-Modified-Since']) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Last-Modified': 'X' } });
  }) as typeof fetch;
  const store = fakeStore(towns);
  const result = await collect({ store, userAgent: 'site.example me@site.example', fetchFn, sleep });
  assert.deepEqual([result.updated, result.unchanged, result.failed], [2, 1, 0]);
  assert.equal(seen[0]['User-Agent'], 'site.example me@site.example');
  assert.equal(seen[0]['If-Modified-Since'], undefined);
  assert.equal(seen[1]['If-Modified-Since'], 'Mon, 02 Nov 2026 09:00:00 GMT');
  assert.deepEqual(store.log[0], ['save', 1, 3, 'X']);
});

test('one failing town does not stop the others', async () => {
  let n = 0;
  const fetchFn = (async () => (++n === 1
    ? new Response('', { status: 500 })
    : new Response(JSON.stringify(body)))) as typeof fetch;
  const store = fakeStore(towns);
  const result = await collect({ store, userAgent: 'x', fetchFn, sleep });
  assert.deepEqual([result.updated, result.failed], [2, 1]);
  assert.deepEqual(store.log[0], ['failed', 1, 'Yr returned 500']);
});

test('a 429 stops the run and delays every remaining town', async () => {
  let calls = 0;
  const ok = (async () => { calls++; return calls === 2 ? new Response('', { status: 429 }) : new Response(JSON.stringify(body)); }) as typeof fetch;
  const store = fakeStore(towns);
  const result = await collect({ store, userAgent: 'x', fetchFn: ok, sleep });
  assert.equal(calls, 2);
  assert.deepEqual(store.log.find((l) => l[0] === 'delayed'), ['delayed', [2, 3]]);
  assert.match(result.note!, /429/);
});

test('a 203 is flagged as a deprecation warning', async () => {
  const fetchFn = (async () => new Response(JSON.stringify(body), { status: 203 })) as typeof fetch;
  const result = await collect({ store: fakeStore(towns.slice(0, 1)), userAgent: 'x', fetchFn, sleep });
  assert.match(result.note!, /deprecated/);
});

test('the run stops when the time budget is spent', async () => {
  let t = 0;
  const now = () => new Date((t += 50_000));
  const fetchFn = (async () => new Response(JSON.stringify(body))) as typeof fetch;
  const result = await collect({ store: fakeStore(towns), userAgent: 'x', fetchFn, sleep, now, budgetMs: 120_000 });
  assert.ok(result.updated < 3);
  assert.match(result.note!, /left for the next run/);
});

test('sameSecret needs an exact match', () => {
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abd', 'abc'), false);
  assert.equal(sameSecret('abcd', 'abc'), false);
  assert.equal(sameSecret('ab', 'abc'), false);
  assert.equal(sameSecret(null, 'abc'), false);
  assert.equal(sameSecret('', undefined), false);
});

test('secretKey prefers the new key format and falls back to the old one', () => {
  assert.equal(secretKey((n) => (n === 'SUPABASE_SECRET_KEYS' ? '{"default":"new"}' : 'old')), 'new');
  assert.equal(secretKey((n) => (n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'old' : undefined)), 'old');
  assert.throws(() => secretKey(() => undefined));
});

test('validateTown cleans good input and explains bad input', () => {
  assert.deepEqual(validateTown({ name: ' Reitz ', province: 'Free State', lat: '-27.80012', lon: 28.43 }).town,
    { name: 'Reitz', province: 'Free State', lat: -27.8001, lon: 28.43 });
  assert.match(validateTown({ name: '', lat: 1, lon: 1 }).error!, /town name/);
  assert.match(validateTown({ name: 'A', lat: 120, lon: 1 }).error!, /Latitude/);
  assert.match(validateTown({ name: 'A', lat: '', lon: 1 }).error!, /Latitude/);
  assert.match(validateTown({ name: 'A', lat: 1, lon: null }).error!, /Longitude/);
});
