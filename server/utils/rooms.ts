import { createError } from 'h3'
import { PokerGame, type GameSnapshot } from '../poker/game'
import { ensureDb, peekDb } from './db'

export interface RoomEntry {
  code: string
  game: PokerGame
  /** playerId → 认证 token */
  tokens: Map<string, string>
  /** 每次状态变化递增；客户端据此做增量轮询 */
  version: number
  createdAt: number
  /** 最近一次活动时间（轮询心跳 / 游戏事件），超过 TTL 未活动即解散 */
  lastActive: number
  /** 最近一次写穿 SQLite 的时间（心跳节流用） */
  lastPersistedAt: number
}

declare global {
  // eslint-disable-next-line ts/no-var-requires
  var __holdemRooms: Map<string, RoomEntry> | undefined
  // eslint-disable-next-line ts/no-var-requires
  var __holdemDissolved: Set<string> | undefined
}

/**
 * 房间注册表：内存为热路径缓存（轮询读零 SQL），SQLite 做写穿持久化。
 * 写穿保证 Node 部署重启后房间可恢复；读缓存保证高频轮询不产生数据库压力。
 *
 * 房间生命周期：
 * - 房主（创建者）是唯一拥有者，房主离开 = 解散房间（写入墓碑，成员端收到 410）；
 * - 普通玩家离开只退出座位，房间继续存在；
 * - 30 分钟无任何活动（无人轮询 / 无游戏事件）则强制解散。
 */
const rooms: Map<string, RoomEntry> = (globalThis.__holdemRooms ??= new Map())

export const ROOM_TTL_MS = 30 * 60 * 1000
/** 心跳写穿节流：轮询只刷新内存活跃时间，每分钟最多落盘一次 */
const HEARTBEAT_PERSIST_MS = 60_000
const TOMBSTONE_TTL_MS = 60 * 60 * 1000

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 内存模式的解散墓碑（SQLite 不可用时的降级记录） */
const dissolvedCodes: Set<string> = (globalThis.__holdemDissolved ??= new Set())

function randomCode(len = 4): string {
  let s = ''
  for (let i = 0; i < len; i++)
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return s
}

export function randomId(bytes = 12): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------------------------- 持久化 ---------------------------------- */

interface StoredRoom {
  v: number
  tokens: [string, string][]
  createdAt: number
  lastActive: number
  game: GameSnapshot
}

/** 写穿持久化（token 等非游戏状态变更后也需调用） */
export function persistRoom(entry: RoomEntry) {
  const db = peekDb()
  if (!db) return
  const stored: StoredRoom = {
    v: entry.version,
    tokens: [...entry.tokens.entries()],
    createdAt: entry.createdAt,
    lastActive: entry.lastActive,
    game: entry.game.serialize(),
  }
  db.putRow(entry.code, entry.version, JSON.stringify(stored), entry.lastActive)
}

/** 状态变化入口：版本号 +1 并写穿到 SQLite */
export function markDirty(entry: RoomEntry) {
  entry.version++
  entry.lastActive = Date.now()
  entry.lastPersistedAt = entry.lastActive
  persistRoom(entry)
}

/** 轮询心跳：刷新在线状态与房间活跃时间；活跃时间按节流落盘，避免每秒写库 */
export function heartbeat(entry: RoomEntry, playerId: string) {
  const now = Date.now()
  entry.game.touch(playerId, now)
  entry.lastActive = now
  if (now - entry.lastPersistedAt >= HEARTBEAT_PERSIST_MS) {
    entry.lastPersistedAt = now
    persistRoom(entry)
  }
}

/** 解散房间：内存 + 磁盘记录一并删除，并留下墓碑供成员端区分 410/404 */
export function dissolveRoom(entry: RoomEntry) {
  rooms.delete(entry.code)
  dissolvedCodes.add(entry.code)
  const db = peekDb()
  db?.delRow(entry.code)
  db?.markDissolved(entry.code, Date.now())
}

/* ---------------------------------- 查询 ---------------------------------- */

export async function createRoom(): Promise<RoomEntry> {
  await ensureDb()
  const now = Date.now()

  // 清理超时未活动的房间与过期墓碑
  for (const [code, entry] of rooms) {
    if (now - entry.lastActive > ROOM_TTL_MS)
      rooms.delete(code)
  }
  const db = peekDb()
  db?.purgeRows(now - ROOM_TTL_MS)
  db?.purgeDissolved(now - TOMBSTONE_TTL_MS)

  let code = randomCode()
  while (rooms.has(code)) code = randomCode()
  const entry: RoomEntry = {
    code,
    version: 1,
    tokens: new Map(),
    game: null!,
    createdAt: now,
    lastActive: now,
    lastPersistedAt: now,
  }
  entry.game = new PokerGame({ onChange: () => markDirty(entry) })
  entry.game.code = code
  rooms.set(code, entry)
  persistRoom(entry)
  return entry
}

export async function getRoom(code: string): Promise<RoomEntry | undefined> {
  const key = code?.toUpperCase()
  const cached = rooms.get(key)
  if (cached) {
    // 活跃时间在内存里持续刷新；超过 TTL 说明确实无人活动
    if (Date.now() - cached.lastActive > ROOM_TTL_MS) {
      dissolveRoom(cached)
      return undefined
    }
    return cached
  }

  await ensureDb()
  const db = peekDb()
  const row = db?.getRow(key)
  if (!row) return undefined
  try {
    const stored = JSON.parse(row.data) as StoredRoom
    if (Date.now() - stored.lastActive > ROOM_TTL_MS) {
      db?.delRow(key)
      return undefined
    }
    const entry = hydrateRoom(key, stored)
    rooms.set(key, entry)
    return entry
  }
  catch (err) {
    console.error(`[holdem] 房间 ${key} 快照损坏，忽略:`, err)
    return undefined
  }
}

/** 路由用：房间不存在抛 404；已被解散抛 410（成员端据此提示「房间已解散」） */
export async function requireRoom(code: string): Promise<RoomEntry> {
  const key = code?.toUpperCase()
  const entry = await getRoom(key)
  if (entry) return entry
  if (dissolvedCodes.has(key) || (await isDissolvedInDb(key)))
    throw createError({ statusCode: 410, statusMessage: '房间已解散' })
  throw createError({ statusCode: 404, statusMessage: '房间不存在或已过期' })
}

async function isDissolvedInDb(key: string): Promise<boolean> {
  await ensureDb()
  return peekDb()?.getDissolved(key) !== undefined
}

function hydrateRoom(code: string, stored: StoredRoom): RoomEntry {
  const entry: RoomEntry = {
    code,
    version: stored.v,
    tokens: new Map(stored.tokens),
    game: null!, // 立即赋值（restore 需要 entry 引用做 onChange 闭包）
    createdAt: stored.createdAt,
    lastActive: stored.lastActive,
    lastPersistedAt: stored.lastActive,
  }
  entry.game = PokerGame.restore(stored.game, { onChange: () => markDirty(entry) })
  entry.game.code = code
  return entry
}

/* ---------------------------------- 玩家 ---------------------------------- */

export function registerPlayer(entry: RoomEntry, playerId: string, token: string) {
  entry.tokens.set(playerId, token)
  persistRoom(entry)
}

export function verifyToken(entry: RoomEntry, playerId: string, token: string): boolean {
  return entry.tokens.get(playerId) === token
}
