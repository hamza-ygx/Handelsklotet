import type { Country, TabId } from '../types';
import { TABS } from '../types';
import { DATA_YEAR, SERIES_YEARS } from '../data/countries';
import { num, pct, people, sek, sekBn, usdBn } from '../format';
import { sekPer } from '../fx';
import { photoFor } from '../photos';
import { barList, columnChart, meter, pairBars } from './charts';

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const NUM_RE = /^([+−-]?)(\d[\d\s\u00a0\u202f]*(?:,\d+)?)(.*)$/;

/** Wrap the numeric part so it can count up; text values pass through. */
function countable(value: string) {
  const m = value.match(NUM_RE);
  if (!m) return esc(value);
  const n = Number(m[2].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  const d = m[2].includes(',') ? m[2].split(',')[1].length : 0;
  return `${esc(m[1])}<span class="n" data-v="${n}" data-d="${d}">${esc(m[2])}</span>${esc(m[3])}`;
}

function countUp(root: HTMLElement) {
  const els = [...root.querySelectorAll<HTMLElement>('.n')];
  if (!els.length) return;
  const t0 = performance.now();
  const ms = 1100;
  const fmt = els.map((el) => new Intl.NumberFormat('sv-SE', { minimumFractionDigits: +el.dataset.d!, maximumFractionDigits: +el.dataset.d! }));
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 4);
    els.forEach((el, i) => (el.textContent = fmt[i].format(+el.dataset.v! * e)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function kpi(label: string, value: string, unit = '', note = '', extra = '', text = false) {
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value${text ? ' kpi-text' : ''}">${text ? esc(value) : countable(value)}${unit ? `<span class="kpi-unit">${esc(unit)}</span>` : ''}</div>
    ${extra}
    ${note ? `<div class="kpi-note">${esc(note)}</div>` : ''}
  </div>`;
}

function chips(title: string, items: string[]) {
  return `<div class="chips-block"><div class="block-title">${esc(title)}</div>
    <div class="chips">${items.map((i) => `<span class="chip">${esc(i)}</span>`).join('')}</div></div>`;
}

function block(title: string, body: string, cls = '') {
  return `<div class="block ${cls}"><div class="block-title">${esc(title)}</div>${body}</div>`;
}

function overview(c: Country) {
  const m = c.macro;
  const gdp = usdBn(m.gdp);
  const pop = people(m.population);
  return `<div class="kpis">
      ${kpi('BNP', gdp.value, gdp.unit)}
      ${kpi('BNP-tillväxt', pct(m.growth))}
      ${kpi('BNP per invånare', num(m.gdpPerCapita), '$')}
      ${kpi('Befolkning', pop.value, pop.unit)}
      ${kpi('Inflation', pct(m.inflation))}
      ${kpi('Arbetslöshet', pct(m.unemployment))}
    </div>
    ${block(`BNP-tillväxt ${SERIES_YEARS[0]}–${SERIES_YEARS[SERIES_YEARS.length - 1]}, %`, columnChart(m.growthSeries, SERIES_YEARS), 'fill')}`;
}

function trade(c: Country) {
  const t = c.trade;
  const ex = usdBn(t.exports);
  const im = usdBn(t.imports);
  const bal = t.exports - t.imports;
  const b = usdBn(Math.abs(bal));
  return `<div class="kpis">
      ${kpi('Varuexport', ex.value, ex.unit)}
      ${kpi('Varuimport', im.value, im.unit)}
      ${kpi(bal >= 0 ? 'Handelsöverskott' : 'Handelsunderskott', `${bal >= 0 ? '+' : '−'}${b.value}`, b.unit)}
    </div>
    <div class="split">
      ${block('Största exportmarknader, andel av export', barList(t.partners))}
      ${chips('Viktigaste exportvaror', t.topExports)}
    </div>`;
}

function finance(c: Country) {
  const f = c.finance;
  const fx = sekPer(f.code, f.fxFallback);
  const fdi = f.fdi != null ? usdBn(f.fdi) : null;
  return `<div class="kpis">
      ${kpi('Valuta', f.code, '', f.currency)}
      ${f.code === 'SEK' ? kpi('Växelkurs', '—', '', 'Hemmavaluta') : kpi(`1 ${f.code}`, sek(fx.value), '', fx.live ? `ECB-kurs ${fx.date ?? ''}` : 'Ungefärlig kurs')}
      ${kpi('Styrränta', f.policyRate != null ? pct(f.policyRate, 2) : '—', '', f.policyNote ?? `Dec ${DATA_YEAR}`)}
      ${kpi('Börsindex', f.index, '', '', '', true)}
      ${kpi('Kreditbetyg', f.rating, '', '', '', true)}
      ${fdi ? kpi('Utländska direktinvesteringar', fdi.value, fdi.unit, `Inflöde ${DATA_YEAR}`) : kpi('Utländska direktinvesteringar', '—', '', 'Ej tillgängligt')}
    </div>`;
}

function ecom(c: Country) {
  const e = c.ecom;
  const mk = usdBn(e.market);
  return `<div class="kpis two">
      ${kpi('E-handelsmarknad', mk.value, mk.unit, `Ungefärlig omsättning ${DATA_YEAR}`)}
      ${kpi('Internetanvändare', pct(e.internet, 0), '', 'Andel av befolkningen', meter(e.internet))}
    </div>
    <div class="split">
      ${chips('Största plattformar', e.platforms)}
      ${chips('Så betalar man', e.payments)}
    </div>`;
}

function sweden(c: Country) {
  const s = c.sweden;
  const ex = sekBn(s.exports);
  const im = sekBn(s.imports);
  const isSe = c.iso === 'SE';
  return `<div class="kpis">
      ${kpi(isSe ? 'Export till Asien' : `Svensk export till ${c.name}`, ex.value, ex.unit)}
      ${kpi(isSe ? 'Import från Asien' : `Svensk import från ${c.name}`, im.value, im.unit)}
      <div class="kpi kpi-highlight"><div class="kpi-label">I korthet</div><div class="kpi-quote">${esc(s.note)}</div></div>
    </div>
    <div class="split">
      ${block(s.flowLabel ?? `Varuhandel Sverige – ${c.name}, mdr kr`, pairBars({ label: 'Export', value: s.exports }, { label: 'Import', value: s.imports }, 'mdr kr'))}
      ${chips(s.companiesLabel ?? 'Svenska företag på plats', s.companies)}
    </div>`;
}

const RENDER: Record<TabId, (c: Country) => string> = {
  oversikt: overview,
  handel: trade,
  finans: finance,
  ehandel: ecom,
  sverige: sweden,
};

export class Panel {
  private country: Country | null = null;
  private tab: TabId = 'oversikt';

  constructor(private el: HTMLElement, private onTab: (t: TabId) => void) {}

  rect() {
    return this.el.getBoundingClientRect();
  }

  render(c: Country, tab: TabId) {
    this.country = c;
    this.tab = tab;
    const photo = photoFor(c.iso);
    this.el.innerHTML = `
      <div class="panel-photo">
        ${photo ? `<img src="${esc(photo.src)}" alt="${esc(c.photo.caption)}" decoding="async"/>` : ''}
        <div class="photo-shade"></div>
        <div class="photo-caption">${esc(c.photo.caption)}</div>
        <div class="fact"><div class="eyebrow">Visste du?</div><p>${esc(c.fact)}</p></div>
        ${photo ? `<div class="credit">${esc(photo.credit)}</div>` : ''}
      </div>
      <div class="panel-body">
        <header class="panel-head">
          <img class="flag" src="/flags/${c.iso.toLowerCase()}.svg" alt=""/>
          <div>
            <h1>${esc(c.name)}</h1>
            <div class="sub">${esc(c.capital)} · ${esc(c.region)}</div>
          </div>
        </header>
        <p class="tagline">${esc(c.tagline)}</p>
        <nav class="tabs">${TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === tab ? 'active' : ''}">${t.label}</button>`).join('')}</nav>
        <section class="tab-content">${RENDER[tab](c)}</section>
        <footer class="panel-foot">Avrundade värden, senast tillgängliga år (${DATA_YEAR}). Källor: IMF, Världsbanken, SCB m.fl. Ej investeringsrådgivning.</footer>
      </div>`;
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
      b.addEventListener('click', () => this.onTab(b.dataset.tab as TabId)),
    );
  }

  setTab(tab: TabId) {
    if (!this.country || tab === this.tab) return;
    this.tab = tab;
    const content = this.el.querySelector('.tab-content') as HTMLElement;
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    content.classList.add('swap');
    setTimeout(() => {
      content.innerHTML = RENDER[tab](this.country!);
      content.classList.add('instant');
      content.classList.remove('swap');
      countUp(content);
    }, 160);
  }

  show() {
    this.el.classList.add('open');
    countUp(this.el);
  }

  hide() {
    this.el.classList.remove('open');
  }
}
