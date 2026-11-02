import '@fontsource-variable/schibsted-grotesk';
import './style.css';
import { getSummary, getTownDetail, usingSample } from './api.js';
import { columnChart } from './charts.js';
import { manageView } from './manage.js';
import { downloadCsv, formatDate, formatDay, formatHour, formatStamp, h, mm, niceTicks } from './util.js';

const PERIODS = [
  { id: '24h', label: 'Last 24 hours', phrase: 'in the last 24 hours', mm: 'mm_24h', hours: 'hours_24h', expected: () => 24 },
  { id: '7d', label: 'Last 7 days', phrase: 'in the last 7 days', mm: 'mm_7d', hours: 'hours_7d', expected: () => 168 },
  { id: '30d', label: 'Last 30 days', phrase: 'in the last 30 days', mm: 'mm_30d', hours: 'hours_30d', expected: () => 720 },
  { id: 'month', label: 'This month', phrase: 'this month', mm: 'mm_month', hours: 'hours_month', expected: (t) => t.expected_hours_month },
  { id: 'season', label: 'Since 1 July', phrase: 'since 1 July', mm: 'mm_season', hours: 'hours_season', expected: (t) => t.expected_hours_season },
  { id: 'next24', label: 'Next 24 hours', phrase: 'in the next 24 hours', mm: 'next_24h', forecast: true },
  { id: 'next7', label: 'Next 7 days', phrase: 'in the next 7 days', mm: 'next_7d', forecast: true },
];

const COLUMNS = [
  ['mm_24h', '24 hours'], ['mm_7d', '7 days'], ['mm_30d', '30 days'], ['mm_month', 'This month'],
  ['mm_season', 'Since 1 July'], ['next_24h', 'Next 24 hours'], ['next_7d', 'Next 7 days'],
];

const REFRESH_MS = 5 * 60_000;
const STALE_MS = 3 * 60 * 60_000;

const state = {
  towns: [],
  period: PERIODS[1],
  selected: null,
  sortKey: 'name',
  sortDown: false,
  error: null,
  loaded: false,
};

const app = document.getElementById('app');

const isPartial = (town, period) => !period.forecast && town[period.hours] < period.expected(town);

// A town with no data yet has no total. Showing 0.0 would look like a dry spell.
const hasData = (town) => Boolean(town.tracking_since);
const amount = (town, key) => (hasData(town) ? mm(town[key]) : 'No data');

function groupByProvince(towns) {
  const groups = new Map();
  for (const town of towns) {
    const key = town.province || 'Other towns';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(town);
  }
  return [...groups];
}

function headline(period) {
  const { towns } = state;
  if (!towns.length) return 'No towns are being tracked yet.';
  if (!towns.some(hasData)) return 'Waiting for the first rainfall data.';
  const wettest = towns.reduce((a, b) => (Number(b[period.mm]) > Number(a[period.mm]) ? b : a));
  const most = Number(wettest[period.mm]);
  if (most === 0) {
    return period.forecast ? `No rain is forecast ${period.phrase}.` : `No rain estimated ${period.phrase}.`;
  }
  return period.forecast
    ? `${wettest.name} expects the most rain ${period.phrase}: ${mm(most)} mm.`
    : `${wettest.name} has had the most rain ${period.phrase}: ${mm(most)} mm.`;
}

function periodPicker() {
  const button = (period) => h('button', {
    type: 'button',
    class: 'period',
    'aria-pressed': String(period === state.period),
    onClick: () => { state.period = period; render(); },
  }, period.label);

  return h('div', { class: 'periods' },
    h('div', { role: 'group', 'aria-label': 'Estimated rainfall so far' }, PERIODS.filter((p) => !p.forecast).map(button)),
    h('div', { role: 'group', 'aria-label': 'Forecast rainfall', class: 'ahead' }, PERIODS.filter((p) => p.forecast).map(button)),
  );
}

function gauge(town, period, top) {
  const value = Number(town[period.mm]);
  const partial = hasData(town) && isPartial(town, period);
  const selected = state.selected === town.id;
  return h('button', {
    type: 'button',
    class: `gauge${period.forecast ? ' forecast' : ''}`,
    'aria-pressed': String(selected),
    'aria-label': hasData(town)
      ? `${town.name}: ${mm(value)} mm ${period.phrase}${partial ? ', covers only part of this period' : ''}. Show details.`
      : `${town.name}: no data yet. Show details.`,
    style: `--fill:${Math.min(value / top, 1)}`,
    onClick: () => selectTown(town.id),
  },
  h('span', { class: 'value' }, hasData(town) ? mm(value) : '–', partial ? '*' : ''),
  h('span', { class: 'tube' }, h('span', { class: 'water' })),
  h('span', { class: 'name' }, town.name));
}

