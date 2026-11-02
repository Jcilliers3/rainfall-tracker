import { nextFetchTime, parseForecast, yrUrl } from './yr.ts';
import type { RainRow } from './yr.ts';

export interface DueTown {
  id: number;
  name: string;
  lat: number;
  lon: number;
  last_modified: string | null;
}

export interface CollectorStore {
  dueTowns(limit: number): Promise<DueTown[]>;
  saveForecast(town: DueTown, rows: RainRow[], updatedAt: string | null,
    lastModified: string | null, nextFetch: Date): Promise<void>;
  markUnchanged(town: DueTown, nextFetch: Date): Promise<void>;
  markFailed(town: DueTown, error: string, nextFetch: Date): Promise<void>;
  delayTowns(towns: DueTown[], nextFetch: Date): Promise<void>;
  logRun(summary: RunSummary): Promise<void>;
}

export interface RunSummary {
  due: number;
  updated: number;
  unchanged: number;
  failed: number;
  note: string | null;
}

export interface CollectOptions {
  store: CollectorStore;
  userAgent: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  batchSize?: number;
  // Stop starting new requests after this long. Free-plan functions are cut off at 150s.
  budgetMs?: number;
}

const RETRY_AFTER_FAILURE = 30 * 60_000;
const BACK_OFF_AFTER_THROTTLE = 60 * 60_000;

export async function collect(options: CollectOptions): Promise<RunSummary> {
  const {
    store,
    userAgent,
    fetchFn = fetch,
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    batchSize = 60,
    budgetMs = 120_000,
  } = options;

  const started = now().getTime();
  const towns = await store.dueTowns(batchSize);
  const summary: RunSummary = { due: towns.length, updated: 0, unchanged: 0, failed: 0, note: null };

  for (let i = 0; i < towns.length; i++) {
    if (now().getTime() - started > budgetMs) {
      summary.note = `Stopped early with ${towns.length - i} towns left for the next run`;
      break;
    }

    const town = towns[i];
    try {
      const headers: Record<string, string> = {
        'User-Agent': userAgent,
        'Accept-Encoding': 'gzip, deflate',
      };
      if (town.last_modified) headers['If-Modified-Since'] = town.last_modified;

      const response = await fetchFn(yrUrl(town.lat, town.lon), {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      const time = now();

      if (response.status === 429) {
        // Yr says to cut traffic immediately, so leave the other towns alone too.
        await store.delayTowns(towns.slice(i), new Date(time.getTime() + BACK_OFF_AFTER_THROTTLE));
        summary.failed += 1;
        summary.note = 'Yr returned 429, so collection is paused for an hour';
        break;
      }

      const nextFetch = nextFetchTime(response.headers.get('Expires'), time);

      if (response.status === 304) {
        await store.markUnchanged(town, nextFetch);
        summary.unchanged += 1;
      } else if (response.ok) {
        if (response.status === 203) {
          summary.note = 'Yr returned 203: this API version is deprecated and needs updating';
        }
        const forecast = parseForecast(await response.json());
        await store.saveForecast(
          town,
          forecast.rows,
          forecast.updatedAt,
          response.headers.get('Last-Modified'),
          nextFetch,
        );
        summary.updated += 1;
      } else {
        throw new Error(`Yr returned ${response.status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.markFailed(town, message, new Date(now().getTime() + RETRY_AFTER_FAILURE));
      summary.failed += 1;
    }

    if (i < towns.length - 1) await sleep(200);
  }

  await store.logRun(summary);
  return summary;
}
