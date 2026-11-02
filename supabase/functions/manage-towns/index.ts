// Used by the website's Manage towns page. Every request needs the admin key.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { sameSecret, secretKey, validateTown } from '../_shared/admin.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-admin-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);

  if (!sameSecret(request.headers.get('x-admin-key'), Deno.env.get('ADMIN_KEY'))) {
    return json({ error: 'That admin key is not correct.' }, 401);
  }

  const body = await request.json().catch(() => null);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey((n) => Deno.env.get(n)), {
    auth: { persistSession: false },
  });

  switch (body?.action) {
    case 'list': {
      const { data, error } = await db.from('towns')
        .select('id, name, province, lat, lon, active, last_success_at, last_error')
        .order('name');
      return error ? json({ error: error.message }, 500) : json({ towns: data });
    }

    case 'add': {
      const { town, error: problem } = validateTown(body);
      if (!town) return json({ error: problem }, 400);

      const { data, error } = await db.from('towns').insert(town).select().single();
      if (error?.code === '23505') {
        return json({ error: 'A town with these coordinates already exists.' }, 409);
      }
      return error ? json({ error: error.message }, 500) : json({ town: data });
    }

    case 'set_active': {
      if (!Number.isInteger(body.id) || typeof body.active !== 'boolean') {
        return json({ error: 'Send a town id and active true or false.' }, 400);
      }
      // Resuming a town makes it due straight away.
      const change = body.active
        ? { active: true, next_fetch_at: new Date().toISOString() }
        : { active: false };
      const { error } = await db.from('towns').update(change).eq('id', body.id);
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
});
