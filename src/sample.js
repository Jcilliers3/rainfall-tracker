// Invented numbers, shown only when Supabase isn't connected. The page carries a
// banner saying so whenever this data is on screen.

const TOWNS = [
  ['Ballito', 'KwaZulu-Natal', 3.1], ['Cape Vidal', 'KwaZulu-Natal', 3.4], ['Ladysmith', 'KwaZulu-Natal', 2.2],
  ['Harrismith', 'Free State', 2.4], ['Bethlehem', 'Free State', 2.1], ['Marquard', 'Free State', 1.7],
  ['Bloemfontein', 'Free State', 1.1], ['Villiers', 'Free State', 1.9], ['Frankfort', 'Free State', 1.8],
  ['Bothaville', 'Free State', 1.2], ['Klerksdorp', 'North West', 1.3], ['Lichtenburg', 'North West', 1],
  ['Wellington', 'Western Cape', 0.5], ['Moorreesburg', 'Western Cape', 0.3], ['George', 'Western Cape', 1.5],
  ['Caledon', 'Western Cape', 0.7], ['Swellendam', 'Western Cape', 0.9], ['Bredasdorp', 'Western Cape', 0.6],
  ['Heidelberg', 'Western Cape', 0.8],
];

const HOUR = 3_600_000;

function wave(seed, step) {
  const x = Math.sin(seed * 12.9898 + step * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Rain falls in spells, so most hours are dry.
function rainAt(id, hour, wetness) {
  const spell = wave(id, Math.floor(hour / 30));
  if (spell < 0.62) return 0;
  return wave(id + 7, hour) * wetness * 0.3;
}

export function summary() {
  const now = Math.floor(Date.now() / HOUR);
  return TOWNS.map(([name, province, wetness], index) => {
    const id = index + 1;
    const sum = (from, to) => {
      let total = 0;
      for (let hour = from; hour < to; hour++) total += rainAt(id, now + hour, wetness);
      return Number(total.toFixed(1));
    };
    const month = new Date().getDate() * 24;
    const hoursTracked = name === 'Villiers' ? 72 : 100_000;
    return {
      id, name, province,
      mm_24h: sum(-24, 0), hours_24h: 24,
      mm_7d: sum(-Math.min(168, hoursTracked), 0), hours_7d: Math.min(168, hoursTracked),
      mm_30d: sum(-Math.min(720, hoursTracked), 0), hours_30d: Math.min(720, hoursTracked),
      mm_month: sum(-month, 0), hours_month: Math.min(month, hoursTracked), expected_hours_month: month,
      mm_season: sum(-2900, 0), hours_season: Math.min(2900, hoursTracked), expected_hours_season: 2900,
      next_24h: sum(0, 24), next_7d: sum(0, 168),
      tracking_since: new Date((now - Math.min(2900, hoursTracked)) * HOUR).toISOString(),
      last_success_at: new Date(Date.now() - 11 * 60_000).toISOString(),
      forecast_updated_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      last_error: null,
    };
  });
}

export function detail(id) {
  const wetness = TOWNS[id - 1][2];
  const now = Math.floor(Date.now() / HOUR);
  const hourly = [];
  for (let offset = -48; offset < 48; offset++) {
    hourly.push({
      hour: new Date((now + offset) * HOUR).toISOString(),
      mm: Number(rainAt(id, now + offset, wetness).toFixed(2)),
      is_past: offset < 0,
    });
  }
  const daily = [];
  for (let day = -30; day <= 9; day++) {
    let total = 0;
    for (let hour = 0; hour < 24; hour++) total += rainAt(id, now + day * 24 + hour, wetness);
    daily.push({
      day: new Date((now + day * 24) * HOUR + 2 * HOUR).toISOString().slice(0, 10),
      mm: Number(total.toFixed(1)),
      past_hours: day < 0 ? 24 : day === 0 ? 12 : 0,
      hours: 24,
    });
  }
  return { hourly, daily };
}
