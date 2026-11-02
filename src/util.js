// Builds DOM nodes. Text always goes in as text, so town names can't inject HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const TZ = 'Africa/Johannesburg';
const format = (options) => new Intl.DateTimeFormat('en-ZA', { timeZone: TZ, ...options });
const timeFormat = format({ hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormat = format({ day: 'numeric', month: 'short' });
const weekdayFormat = format({ weekday: 'short', day: 'numeric', month: 'short' });

export const formatTime = (value) => timeFormat.format(new Date(value));
export const formatDate = (value) => dateFormat.format(new Date(value));
export const formatDay = (value) => weekdayFormat.format(new Date(`${value}T12:00:00+02:00`));
export const formatHour = (value) => `${weekdayFormat.format(new Date(value))}, ${timeFormat.format(new Date(value))}`;

export function formatStamp(value) {
  const date = new Date(value);
  const today = dateFormat.format(new Date()) === dateFormat.format(date);
  return today ? `today at ${formatTime(date)}` : `${formatDate(date)} at ${formatTime(date)}`;
}

export const mm = (value) => Number(value).toFixed(1);

// Rounds a maximum up to a tidy value and returns evenly spaced axis ticks.
export function niceTicks(max, count = 4) {
  const top = Math.max(max, 1);
  const rough = top / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  const ticks = [];
  for (let value = 0; value < top + step * 0.999; value += step) ticks.push(Number(value.toFixed(4)));
  return ticks;
}

export function downloadCsv(filename, rows) {
  const cell = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = rows.map((row) => row.map(cell).join(',')).join('\n');
  const link = h('a', {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: filename,
  });
  link.click();
  URL.revokeObjectURL(link.href);
}
