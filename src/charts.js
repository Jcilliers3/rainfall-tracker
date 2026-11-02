import { h, mm, niceTicks } from './util.js';

const SVG = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text != null) el.textContent = text;
  return el;
}

const column = (x, y, width, height) => {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
};

// items: [{ label, tip, value, forecast }]. tickEvery sets how often the x axis is labelled.
export function columnChart({ items, tickEvery, height = 190, summary, markNow = false }) {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tip', hidden: true });

  const draw = () => {
    wrap.replaceChildren(tip);
    const width = Math.max(wrap.clientWidth, 280);
    const box = { left: 38, right: 4, top: 12, bottom: 24 };
    const plotW = width - box.left - box.right;
    const plotH = height - box.top - box.bottom;
    const ticks = niceTicks(Math.max(...items.map((item) => item.value), 0));
    const top = ticks.at(-1);
    const y = (value) => box.top + plotH - (value / top) * plotH;
    const slot = plotW / items.length;
    const barW = Math.max(Math.min(24, slot - 2), 1);

    const svg = s('svg', { width, height, role: 'img', 'aria-label': summary });
    for (const tick of ticks) {
      svg.append(
        s('line', { class: tick ? 'grid' : 'base', x1: box.left, x2: width - box.right, y1: y(tick), y2: y(tick) }),
        s('text', { class: 'axis', x: box.left - 8, y: y(tick) + 4, 'text-anchor': 'end' }, tick),
      );
    }

    items.forEach((item, index) => {
      const x = box.left + index * slot + (slot - barW) / 2;
      if (item.value > 0) {
        svg.append(s('path', {
          class: item.forecast ? 'mark forecast' : 'mark',
          d: column(x, y(item.value), barW, Math.max(y(0) - y(item.value), 1)),
        }));
      }
      if (index % tickEvery === 0) {
        svg.append(s('text', {
          class: 'axis', x: box.left + index * slot + slot / 2, y: height - 6, 'text-anchor': 'middle',
        }, item.label));
      }
      const hit = s('rect', { x: box.left + index * slot, y: box.top, width: slot, height: plotH, fill: 'transparent' });
      hit.addEventListener('pointerenter', () => {
        tip.hidden = false;
        tip.textContent = `${item.tip}: ${mm(item.value)} mm${item.forecast ? ' (forecast)' : ''}`;
        const left = Math.min(Math.max(x + barW / 2 - tip.offsetWidth / 2, 0), width - tip.offsetWidth);
        tip.style.transform = `translate(${left}px, 0)`;
      });
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.append(hit);
    });
    const firstForecast = items.findIndex((item) => item.forecast);
    if (markNow && firstForecast > 0) {
      const x = box.left + firstForecast * slot;
      svg.append(
        s('line', { class: 'now', x1: x, x2: x, y1: box.top, y2: y(0) }),
        s('text', { class: 'axis', x: x + 5, y: box.top + 10 }, 'Now'),
      );
    }
    wrap.append(svg);
  };

  requestAnimationFrame(draw);
  new ResizeObserver(() => { if (wrap.isConnected) draw(); }).observe(wrap);
  return wrap;
}
