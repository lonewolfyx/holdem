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
  lastActive: number
}

declare global {
  // eslint-disable-next-line ts/no-var-requires
  var __holdemRooms: Map<string, RoomEntry> | undefined
}

/**
 * 房间注册表：内存为热路径缓存（轮询读零 SQL），SQLite 做写穿持久化。
 * 写穿保证 Node 部署重启后房间可恢复；读缓存保证高频轮询不产生数据库压力。
 */
const rooms: Map<string, RoomEntry> = (globalThis.__holdemRooms ??= new Map())

const ROOM_TTL_MS = 24 * 3600 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

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
  persistRoom(entry)
}

function hydrateRoom(code: string, stored: StoredRoom): RoomEntry {
  const entry: RoomEntry = {
    code,
    version: stored.v,
    tokens: new Map(stored.tokens),
    game: null!, // 立即赋值（restore 需要 entry 引用做 onChange 闭包）
    createdAt: stored.createdAt,
    lastActive: stored.lastActive,
  }
  entry.game = PokerGame.restore(stored.game, { onChange: () => markDirty(entry) })
  entry.game.code = code
  return entry
}

/* ---------------------------------- API ---------------------------------- */

export async function createRoom(): Promise<RoomEntry> {
  await ensureDb()
  const now = Date.now()

  // 顺手清理 24 小时未活跃的房间
  for (const [code, entry] of rooms) {
    if (now - entry.lastActive > ROOM_TTL_MS)
      rooms.delete(code)
  }
  const db = peekDb()
  db?.purgeRows(now - ROOM_TTL_MS)

  let code = randomCode()
  while (rooms.has(code)) code = randomCode()
  const entry: RoomEntry = {
    code,
    version: 1,
    tokens: new Map(),
    game: null!,
    createdAt: now,
    lastActive: now,
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
  if (cached) return cached

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

export function registerPlayer(entry: RoomEntry, playerId: string, token: string) {
  entry.tokens.set(playerId, token)
  persistRoom(entry)
}

export function verifyToken(entry: RoomEntry, playerId: string, token: string): boolean {
  return entry.tokens.get(playerId) === token
}
