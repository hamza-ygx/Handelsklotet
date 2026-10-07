import pg from 'pg';
import { pipeline, redisEnabled } from './_redis';

export interface Cmd {
  id: number;
  msg: unknown;
}

export interface Store {
  kind: 'redis' | 'postgres';
  /** Commands newer than `after` minus a small lookback (client de-duplicates by id). */
  cmds(room: string, after: number): Promise<{ last: number; cmds: Cmd[] }>;
  push(room: string, msg: unknown): Promise<number>;
  setState(room: string, msg: unknown): Promise<void>;
  getState(room: string): Promise<unknown | null>;
}

const TTL = 6 * 3600;

const redisStore: Store = {
  kind: 'redis',
  async cmds(room, after) {
    const k = `hk:${room}`;
    const [seq, raw] = (await pipeline([['GET', `${k}:seq`], ['LRANGE', `${k}:cmds`, 0, -1]])) as [string | null, string[]];
    const cmds = (raw ?? []).map((s) => JSON.parse(s) as Cmd).filter((c) => c.id > after - 10);
    return { last: Number(seq ?? 0), cmds };
  },
  async push(room, msg) {
    const k = `hk:${room}`;
    const [id] = (await pipeline([['INCR', `${k}:seq`], ['EXPIRE', `${k}:seq`, TTL]])) as [number];
    await pipeline([
      ['RPUSH', `${k}:cmds`, JSON.stringify({ id, msg })],
      ['LTRIM', `${k}:cmds`, -30, -1],
      ['EXPIRE', `${k}:cmds`, TTL],
    ]);
    return id;
  },
  async setState(room, msg) {
    await pipeline([['SET', `hk:${room}:state`, JSON.stringify(msg), 'EX', TTL]]);
  },
  async getState(room) {
    const [s] = (await pipeline([['GET', `hk:${room}:state`]])) as [string | null];
    return s ? JSON.parse(s) : null;
  },
};

// Postgres (Nile via the Vercel integration, or any POSTGRES_URL / DATABASE_URL)
const PG_URL = process.env.NILEDB_POSTGRES_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;

function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: PG_URL,
      user: process.env.NILEDB_USER || undefined,
      password: process.env.NILEDB_PASSWORD || undefined,
      ssl: /localhost|127\.0\.0\.1/.test(PG_URL ?? '') ? false : true,
      max: 3,
      idleTimeoutMillis: 20000,
    });
    pool.on('error', () => {
      /* dropped idle connection; the pool reconnects on next query */
    });
  }
  if (!ready) {
    const p = pool;
    ready = (async () => {
      await p.query(`CREATE TABLE IF NOT EXISTS hk_cmds (id BIGINT PRIMARY KEY, room TEXT NOT NULL, msg JSONB NOT NULL)`);
      await p.query(`CREATE TABLE IF NOT EXISTS hk_state (room TEXT PRIMARY KEY, msg JSONB NOT NULL, at BIGINT NOT NULL)`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready.then(() => pool!);
}

// ids are microsecond-ish timestamps; 3 s lookback covers out-of-order inserts
const LOOKBACK = 3_000_000;

const pgStore: Store = {
  kind: 'postgres',
  async cmds(room, after) {
    const p = await db();
    const { rows } = await p.query(
      `SELECT id::text AS id, msg, (SELECT COALESCE(MAX(id), 0)::text FROM hk_cmds WHERE room = $1) AS last
         FROM hk_cmds WHERE room = $1 AND id > $2 ORDER BY id DESC LIMIT 50`,
      [room, Math.max(0, after - LOOKBACK)],
    );
    let last = rows.length ? Number(rows[0].last) : 0;
    if (!rows.length) {
      const r = await p.query(`SELECT COALESCE(MAX(id), 0)::text AS last FROM hk_cmds WHERE room = $1`, [room]);
      last = Number(r.rows[0].last);
    }
    return { last, cmds: rows.map((r) => ({ id: Number(r.id), msg: r.msg })) };
  },
  async push(room, msg) {
    const p = await db();
    const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    await p.query(`INSERT INTO hk_cmds (id, room, msg) VALUES ($1, $2, $3)`, [id, room, JSON.stringify(msg)]);
    if (Math.random() < 0.1) await p.query(`DELETE FROM hk_cmds WHERE id < $1`, [(Date.now() - 600_000) * 1000]);
    return id;
  },
  async setState(room, msg) {
    const p = await db();
    await p.query(
      `INSERT INTO hk_state (room, msg, at) VALUES ($1, $2, $3)
         ON CONFLICT (room) DO UPDATE SET msg = EXCLUDED.msg, at = EXCLUDED.at`,
      [room, JSON.stringify(msg), Date.now()],
    );
  },
  async getState(room) {
    const p = await db();
    const { rows } = await p.query(`SELECT msg FROM hk_state WHERE room = $1`, [room]);
    return rows[0]?.msg ?? null;
  },
};

export const store: Store | null = redisEnabled ? redisStore : PG_URL ? pgStore : null;
