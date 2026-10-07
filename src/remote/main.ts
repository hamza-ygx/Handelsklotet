import '../styles/remote.css';
import { geoArea, geoAzimuthalEqualArea, geoCentroid, geoPath } from 'd3-geo';
import type { FeatureCollection } from 'geojson';
import { BY_ISO, COUNTRIES } from '../data/countries';
import { loadCountries, type CountryFeature } from '../geo';
import { join, type LinkStatus } from '../sync';
import { TABS, type Msg, type Region, type TabId } from '../types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SVGNS = 'http://www.w3.org/2000/svg';
const REGIONS: Region[] = ['Östasien', 'Sydostasien', 'Sydasien', 'Västasien', 'Europa'];

const view = { iso: null as string | null, tab: 'oversikt' as TabId, busy: false, lastSeen: 0 };
let lockUntil = 0;

let syncMode: LinkStatus = 'connecting';
const sync = join({
  onMsg,
  onStatus: (s) => {
    syncMode = s;
    render();
  },
});

function onMsg(m: Msg) {
  if (m.t !== 'state') return;
  view.iso = m.iso;
  view.tab = m.tab;
  view.busy = m.busy;
  view.lastSeen = Date.now();
  render();
}

function send(m: Msg) {
  const now = Date.now();
  if (now < lockUntil) return;
  lockUntil = now + 450;
  if (m.t === 'select') view.iso = m.iso;
  if (m.t === 'tab') view.tab = m.tab;
  sync.send(m);
  render();
}

/* ---------- Map ---------- */
function buildMap(features: CountryFeature[]) {
  const host = $('map');
  const hl = features.filter((f) => f.properties.hl);
  const proj = geoAzimuthalEqualArea().rotate([-82, -38]);
  const svg = document.createElementNS(SVGNS, 'svg');
  const W = 1000, H = 760;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  proj.fitExtent([[20, 20], [W - 20, H - 20]], { type: 'FeatureCollection', features: hl } as FeatureCollection);
  const path = geoPath(proj);

  const gOther = document.createElementNS(SVGNS, 'g');
  const gHl = document.createElementNS(SVGNS, 'g');
  const gClick = document.createElementNS(SVGNS, 'g');
  const gDots = document.createElementNS(SVGNS, 'g');

  for (const f of features) {
    const d = path(f);
    if (!d) continue;
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    if (f.clickable) {
      p.setAttribute('class', 'm-click');
      p.dataset.iso = f.properties.iso;
      gClick.appendChild(p);
      if (geoArea(f) < 0.0003) {
        const [x, y] = proj(geoCentroid(f)) ?? [0, 0];
        const c = document.createElementNS(SVGNS, 'circle');
        c.setAttribute('cx', String(x));
        c.setAttribute('cy', String(y));
        c.setAttribute('r', '13');
        c.setAttribute('class', 'm-dot');
        c.dataset.iso = f.properties.iso;
        gDots.appendChild(c);
      }
    } else {
      p.setAttribute('class', f.properties.hl ? 'm-hl' : 'm-other');
      (f.properties.hl ? gHl : gOther).appendChild(p);
    }
  }
  svg.append(gOther, gHl, gClick, gDots);
  svg.addEventListener('click', (e) => {
    const iso = (e.target as SVGElement).dataset?.iso;
    if (iso) send({ t: 'select', iso });
  });
  host.replaceChildren(svg);
}

/* ---------- List ---------- */
function buildList() {
  const host = $('list');
  host.innerHTML = REGIONS.map((r) => {
    const items = COUNTRIES.filter((c) => c.region === r);
    if (!items.length) return '';
    return `<div class="group"><div class="group-title">${r}</div><div class="grid">${items
      .map(
        (c) => `<button type="button" class="country" data-iso="${c.iso}">
          <img src="/flags/${c.iso.toLowerCase()}.svg" alt=""/><span>${c.name}</span></button>`,
      )
      .join('')}</div></div>`;
  }).join('');
  host.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button.country');
    if (b?.dataset.iso) send({ t: 'select', iso: b.dataset.iso });
  });
}

function buildControl() {
  $('tabs').innerHTML = TABS.map((t) => `<button type="button" data-tab="${t.id}">${t.label}</button>`).join('');
  $('tabs').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (b?.dataset.tab) send({ t: 'tab', tab: b.dataset.tab as TabId });
  });
  $('close').addEventListener('click', () => send({ t: 'close' }));
}

/* ---------- Render ---------- */
function render() {
  const c = view.iso ? BY_ISO.get(view.iso) : null;
  $('control').hidden = !c;
  document.body.classList.toggle('open', !!c);
  const fresh = Date.now() - view.lastSeen < 10000;
  document.body.classList.toggle('busy', view.busy && fresh);
  $('prompt').textContent = c ? 'Byt flik eller välj ett annat land' : 'Tryck på ett land för att utforska det';
  if (c) {
    ($('cur-flag') as HTMLImageElement).src = `/flags/${c.iso.toLowerCase()}.svg`;
    $('cur-name').textContent = c.name;
  }
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === view.tab));
  document.querySelectorAll<HTMLElement>('[data-iso]').forEach((el) => el.classList.toggle('selected', el.dataset.iso === view.iso));

  const conn = $('conn');
  const alive = syncMode === 'online';
  document.body.classList.toggle('unpaired', syncMode === 'unpaired');
  conn.dataset.state = alive ? 'ok' : syncMode === 'connecting' ? 'wait' : 'bad';
  conn.querySelector('em')!.textContent = {
    online: 'Ansluten',
    connecting: 'Ansluter till skärmen…',
    offline: 'Nätverksfel – kontrollera wifi',
    unpaired: 'Inte parkopplad',
  }[syncMode];
}

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

buildControl();
buildList();
buildMap(await loadCountries());
render();
setInterval(() => {
  if (Date.now() - view.lastSeen > 6000) sync.send({ t: 'hello' });
  render();
}, 3000);
