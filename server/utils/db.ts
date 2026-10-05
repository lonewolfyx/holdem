import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

type SqliteDatabase = import('better-sqlite3').Database

/**
 * 房间存储抽象：内存缓存之下的持久层。
 *
 * - 未配置 `NUXT_DB_URL`（或为 file: 路径）时使用本地 better-sqlite3 文件，
 *   适合 Node 自托管（带持久盘）；
 * - 配置 `NUXT_DB_URL=libsql://…`（Turso 等）时走纯 JS 的 libSQL HTTP 客户端，
 *   这是 Vercel 等 Serverless 多实例部署的唯一正确姿势——实例间共享状态；
 * - 初始化失败返回 null，应用自动降级为纯内存模式。
 *
 * 一致性模型：CAS（条件写入）——`casRow` 只在存储中的版本号等于期望值时写入，
 * 配合 rooms.ts 的「写前版本校验」保证多实例下不会用旧状态覆盖新状态。
 */

const TABLE = `
  CREATE TABLE IF NOT EXISTS rooms (
    code       TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

/** 已解散房间的墓碑：让成员端区分「房主解散」(410) 与「房间不存在」(404) */
const TOMBSTONE = `
  CREATE TABLE IF NOT EXISTS dissolved (
    code TEXT PRIMARY KEY,
    at   INTEGER NOT NULL
  )
