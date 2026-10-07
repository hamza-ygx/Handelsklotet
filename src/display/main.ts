import '../styles/display.css';
import { BY_ISO } from '../data/countries';
import { loadCountries } from '../geo';
import { loadFx } from '../fx';
import { loadPhotos } from '../photos';
import { connect, type SyncStatus } from '../sync';
import type { Msg, TabId } from '../types';
import { GlobeView, wait, type Pt } from './globe';
import { Panel } from './panel';

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
  panel.render(c, 'oversikt');
  await globe.focus(iso);
  await globe.lift(iso);
  homePoints = globe.sample(iso, 2400);
  globe.hide(iso);

  state.iso = iso;
  state.tab = 'oversikt';
  broadcast();

  let shown = false;
  await globe.fly(homePoints, panel.rect(), 'out', 1900, (t) => {
    if (!shown && t > 0.6) {
      shown = true;
      panel.show();
      document.body.classList.add('panel-open');
    }
  });
  // the panel covers the globe: stop rendering it until the panel closes
  await wait(900);
  if (state.iso === iso) globe.setPaused(true);
}

async function closeCurrent(switching: boolean) {
  globe.setPaused(false);
  const rect = panel.rect();
  panel.hide();
  document.body.classList.remove('panel-open');
  if (switching) {
    globe.hide(null);
    await wait(320);
  } else {
    let restored = false;
    await globe.fly(homePoints, rect, 'in', 1500, (t) => {
      if (!restored && t > 0.72) {
        restored = true;
        globe.hide(null);
      }
    });
  }
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

const features = await loadCountries();
const globe = new GlobeView(stage, features, (iso) => request({ t: 'select', iso }));
const panel = new Panel(panelEl, (tab) => setTab(tab));

void loadPhotos();
void loadFx();
sync = connect('display', onMsg, (s: SyncStatus) => {
  statusEl.dataset.state = s;
  $('status-text').textContent = { online: '', local: 'Ingen synk – databasen är inte kopplad', offline: 'Nätverksfel – synk saknas' }[s];
  statusEl.title = { online: 'Ansluten', local: 'Lokalt läge (ingen synk mellan enheter)', offline: 'Frånkopplad' }[s];
  if (s === 'online') broadcast();
});
setInterval(broadcast, 4000);
broadcast();
await globe.ready;
requestAnimationFrame(() => document.body.classList.add('ready'));
