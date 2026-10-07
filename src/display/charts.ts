import { num } from '../format';

export const SERIES = { a: '#C4851A', b: '#5B93E8' };

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Vertical bars from a zero baseline (HTML so it stretches to any box); supports negative values. */
export function columnChart(values: number[], labels: (string | number)[]): string {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const range = hi - lo || 1;
  const max = hi + range * 0.22;
  const min = lo < 0 ? lo - range * 0.28 : 0;
  const span = max - min;
  const zero = (-min / span) * 100;
  const cols = values
    .map((v, i) => {
      const h = (Math.abs(v) / span) * 100;
      const last = i === values.length - 1;
      const pos = v >= 0 ? `bottom:${zero}%;height:${h}%` : `bottom:${zero - h}%;height:${h}%`;
      return `<div class="col${last ? ' last' : ''}">
        <div class="col-plot">
          <div class="col-bar${v < 0 ? ' neg' : ''}" style="${pos};background:${SERIES.a}">
            <span class="col-val">${num(v, 1)}</span>
          </div>
        </div>
        <div class="col-axis">${esc(String(labels[i]))}</div>
      </div>`;
    })
    .join('');
  return `<div class="cols" role="img" style="--zero:${zero}%">${cols}</div>`;
}

/** Horizontal bars, one series, direct labels. */
export function barList(items: [string, number][], unit = '%', color = SERIES.a): string {
  const max = Math.max(...items.map(([, v]) => v)) || 1;
  return `<div class="barlist">${items
    .map(
      ([label, v]) => `<div class="bl-row">
        <div class="bl-label">${esc(label)}</div>
        <div class="bl-track"><div class="bl-bar" style="width:${(v / max) * 100}%;background:${color}"></div></div>
        <div class="bl-val">${num(v, v < 10 ? 1 : 0)} ${unit}</div>
      </div>`,
    )
    .join('')}</div>`;
}

/** Two labelled bars on a shared scale (e.g. export vs import). */
export function pairBars(a: { label: string; value: number }, b: { label: string; value: number }, unit: string): string {
  const max = Math.max(a.value, b.value) || 1;
  const row = (r: { label: string; value: number }, color: string) => `<div class="bl-row">
      <div class="bl-label"><span class="swatch" style="background:${color}"></span>${esc(r.label)}</div>
      <div class="bl-track"><div class="bl-bar" style="width:${(r.value / max) * 100}%;background:${color}"></div></div>
      <div class="bl-val">${num(r.value, r.value < 10 ? 1 : 0)} ${unit}</div>
    </div>`;
  return `<div class="barlist pair">${row(a, SERIES.a)}${row(b, SERIES.b)}</div>`;
}

export function meter(pctValue: number): string {
  return `<div class="meter"><div class="meter-fill" style="width:${Math.max(0, Math.min(100, pctValue))}%"></div></div>`;
}
