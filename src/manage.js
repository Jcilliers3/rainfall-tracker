import { callAdmin, searchPlaces, usingSample } from './api.js';
import { formatStamp, h } from './util.js';

const STORE = 'rainfall-admin-key';

function savedKey() {
  try { return sessionStorage.getItem(STORE) ?? ''; } catch { return ''; }
}
function saveKey(value) {
  try { sessionStorage.setItem(STORE, value); } catch { /* the key then lasts until reload */ }
}

const page = { key: savedKey(), towns: null, message: null, error: null, results: null };

export function manageView() {
  const root = h('div', { class: 'manage' });

  const paint = () => {
    root.replaceChildren(
      h('h1', {}, 'Manage towns'),
      page.error ? h('p', { class: 'problem', role: 'alert' }, page.error) : null,
      page.message ? h('p', { class: 'done', role: 'status' }, page.message) : null,
      ...(page.towns ? tools() : [unlock()]),
    );
  };

  const run = async (action) => {
    page.error = null;
    page.message = null;
    try {
      await action();
    } catch (error) {
      page.error = error.message;
    }
    paint();
  };

  const load = async () => {
    page.towns = (await callAdmin(page.key, { action: 'list' })).towns;
    saveKey(page.key);
  };

  const add = (town) => run(async () => {
    await callAdmin(page.key, { action: 'add', ...town });
    await load();
    page.results = null;
    page.message = `Added ${town.name}. Its rainfall should appear within 15 minutes.`;
  });

  const setActive = (town, active) => run(async () => {
    await callAdmin(page.key, { action: 'set_active', id: town.id, active });
    await load();
    page.message = active
      ? `Resumed ${town.name}. Hours missed while paused stay blank.`
      : `Paused ${town.name}. Its history is kept.`;
  });

  function unlock() {
    if (usingSample) {
      return h('p', {}, 'Connect Supabase to manage towns. The site is showing sample data.');
    }
    const input = h('input', { type: 'password', id: 'admin-key', required: true, autocomplete: 'current-password', value: page.key });
    return h('form', {
      onSubmit: (event) => {
        event.preventDefault();
        page.key = input.value;
        run(load);
      },
    },
    h('label', { for: 'admin-key' }, 'Admin key'),
    input,
    h('button', { type: 'submit' }, 'Unlock'));
  }

  function searchForm() {
    const input = h('input', { type: 'search', id: 'town-search', required: true, minlength: 2, autocomplete: 'off' });
    return h('section', {},
      h('h2', {}, 'Search for a town'),
      h('form', {
        class: 'inline',
        onSubmit: (event) => {
          event.preventDefault();
          run(async () => { page.results = await searchPlaces(input.value.trim()); });
        },
      },
      h('label', { for: 'town-search' }, 'Town name'),
      input,
      h('button', { type: 'submit' }, 'Search')),
      page.results?.length === 0
        ? h('p', { class: 'note' }, 'No South African place has that name. Check the spelling or enter the coordinates below.')
        : null,
      page.results?.length
        ? h('ul', { class: 'results' }, page.results.map((place) => h('li', {},
          h('span', {}, h('b', {}, place.name), ` ${[place.admin2, place.admin1].filter(Boolean).join(', ')}`,
            h('small', {}, `${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)}`)),
          h('button', {
            type: 'button',
            onClick: () => add({ name: place.name, province: place.admin1 ?? '', lat: place.latitude, lon: place.longitude }),
          }, `Add ${place.name}`))))
        : null);
  }

  function coordinateForm() {
    const field = (name, label, attrs = {}) => h('p', {},
      h('label', { for: `new-${name}` }, label),
      h('input', { id: `new-${name}`, name, ...attrs }));
    return h('section', {},
      h('h2', {}, 'Add a place by coordinates'),
      h('p', { class: 'note' }, 'Use this for farms and places the search can’t find. Copy the numbers from Google Maps. South African latitudes are negative.'),
      h('form', {
        class: 'grid',
        onSubmit: (event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.target));
          add(data);
        },
      },
      field('name', 'Name', { required: true, maxlength: 80 }),
      field('province', 'Province'),
      field('lat', 'Latitude', { required: true, inputmode: 'decimal', placeholder: '-28.2308' }),
      field('lon', 'Longitude', { required: true, inputmode: 'decimal', placeholder: '28.3071' }),
      h('button', { type: 'submit' }, 'Add place')));
  }

  function townList() {
    return h('section', {},
      h('h2', {}, `Tracked towns (${page.towns.filter((town) => town.active).length})`),
      h('ul', { class: 'results' }, page.towns.map((town) => h('li', {},
        h('span', {}, h('b', {}, town.name), ` ${town.province}`, town.active ? '' : ' (paused)',
          h('small', {}, town.last_success_at ? `Updated ${formatStamp(town.last_success_at)}` : 'Waiting for first update')),
        h('button', {
          type: 'button',
          class: 'quiet',
          onClick: () => setActive(town, !town.active),
        }, town.active ? `Pause ${town.name}` : `Resume ${town.name}`)))));
  }

  function tools() {
    return [searchForm(), coordinateForm(), townList()];
  }

  paint();
  return root;
}
