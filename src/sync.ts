import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import type { Msg } from './types';

type Handler = (msg: Msg) => void;
export type SyncStatus = 'online' | 'local' | 'offline';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const ROOM = (import.meta.env.VITE_ROOM as string | undefined) || 'handelsklotet-main';

export function connect(onMsg: Handler, onStatus: (s: SyncStatus) => void) {
  const local = new BroadcastChannel(ROOM);
  local.onmessage = (e) => onMsg(e.data as Msg);
  let channel: RealtimeChannel | null = null;

  if (URL && KEY) {
    const client = createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 20 } } });
    channel = client.channel(ROOM, { config: { broadcast: { self: false, ack: false } } });
    channel
      .on('broadcast', { event: 'msg' }, ({ payload }) => onMsg(payload as Msg))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') onStatus('online');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus('offline');
      });
  } else {
    queueMicrotask(() => onStatus('local'));
  }

  return {
    send(msg: Msg) {
      local.postMessage(msg);
      channel?.send({ type: 'broadcast', event: 'msg', payload: msg });
    },
  };
}
