import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type SqliteDatabase = import('better-sqlite3').Database

/**
 * SQLite 惰性单例。
 *
 * - 动态 import：原生模块只在首次访问房间数据时加载，SSR / 静态路由的冷启动不受影响；
 * - better-sqlite3 同步 API + WAL：读写微秒级，无需连接池；
 * - 预编译语句复用，避免每次请求重新 parse SQL；
 * - 初始化失败（只读文件系统 / 缺少原生二进制）时返回 null，应用自动降级为纯内存模式。
 */

const TABLE = `
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

export interface HoldemDb {
  raw: SqliteDatabase
  getRow(code: string): { version: number, data: string } | undefined
  putRow(code: string, version: number, data: string, updatedAt: number): void
  delRow(code: string): void
  purgeRows(before: number): void
}

let db: HoldemDb | null = null
let ready = false
let opening: Promise<HoldemDb | null> | null = null

function resolveDbPath(): string {
  // 显式配置优先；Vercel 等只读文件系统平台上只有 /tmp 可写
  if (process.env.NUXT_DB_PATH)
    return resolve(process.env.NUXT_DB_PATH)
  if (process.env.VERCEL || process.env.NITRO_PRESET === 'vercel')
    return '/tmp/holdem.sqlite'
  return resolve('.data/holdem.sqlite')
}

async function openDb(): Promise<HoldemDb | null> {
  try {
    const mod = await import('better-sqlite3')
    const Database = mod.default
    const file = resolveDbPath()
    mkdirSync(dirname(file), { recursive: true })
    const raw = new Database(file)
    raw.pragma('journal_mode = WAL')
    raw.pragma('synchronous = NORMAL')
    raw.exec(TABLE)
    const get = raw.prepare<[string], { version: number, data: string }>(
      'SELECT version, data FROM rooms WHERE code = ?',
    )
    const put = raw.prepare<[string, number, string, number]>(
      `INSERT INTO rooms (code, version, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(code) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
    )
    const del = raw.prepare<[string]>('DELETE FROM rooms WHERE code = ?')
    const purge = raw.prepare<[number]>('DELETE FROM rooms WHERE updated_at < ?')
    return {
      raw,
      getRow: code => get.get(code),
      putRow: (code, version, data, updatedAt) => put.run(code, version, data, updatedAt),
      delRow: code => del.run(code),
      purgeRows: before => purge.run(before),
    }
  }
  catch (err) {
    console.error('[holdem] SQLite 初始化失败，退化为内存存储（重启后房间不保留）:', err)
    return null
  }
}

/** 首次调用时打开数据库（进程内只此一次）；失败返回 null（内存模式） */
export async function ensureDb(): Promise<HoldemDb | null> {
  if (ready) return db
  opening ??= openDb()
  db = await opening
  ready = true
  return db
}

/** 同步访问已就绪的数据库；尚未加载完成或不可用时返回 null */
export function peekDb(): HoldemDb | null {
  return ready ? db : null
}
