import { store } from './_store';

const TABS = ['oversikt', 'handel', 'finans', 'ehandel', 'sverige'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function validRoom(room: unknown): room is string {
  return typeof room === 'string' && /^[\w-]{1,64}$/.test(room);
}

function validMsg(m: any): boolean {
  if (!m || typeof m !== 'object') return false;
  switch (m.t) {
    case 'select':
      return typeof m.iso === 'string' && /^[A-Z]{2}$/.test(m.iso);
    case 'tab':
      return TABS.includes(m.tab);
    case 'close':
      return true;
    case 'state':
      return (m.iso === null || /^[A-Z]{2}$/.test(m.iso)) && TABS.includes(m.tab) && typeof m.busy === 'boolean';
    default:
      return false;
  }
}

function fail(e: unknown) {
  console.error('sync error', e);
  return json({ enabled: true, error: 'store unavailable' }, 502);
}

// GET ?room=x&role=display&after=N → commands newer than N
// GET ?room=x&role=remote          → latest display state
export async function GET(request: Request) {
  if (!store) return json({ enabled: false });
  const url = new URL(request.url);
  const room = url.searchParams.get('room');
  if (!validRoom(room)) return json({ error: 'bad room', store: store.kind }, 400);
  try {
    if (url.searchParams.get('role') === 'display') {
      const { last, cmds } = await store.cmds(room, Number(url.searchParams.get('after') ?? '0') || 0);
      return json({ enabled: true, store: store.kind, last, cmds });
    }
    return json({ enabled: true, store: store.kind, state: await store.getState(room) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  if (!store) return json({ enabled: false }, 503);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const msg = body?.msg;
  if (!validRoom(body?.room) || !validMsg(msg)) return json({ error: 'bad message' }, 400);
  try {
    if (msg.t === 'state') {
      await store.setState(body.room, { ...msg, at: Date.now() });
      return json({ ok: true });
    }
    return json({ ok: true, id: await store.push(body.room, msg) });
  } catch (e) {
    return fail(e);
  }
}