`

export interface RoomRow {
  version: number
  data: string
}

export interface RoomStore {
  /** true = 跨实例共享的远端存储 */
  remote: boolean
  getVersion(code: string): Promise<number | undefined>
  getRow(code: string): Promise<RoomRow | undefined>
  /** 新建房间行（已存在同码房间则失败，返回 false） */
  createRow(code: string, version: number, data: string, updatedAt: number): Promise<boolean>
  /** 条件更新：仅当现有 version === expectedVersion 时写入；行不存在时失败（绝不复活已删除的房间） */
  casRow(code: string, expectedVersion: number, version: number, data: string, updatedAt: number): Promise<boolean>
  delRow(code: string): Promise<void>
  purgeRows(before: number): Promise<void>
  markDissolved(code: string, at: number): Promise<void>
  getDissolved(code: string): Promise<{ at: number } | undefined>
  purgeDissolved(before: number): Promise<void>
}

/** libSQL 客户端的最小结构面（web / node 入口均满足），便于测试注入 */
type LibsqlInValue = null | string | number | bigint | ArrayBuffer

export interface LibsqlLikeClient {
  execute(stmt: { sql: string, args?: LibsqlInValue[] }): Promise<{ rows: unknown, rowsAffected: number }>
}

export const ROOM_TABLE_SQL = TABLE
export const TOMBSTONE_TABLE_SQL = TOMBSTONE

let storePromise: Promise<RoomStore | null> | null = null

function resolveDbPath(): string {
  // 显式配置优先；Vercel 等只读文件系统平台上只有 /tmp 可写
  if (process.env.NUXT_DB_PATH)
    return resolve(process.env.NUXT_DB_PATH)
  if (process.env.VERCEL || process.env.NITRO_PRESET === 'vercel')
    return '/tmp/holdem.sqlite'
  return resolve('.data/holdem.sqlite')
}

/* ---------------------------------- file: 本地实现（better-sqlite3） ---------------------------------- */

async function createFileStore(file: string): Promise<RoomStore> {
  const { default: Database } = await import('better-sqlite3')
  mkdirSync(dirname(file), { recursive: true })
  const raw = new Database(file)
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = NORMAL')
  raw.pragma('busy_timeout = 5000')
  raw.exec(TABLE)
  raw.exec(TOMBSTONE)

  const getVersion = raw.prepare<[string], { version: number }>('SELECT version FROM rooms WHERE code = ?')
  const getRow = raw.prepare<[string], { version: number, data: string }>('SELECT version, data FROM rooms WHERE code = ?')
  const createRow = raw.prepare<[string, number, string, number]>(
    'INSERT OR IGNORE INTO rooms (code, version, data, updated_at) VALUES (?, ?, ?, ?)',
  )
  const casRow = raw.prepare<[number, string, number, string, number]>(
    'UPDATE rooms SET version = ?, data = ?, updated_at = ? WHERE code = ? AND version = ?',
  )
  const del = raw.prepare<[string]>('DELETE FROM rooms WHERE code = ?')
  const purge = raw.prepare<[number]>('DELETE FROM rooms WHERE updated_at < ?')
  const markDissolved = raw.prepare<[string, number]>(
    'INSERT INTO dissolved (code, at) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET at = excluded.at',
  )
  const getDissolved = raw.prepare<[string], { at: number }>('SELECT at FROM dissolved WHERE code = ?')
  const purgeDissolved = raw.prepare<[number]>('DELETE FROM dissolved WHERE at < ?')

  return {
    remote: false,
    getVersion: async code => getVersion.get(code)?.version,
    getRow: async code => getRow.get(code),
    createRow: async (code, version, data, updatedAt) =>
      createRow.run(code, version, data, updatedAt).changes > 0,
    casRow: async (code, expected, version, data, updatedAt) =>
      casRow.run(version, data, updatedAt, code, expected).changes > 0,
    delRow: async code => void del.run(code),
    purgeRows: async before => void purge.run(before),
    markDissolved: async (code, at) => void markDissolved.run(code, at),
    getDissolved: async code => getDissolved.get(code),
    purgeDissolved: async before => void purgeDissolved.run(before),
  }
}

/* ---------------------------------- libsql:// 远程实现（Turso 等，纯 JS HTTP 客户端） ---------------------------------- */

/** 由任意 libSQL 客户端构造存储（web 入口用于生产远程库；测试用 node 入口注入）。
 *  打开时幂等建表（IF NOT EXISTS），与 file: 模式行为一致。 */
export async function createLibsqlStoreFromClient(client: LibsqlLikeClient): Promise<RoomStore> {
  await client.execute({ sql: ROOM_TABLE_SQL })
  await client.execute({ sql: TOMBSTONE_TABLE_SQL })
  const rowsOf = (r: { rows: unknown }) =>
    Array.from(r.rows as Array<Record<string, unknown>>, row => row as Record<string, unknown>)

  return {
    remote: true,
    getVersion: async (code) => {
      const r = rowsOf(await client.execute({ sql: 'SELECT version FROM rooms WHERE code = ?', args: [code] }))
      const v = r[0]?.version
      return v == null ? undefined : Number(v)
    },
    getRow: async (code) => {
      const r = rowsOf(await client.execute({ sql: 'SELECT version, data FROM rooms WHERE code = ?', args: [code] }))
      const row = r[0]
      return row ? { version: Number(row.version), data: String(row.data) } : undefined
    },
    casRow: async (code, expected, version, data, updatedAt) => {
      const r = await client.execute({
        sql: 'UPDATE rooms SET version = ?, data = ?, updated_at = ? WHERE code = ? AND version = ?',
        args: [version, data, updatedAt, code, expected],
      })
      return r.rowsAffected > 0
    },
    createRow: async (code, version, data, updatedAt) => {
      const r = await client.execute({
        sql: 'INSERT OR IGNORE INTO rooms (code, version, data, updated_at) VALUES (?, ?, ?, ?)',
        args: [code, version, data, updatedAt],
      })
      return r.rowsAffected > 0
    },
    delRow: async (code) => {
      await client.execute({ sql: 'DELETE FROM rooms WHERE code = ?', args: [code] })
    },
    purgeRows: async (before) => {
      await client.execute({ sql: 'DELETE FROM rooms WHERE updated_at < ?', args: [before] })
    },
    markDissolved: async (code, at) => {
      await client.execute({
        sql: 'INSERT INTO dissolved (code, at) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET at = excluded.at',
        args: [code, at],
      })
    },
    getDissolved: async (code) => {
      const r = rowsOf(await client.execute({ sql: 'SELECT at FROM dissolved WHERE code = ?', args: [code] }))
      const row = r[0]
      return row ? { at: Number(row.at) } : undefined
    },
    purgeDissolved: async (before) => {
      await client.execute({ sql: 'DELETE FROM dissolved WHERE at < ?', args: [before] })
    },
  }
}

async function createLibsqlStore(url: string, authToken: string | undefined): Promise<RoomStore> {
  const { createClient } = await import('@libsql/client/web')
  return await createLibsqlStoreFromClient(createClient({ url, authToken }))
}

/* ---------------------------------- 入口 ---------------------------------- */

function resolveRemote(): { url: string, authToken: string | undefined } | null {
  // 兼容 Vercel 市场里 Turso 集成注入的标准变量名（TURSO_DATABASE_URL 等）
  const url = process.env.NUXT_DB_URL ?? process.env.TURSO_DATABASE_URL
  if (!url || url.startsWith('file:'))
    return null
  return { url, authToken: process.env.NUXT_DB_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN }
}

async function openStore(): Promise<RoomStore | null> {
  try {
    const remote = resolveRemote()
    if (remote)
      return await createLibsqlStore(remote.url, remote.authToken)
    return createFileStore(resolveDbPath())
  }
  catch (err) {
    console.error('[holdem] 存储初始化失败，退化为内存存储（重启后房间不保留）:', err)
    return null
  }
}

/** 首次调用时打开存储（进程内只此一次）；失败返回 null（内存模式） */
export function getStore(): Promise<RoomStore | null> {
  storePromise ??= openStore()
  return storePromise
}
