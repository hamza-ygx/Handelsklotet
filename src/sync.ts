import Peer, { type DataConnection } from 'peerjs';
import type { Msg } from './types';

/**
 * iPad ↔ display sync over a direct WebRTC data channel (PeerJS).
 * The display registers a peer id and shows it as a QR code; the remote opens
 * /remote#<id> and connects straight to it. No database or backend involved.
 * BroadcastChannel is kept so two tabs in one browser also work offline.
 */

export type LinkStatus = 'online' | 'connecting' | 'offline' | 'unpaired';
type Handler = (msg: Msg) => void;

const ID_KEY = 'handelsklotet-display-id';
const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 7000;
const local = new BroadcastChannel('handelsklotet');

// Optional self-hosted PeerJS server (default: the free public 0.peerjs.com).
const env = import.meta.env;
const PEER_OPTS = env.VITE_PEER_HOST
  ? {
      host: env.VITE_PEER_HOST as string,
      port: Number(env.VITE_PEER_PORT || 443),
      path: (env.VITE_PEER_PATH as string) || '/',
      secure: env.VITE_PEER_SECURE !== 'false',
    }
  : {};

function newId() {
  return `hk-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function storedId() {
  try {
    const id = localStorage.getItem(ID_KEY);
    if (id && /^hk-[a-f0-9]{12}$/.test(id)) return id;
  } catch {
    /* storage blocked */
  }
  const id = newId();
  try {
    localStorage.setItem(ID_KEY, id);
  } catch {
    /* storage blocked */
  }
  return id;
}

/** Display side: owns the session id, accepts controllers, broadcasts state. */
export function host(opts: {
  onMsg: Handler;
  onPairUrl: (url: string) => void;
  onControllers: (count: number) => void;
  onStatus: (s: LinkStatus) => void;
}) {
  local.onmessage = (e) => opts.onMsg(e.data as Msg);
  const conns = new Map<DataConnection, number>();
  let id = storedId();
  let peer: Peer;
  let takenRetries = 0;

  const changed = () => opts.onControllers(conns.size);
  const drop = (c: DataConnection) => {
    if (!conns.delete(c)) return;
    c.close();
    changed();
  };

  function start() {
    peer = new Peer(id, { debug: 0, ...PEER_OPTS });
    peer.on('open', () => {
      takenRetries = 0;
      opts.onStatus('online');
      opts.onPairUrl(`${location.origin}/remote#${id}`);
    });
    peer.on('connection', (c) => {
      c.on('open', () => {
        conns.set(c, Date.now());
        changed();
      });
      c.on('data', (d) => {
        conns.set(c, Date.now());
        const m = d as Msg;
        if (m.t === 'ping' || m.t === 'pong') return;
        opts.onMsg(m);
      });
      c.on('close', () => drop(c));
      c.on('error', () => drop(c));
    });
    peer.on('disconnected', () => {
      opts.onStatus('connecting');
      setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // id still held by a previous tab: retry, then fall back to a fresh one
        peer.destroy();
        if (++takenRetries > 3) {
          id = newId();
          try {
            localStorage.setItem(ID_KEY, id);
          } catch {
            /* storage blocked */
          }
        }
        setTimeout(start, 2500);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
        opts.onStatus('offline');
        if (peer.destroyed) setTimeout(start, 4000);
      }
    });
  }
  start();

  setInterval(() => {
    const now = Date.now();
    for (const [c, seen] of conns) {
      if (now - seen > TIMEOUT_MS) drop(c);
      else c.send({ t: 'ping' } satisfies Msg);
    }
  }, HEARTBEAT_MS);

  return {
    send(msg: Msg) {
      local.postMessage(msg);
      for (const c of conns.keys()) if (c.open) c.send(msg);
    },
  };
}

/** Remote side: connects to the display id from the URL hash and keeps reconnecting. */
export function join(opts: { onMsg: Handler; onStatus: (s: LinkStatus) => void }) {
  local.onmessage = (e) => opts.onMsg(e.data as Msg);
  const target = location.hash.slice(1);
  let conn: DataConnection | null = null;
  let lastData = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;

  if (!/^hk-[a-f0-9]{12}$/.test(target)) {
    queueMicrotask(() => opts.onStatus('unpaired'));
    return { send: (msg: Msg) => local.postMessage(msg) };
  }

  const peer = new Peer({ debug: 0, ...PEER_OPTS });
  const schedule = (ms: number) => {
    if (retry) clearTimeout(retry);
    retry = setTimeout(connect, ms);
  };

  function connect() {
    retry = null;
    if (peer.destroyed) return;
    if (peer.disconnected) {
      peer.reconnect();
      return;
    }
    if (conn?.open) return;
    conn?.close();
    opts.onStatus('connecting');
    const c = peer.connect(target, { reliable: true });
    conn = c;
    const giveUp = setTimeout(() => !c.open && schedule(0), 8000);
    c.on('open', () => {
      clearTimeout(giveUp);
      lastData = Date.now();
      opts.onStatus('online');
      c.send({ t: 'hello' } satisfies Msg);
    });
    c.on('data', (d) => {
      lastData = Date.now();
      const m = d as Msg;
      if (m.t === 'ping') c.send({ t: 'pong' } satisfies Msg);
      else if (m.t !== 'pong') opts.onMsg(m);
    });
    c.on('close', () => {
      if (conn === c) {
        opts.onStatus('connecting');
        schedule(1500);
      }
    });
  }

  peer.on('open', () => connect());
  peer.on('disconnected', () => schedule(1500));
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      opts.onStatus('connecting');
      schedule(2500);
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
      opts.onStatus('offline');
      schedule(3000);
    }
  });

  setInterval(() => {
    if (conn?.open && Date.now() - lastData > TIMEOUT_MS) {
      conn.close();
      schedule(0);
    }
  }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !conn?.open) schedule(0);
  });
  // closing the page tells the display right away so the QR code returns
  window.addEventListener('pagehide', () => conn?.close());

  return {
    send(msg: Msg) {
      local.postMessage(msg);
      if (conn?.open) conn.send(msg);
    },
  };
}
