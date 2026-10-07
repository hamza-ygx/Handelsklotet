import { pipeline, redisEnabled } from './_redis';

const TTL = 6 * 3600;
const TABS = ['oversikt', 'handel', 'finans', 'ehandel', 'sverige'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function roomKey(room: string | null) {
  return room && /^[\w-]{1,64}$/.test(room) ? `hk:${room}` : null;
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

// GET ?room=x&role=display&after=N → commands newer than N
// GET ?room=x&role=remote          → latest display state
export async function GET(request: Request) {
  if (!redisEnabled) return json({ enabled: false });
  const url = new URL(request.url);
  const k = roomKey(url.searchParams.get('room'));
  if (!k) return json({ error: 'bad room' }, 400);

  if (url.searchParams.get('role') === 'display') {
    const after = Number(url.searchParams.get('after') ?? '-1');
    const [seq, raw] = (await pipeline([['GET', `${k}:seq`], ['LRANGE', `${k}:cmds`, 0, -1]])) as [string | null, string[]];
    const cmds = (raw ?? []).map((s) => JSON.parse(s)).filter((c) => c.id > after);
    return json({ enabled: true, last: Number(seq ?? 0), cmds });
  }
  const [state] = (await pipeline([['GET', `${k}:state`]])) as [string | null];
  return json({ enabled: true, state: state ? JSON.parse(state) : null });
}

export async function POST(request: Request) {
  if (!redisEnabled) return json({ enabled: false }, 503);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const k = roomKey(body?.room);
  const msg = body?.msg;
  if (!k || !validMsg(msg)) return json({ error: 'bad message' }, 400);

  if (msg.t === 'state') {
    await pipeline([['SET', `${k}:state`, JSON.stringify({ ...msg, at: Date.now() }), 'EX', TTL]]);
    return json({ ok: true });
  }
  const [id] = (await pipeline([['INCR', `${k}:seq`], ['EXPIRE', `${k}:seq`, TTL]])) as [number];
  await pipeline([
    ['RPUSH', `${k}:cmds`, JSON.stringify({ id, msg })],
    ['LTRIM', `${k}:cmds`, -30, -1],
    ['EXPIRE', `${k}:cmds`, TTL],
  ]);
  return json({ ok: true, id });
}
