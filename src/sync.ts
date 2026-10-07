import type { Msg } from './types';

type Handler = (msg: Msg) => void;
export type SyncStatus = 'online' | 'local' | 'offline';
export type Role = 'display' | 'remote';

const ROOM = (import.meta.env.VITE_ROOM as string | undefined) || 'main';
const API = '/api/sync';
const POLL_MS = { display: 250, remote: 800 };

export function connect(role: Role, onMsg: Handler, onStatus: (s: SyncStatus) => void) {
  const local = new BroadcastChannel(`handelsklotet-${ROOM}`);
  local.onmessage = (e) => onMsg(e.data as Msg);

  let remoteOn = false;
  let after = -1;
  const seen = new Set<number>();
  let floor = Infinity;
  let failures = 0;
  let lastStateAt = 0;

  async function poll() {
    try {
      const q = new URLSearchParams({ room: ROOM, role });
      if (role === 'display') q.set('after', String(Math.max(0, after)));
      const r = await fetch(`${API}?${q}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      if (!r.headers.get('content-type')?.includes('json')) {
        onStatus('local');
        return;
      }
      const j = await r.json();
      if (!j.enabled) {
        onStatus('local');
        return;
      }
      if (!remoteOn) {
        remoteOn = true;
        onStatus('online');
        if (role === 'display') {
          // ignore commands that were sent before this screen opened
          after = j.last;
          floor = j.last;
        }
      }
      failures = 0;
      if (role === 'display') {
        for (const c of (j.cmds as { id: number; msg: Msg }[]).sort((a, b) => a.id - b.id)) {
          if (seen.has(c.id) || c.id <= floor) continue;
          seen.add(c.id);
          after = Math.max(after, c.id);
          onMsg(c.msg);
        }
      } else if (j.state && j.state.at !== lastStateAt) {
        lastStateAt = j.state.at;
        if (Date.now() - j.state.at < 15000) onMsg(j.state as Msg);
      }
    } catch {
      if (++failures === 3) onStatus('offline');
    }
    if (remoteOn || failures) setTimeout(poll, failures ? Math.min(4000, 400 * failures) : POLL_MS[role]);
  }

  // non-Vercel environments (vite dev) have no /api: stay local-only
  queueMicrotask(() => {
    onStatus('local');
    void poll();
  });

  return {
    send(msg: Msg) {
      local.postMessage(msg);
      if (!remoteOn || msg.t === 'hello') return;
      void fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: ROOM, msg }),
        keepalive: true,
      }).catch(() => {});
    },
  };
}
