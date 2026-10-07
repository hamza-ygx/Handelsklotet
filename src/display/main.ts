import '../styles/display.css';
import { BY_ISO } from '../data/countries';
import { loadCountries } from '../geo';
import { loadFx } from '../fx';
import { loadPhotos } from '../photos';
import { connect, type SyncStatus } from '../sync';
import type { Msg, TabId } from '../types';
import { GlobeView, wait, type Pt } from './globe';
import { Panel } from './panel';
import { Particles } from './particles';

type Req = { t: 'select'; iso: string } | { t: 'close' };

const state = { iso: null as string | null, tab: 'oversikt' as TabId, busy: false };
let pending: Req | null = null;
let homePoints: Pt[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const panelEl = $('panel');
const statusEl = $('status');

let sync: ReturnType<typeof connect> | null = null;

function broadcast() {
  sync?.send({ t: 'state', iso: state.iso, tab: state.tab, busy: state.busy });
}

function setBusy(b: boolean) {
  state.busy = b;
  document.body.classList.toggle('busy', b);
  broadcast();
}

function onMsg(msg: Msg) {
  switch (msg.t) {
    case 'select':
      request({ t: 'select', iso: msg.iso });
      break;
    case 'close':
      request({ t: 'close' });
      break;
    case 'tab':
      setTab(msg.tab);
      break;
    case 'hello':
      broadcast();
      break;
  }
}

function setTab(tab: TabId) {
  state.tab = tab;
  panel.setTab(tab);
  broadcast();
}

function request(r: Req) {
  if (state.busy) {
    pending = r;
    return;
  }
  void run(r);
}

async function run(r: Req) {
  if (r.t === 'select') {
    if (r.iso === state.iso || !BY_ISO.has(r.iso)) return;
    setBusy(true);
    if (state.iso) await closeCurrent(true);
    await openCountry(r.iso);
  } else {
    if (!state.iso) return;
    setBusy(true);
    await closeCurrent(false);
  }
  setBusy(false);
  const next = pending;
  pending = null;
  if (next) request(next);
}

async function openCountry(iso: string) {
  const c = BY_ISO.get(iso)!;
  document.body.classList.add('focused');
  await globe.focus(iso);
  await globe.lift(iso);
  homePoints = globe.sample(iso, 1400);
  globe.hide(iso);

  state.iso = iso;
  state.tab = 'oversikt';
  panel.render(c, state.tab);
  broadcast();

  let shown = false;
  await particles.fly(homePoints, panel.rect(), 'out', 1700, (t) => {
    if (!shown && t > 0.62) {
      shown = true;
      panel.show();
      document.body.classList.add('panel-open');
    }
  });
  // the panel covers the globe: stop rendering it until the panel closes
  await wait(700);
  if (state.iso === iso) globe.setPaused(true);
}

async function closeCurrent(switching: boolean) {
  globe.setPaused(false);
  const rect = panel.rect();
  panel.hide();
  document.body.classList.remove('panel-open');
  if (switching) {
    await wait(250);
  } else {
    await particles.fly(homePoints, rect, 'in', 1300);
  }
  globe.hide(null);
  await globe.lift(null);
  state.iso = null;
  if (!switching) {
    document.body.classList.remove('focused');
    broadcast();
    await globe.release();
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') request({ t: 'close' });
  if (e.key === 'f') document.documentElement.requestFullscreen?.();
});

function drawStars() {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = window.innerWidth * dpr;
  c.height = window.innerHeight * dpr;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 700; i++) {
    const r = Math.random() ** 3 * 1.4 * dpr + 0.3;
    g.fillStyle = `rgba(${200 + Math.random() * 55},${210 + Math.random() * 45},255,${0.15 + Math.random() * 0.6})`;
    g.beginPath();
    g.arc(Math.random() * c.width, Math.random() * c.height, r, 0, Math.PI * 2);
    g.fill();
  }
  $('stars').replaceChildren(c);
}
drawStars();
window.addEventListener('resize', drawStars);

const features = await loadCountries();
const globe = new GlobeView(stage, features, (iso) => request({ t: 'select', iso }));
const particles = new Particles($('particles'));
const panel = new Panel(panelEl, (tab) => setTab(tab));

void loadPhotos();
void loadFx();
sync = connect('display', onMsg, (s: SyncStatus) => {
  statusEl.dataset.state = s;
  statusEl.title = { online: 'Ansluten', local: 'Lokalt läge (ingen synk mellan enheter)', offline: 'Frånkopplad' }[s];
  if (s === 'online') broadcast();
});
setInterval(broadcast, 4000);
broadcast();
document.body.classList.add('ready');