function gaugeWall() {
  const period = state.period;
  const ticks = niceTicks(Math.max(...state.towns.map((town) => Number(town[period.mm])), 0));
  const top = ticks.at(-1);
  const partial = state.towns.filter((town) => hasData(town) && isPartial(town, period));

  return h('section', { class: 'wall-section', 'aria-label': `Rainfall ${period.phrase} by town` },
    h('div', { class: 'wall' },
      h('div', { class: 'scale', 'aria-hidden': 'true' },
        ticks.map((tick) => h('span', { style: `--at:${tick / top}` }, h('b', {}, tick), tick === top ? ' mm' : ''))),
      groupByProvince(state.towns).map(([province, towns]) => h('div', { class: 'province' },
        h('h2', {}, province),
        h('div', { class: 'gauges' }, towns.map((town) => gauge(town, period, top)))))),
    partial.length ? h('p', { class: 'note' }, `* ${coverageNote(partial, period)}`) : null);
}

function coverageNote(partial, period) {
  const newest = partial.map((town) => town.tracking_since).filter(Boolean).sort().at(-1);
  const since = newest ? ` Tracking of the newest began on ${formatDate(newest)}.` : '';
  const who = partial.length === state.towns.length ? 'All totals cover' : `${partial.length} of ${state.towns.length} totals cover`;
  return `${who} only part of this period, so the true figure may be higher.${since}`;
}

async function selectTown(id) {
  state.selected = state.selected === id ? null : id;
  render();
  if (state.selected) document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function legend() {
  return h('p', { class: 'legend' },
    h('span', {}, h('i', { class: 'key' }), 'Estimated, already passed'),
    h('span', {}, h('i', { class: 'key forecast' }), 'Forecast'));
}

function dataTable(caption, header, rows) {
  return h('details', { class: 'data' },
    h('summary', {}, caption),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, header.map((text) => h('th', { scope: 'col' }, text)))),
      h('tbody', {}, rows.map((row) => h('tr', {}, row.map((text) => h('td', {}, text))))))));
}

function detailBody(detail, town) {
  const hourly = detail.hourly.map((row) => ({
    label: new Date(row.hour).toLocaleTimeString('en-ZA', {
      timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false,
    }) + 'h',
    tip: formatHour(row.hour),
    value: Number(row.mm),
    forecast: !row.is_past,
  }));
  const daily = detail.daily.map((row) => ({
    label: formatDay(row.day).replace(/^\w+,? /, ''),
    tip: formatDay(row.day),
    value: Number(row.mm),
    forecast: row.past_hours < row.hours,
  }));

  if (!hourly.length && !daily.length) {
    return [h('p', { class: 'note' }, `${town.name} has no rainfall data yet. It should appear within 15 minutes of being added.`)];
  }

  return [
    legend(),
    h('h3', {}, 'Hour by hour, two days either side of now'),
    columnChart({ items: hourly, tickEvery: 12, markNow: true, summary: `Hourly rainfall for ${town.name}. The table below has the values.` }),
    dataTable('Show hourly figures', ['Hour', 'Rain (mm)', 'Type'],
      hourly.map((row) => [row.tip, mm(row.value), row.forecast ? 'Forecast' : 'Estimated'])),
    h('h3', {}, 'Day by day'),
    columnChart({ items: daily, tickEvery: 7, summary: `Daily rainfall for ${town.name}. The table below has the values.` }),
    dataTable('Show daily figures', ['Day', 'Rain (mm)', 'Type'],
      daily.map((row) => [row.tip, mm(row.value), row.forecast ? 'Includes forecast' : 'Estimated'])),
  ];
}

function townPanel() {
  const town = state.towns.find((item) => item.id === state.selected);
  if (!town) return null;

  const body = h('div', {}, h('p', { class: 'note' }, 'Loading rainfall…'));
  getTownDetail(town.id)
    .then((detail) => body.replaceChildren(...detailBody(detail, town)))
    .catch((error) => body.replaceChildren(
      h('p', { class: 'problem' }, `The rainfall for ${town.name} could not be loaded: ${error.message}`)));

  return h('section', { id: 'detail', class: 'detail', 'aria-label': `${town.name} rainfall` },
    h('div', { class: 'detail-head' },
      h('h2', {}, town.name),
      h('button', { type: 'button', class: 'quiet', onClick: () => selectTown(town.id) }, 'Close')),
    body);
}

function townStatus(town) {
  if (town.last_error) return `Last update failed: ${town.last_error}`;
  if (!town.last_success_at) return 'Waiting for first update';
  if (Date.now() - new Date(town.last_success_at).getTime() > STALE_MS) {
    return `Not updated since ${formatStamp(town.last_success_at)}`;
  }
  return null;
}

function sortedTowns() {
  const list = [...state.towns];
  const { sortKey, sortDown } = state;
  list.sort((a, b) => (sortKey === 'name' ? a.name.localeCompare(b.name) : Number(a[sortKey]) - Number(b[sortKey])));
  return sortDown ? list.reverse() : list;
}

