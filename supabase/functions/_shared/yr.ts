// Reading Yr (MET Norway Locationforecast 2.0) and following its terms:
// https://developer.yr.no/doc/TermsOfService

export const YR_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

export interface RainRow {
  valid_from: string;
  hours: number;
  mm: number;
}

export interface Forecast {
  rows: RainRow[];
  updatedAt: string | null;
}

// Yr returns 403 for some products if coordinates have more than 4 decimals.
export function yrUrl(lat: number, lon: number): string {
  return `${YR_URL}?lat=${Number(lat).toFixed(4)}&lon=${Number(lon).toFixed(4)}`;
}

// Hourly steps carry next_1_hours and later steps carry next_6_hours. The last
// few steps carry neither, so they are skipped.
// deno-lint-ignore no-explicit-any
export function parseForecast(body: any): Forecast {
  const series = body?.properties?.timeseries;
  if (!Array.isArray(series)) throw new Error('Yr response has no timeseries');

  const rows: RainRow[] = [];
  for (const step of series) {
    const one = step?.data?.next_1_hours?.details?.precipitation_amount;
    const six = step?.data?.next_6_hours?.details?.precipitation_amount;
    if (typeof one === 'number') rows.push({ valid_from: step.time, hours: 1, mm: one });
    else if (typeof six === 'number') rows.push({ valid_from: step.time, hours: 6, mm: six });
  }
  return { rows, updatedAt: body?.properties?.meta?.updated_at ?? null };
}

const MIN_WAIT = 10 * 60_000;
const MAX_WAIT = 3 * 60 * 60_000;

// Waits until Yr's Expires time plus a few random minutes, so towns do not all
// come due together.
export function nextFetchTime(
  expires: string | null,
  now: Date,
  random: () => number = Math.random,
): Date {
  const parsed = expires ? Date.parse(expires) : NaN;
  const base = Number.isNaN(parsed) ? now.getTime() + 30 * 60_000 : parsed;
  const jitter = 60_000 + random() * 4 * 60_000;
  const wait = Math.min(Math.max(base + jitter - now.getTime(), MIN_WAIT), MAX_WAIT);
  return new Date(now.getTime() + wait);
}
