import { createClient } from '@supabase/supabase-js';
import * as sample from './sample.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// With no Supabase settings the site shows labelled sample data.
export const usingSample = !url || !key;

const db = usingSample ? null : createClient(url, key, { auth: { persistSession: false } });

function rows({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function getSummary() {
  if (usingSample) return sample.summary();
  return rows(await db.from('town_summary').select('*').order('id'));
}

export async function getTownDetail(townId) {
  if (usingSample) return sample.detail(townId);

  const hour = 3_600_000;
  const start = Math.floor(Date.now() / hour) * hour;
  const fromDay = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  const [hourly, daily] = await Promise.all([
    db.from('rain_hourly').select('hour, mm, is_past').eq('town_id', townId)
      .gte('hour', new Date(start - 48 * hour).toISOString())
      .lt('hour', new Date(start + 48 * hour).toISOString())
      .order('hour'),
    db.from('rain_daily').select('day, mm, past_hours, hours').eq('town_id', townId)
      .gte('day', fromDay).order('day'),
  ]);
  return { hourly: rows(hourly), daily: rows(daily) };
}

export async function callAdmin(adminKey, body) {
  const response = await fetch(`${url}/functions/v1/manage-towns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, 'x-admin-key': adminKey },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `The request failed with status ${response.status}.`);
  return result;
}

// Town search uses Open-Meteo's GeoNames lookup. See the README if the site is commercial.
export async function searchPlaces(name) {
  const params = new URLSearchParams({ name, count: '8', language: 'en', countryCode: 'ZA' });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error('Town search is not available right now. Enter the coordinates instead.');
  return (await response.json()).results ?? [];
}