function sortHeader(key, label) {
  const active = state.sortKey === key;
  return h('th', { scope: 'col', 'aria-sort': active ? (state.sortDown ? 'descending' : 'ascending') : null },
    h('button', {
      type: 'button',
      onClick: () => {
        state.sortDown = active ? !state.sortDown : key !== 'name';
        state.sortKey = key;
        render();
      },
    }, label, active ? (state.sortDown ? ' ↓' : ' ↑') : ''));
}

function exportCsv() {
  downloadCsv(`rainfall-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Town', 'Province', ...COLUMNS.map(([, label]) => `${label} (mm)`), 'Last updated'],
    ...sortedTowns().map((town) => [
      town.name, town.province, ...COLUMNS.map(([key]) => (hasData(town) ? town[key] : '')), town.last_success_at,
    ]),
  ]);
}

function townTable() {
  return h('section', { class: 'table-section' },
    h('div', { class: 'table-head' },
      h('h2', {}, 'All totals in mm'),
      h('button', { type: 'button', class: 'quiet', onClick: exportCsv }, 'Download CSV')),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {},
        h('tr', {}, sortHeader('name', 'Town'), COLUMNS.map(([key, label]) => sortHeader(key, label)))),
      h('tbody', {}, sortedTowns().map((town) => {
        const status = townStatus(town);
        return h('tr', {},
          h('th', { scope: 'row' },
            h('button', { type: 'button', class: 'link', onClick: () => selectTown(town.id) }, town.name),
            status ? h('small', { class: 'problem' }, status) : null),
          COLUMNS.map(([key]) => {
            const period = PERIODS.find((p) => p.mm === key);
            const mark = hasData(town) && isPartial(town, period) ? '*' : '';
            return h('td', { class: period.forecast ? 'ahead-cell' : '' }, amount(town, key), mark);
          }));
      })))));
}

function lastUpdated() {
  const times = state.towns.map((town) => town.last_success_at).filter(Boolean).sort();
  return times.at(-1) ?? null;
}

function banners() {
  const items = [];
  if (usingSample) {
    items.push(h('p', { class: 'banner' }, 'Sample data. These numbers are invented. Connect Supabase to show real rainfall.'));
  }
  if (state.error) {
    items.push(h('p', { class: 'banner bad' }, `The latest rainfall could not be loaded: ${state.error}. The page will try again in 5 minutes.`));
  }
  const latest = lastUpdated();
  if (state.loaded && !usingSample && latest && Date.now() - new Date(latest).getTime() > STALE_MS) {
    items.push(h('p', { class: 'banner bad' }, `These figures are out of date. The last update was ${formatStamp(latest)}. Check that the Supabase project is running.`));
  }
  return items;
}

function footer() {
  return h('footer', {},
    h('p', {},
      'Totals are model estimates from Yr’s forecasts, not rain gauge readings, so what fell in town may differ. Forecast blocks beyond about two days are spread evenly across their hours. Days run on South African time.'),
    h('p', {},
      'Based on data from ', h('a', { href: 'https://www.met.no/en' }, 'MET Norway'), ' via ',
      h('a', { href: 'https://developer.yr.no/' }, 'Yr'), ', licensed under ',
      h('a', { href: 'https://creativecommons.org/licenses/by/4.0/' }, 'CC BY 4.0'),
      ' and summed into hourly, daily and period totals. Town search uses ',
      h('a', { href: 'https://www.geonames.org/' }, 'GeoNames'), ' data.'));
}

function dashboard() {
  if (!state.loaded) return [h('p', { class: 'note' }, 'Loading rainfall…')];
  if (!state.towns.length) {
    return [h('section', { class: 'empty' },
      h('h2', {}, 'No towns yet'),
      h('p', {}, 'Add your first town to start tracking rainfall.'),
      h('a', { href: '#/towns' }, 'Manage towns'))];
  }
  return [periodPicker(), gaugeWall(), townPanel(), townTable()];
}

function render() {
  const manage = location.hash === '#/towns';
  const latest = lastUpdated();
  const main = manage ? manageView() : dashboard();

  app.replaceChildren(
    ...banners(),
    h('header', {},
      h('div', { class: 'bar' },
        h('a', { class: 'brand', href: '#/' }, 'Rainfall tracker'),
        h('a', { href: manage ? '#/' : '#/towns' }, manage ? 'Back to rainfall' : 'Manage towns')),
      manage ? null : h('h1', {}, state.loaded ? headline(state.period) : 'Rainfall tracker'),
      !manage && latest ? h('p', { class: 'stamp' }, `Yr data last checked ${formatStamp(latest)}`) : null),
    h('main', {}, main),
    footer(),
  );
}

async function refresh() {
  try {
    state.towns = await getSummary();
    state.error = null;
  } catch (error) {
    state.error = error.message;
  }
  state.loaded = true;
  // Leave the page alone while someone is using a form on it.
  if (location.hash !== '#/towns') render();
}

window.addEventListener('hashchange', () => { refresh(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);

render();
refresh();
