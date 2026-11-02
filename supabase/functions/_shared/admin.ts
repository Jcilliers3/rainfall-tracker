// Shared by the Edge Functions.

export function secretKey(env: (name: string) => string | undefined): string {
  const keys = env('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys);
    if (parsed.default) return parsed.default;
  }
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No Supabase secret key is available to this function');
  return legacy;
}

// Compares every character, so response time reveals nothing about the secret.
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i];
  return difference === 0;
}

export interface NewTown {
  name: string;
  province: string;
  lat: number;
  lon: number;
}

// Returns a clean town, or a message saying what to fix.
// deno-lint-ignore no-explicit-any
export function validateTown(input: any): { town?: NewTown; error?: string } {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const province = typeof input?.province === 'string' ? input.province.trim() : '';
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);

  if (!name) return { error: 'Enter a town name.' };
  if (name.length > 80) return { error: 'Use a town name of 80 characters or fewer.' };
  if (input?.lat === '' || input?.lat == null || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { error: 'Latitude must be between -90 and 90. South African latitudes are negative.' };
  }
  if (input?.lon === '' || input?.lon == null || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { error: 'Longitude must be between -180 and 180.' };
  }
  return {
    town: {
      name,
      province,
      lat: Math.round(lat * 10_000) / 10_000,
      lon: Math.round(lon * 10_000) / 10_000,
    },
  };
}
