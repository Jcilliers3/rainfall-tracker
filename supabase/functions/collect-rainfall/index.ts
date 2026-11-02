// Called every 15 minutes by pg_cron. See supabase/setup_schedule.sql.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { collect } from '../_shared/collect.ts';
import type { CollectorStore } from '../_shared/collect.ts';
import { sameSecret, secretKey } from '../_shared/admin.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (!sameSecret(request.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) {
    return json({ error: 'Wrong or missing x-cron-secret' }, 401);
  }

  // Yr blocks clients that cannot be identified and contacted.
  const userAgent = Deno.env.get('YR_USER_AGENT');
  if (!userAgent) return json({ error: 'Set the YR_USER_AGENT secret' }, 500);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey((n) => Deno.env.get(n)), {
    auth: { persistSession: false },
  });

  const check = ({ error }: { error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
  };

  const store: CollectorStore = {
    async dueTowns(limit) {
      const { data, error } = await db.from('towns')
        .select('id, name, lat, lon, last_modified')
        .eq('active', true)
        .lte('next_fetch_at', new Date().toISOString())
        .order('next_fetch_at')
        .limit(limit);
      if (error) throw new Error(error.message);
      return data;
    },
    async saveForecast(town, rows, updatedAt, lastModified, nextFetch) {
      check(await db.rpc('save_forecast', {
        p_town_id: town.id,
        p_rows: rows,
        p_forecast_updated_at: updatedAt,
        p_last_modified: lastModified,
        p_next_fetch_at: nextFetch.toISOString(),
      }));
    },
    async markUnchanged(town, nextFetch) {
      check(await db.from('towns').update({
        next_fetch_at: nextFetch.toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', town.id));
    },
    async markFailed(town, message, nextFetch) {
      check(await db.from('towns').update({
        next_fetch_at: nextFetch.toISOString(),
        last_error: message.slice(0, 200),
      }).eq('id', town.id));
    },
    async delayTowns(towns, nextFetch) {
      check(await db.from('towns').update({ next_fetch_at: nextFetch.toISOString() })
        .in('id', towns.map((town) => town.id)));
    },
    async logRun(summary) {
      check(await db.from('collector_runs').insert({ ...summary, finished_at: new Date().toISOString() }));
    },
  };

  try {
    return json(await collect({ store, userAgent }));
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
