import { createError } from 'h3'
import { PokerGame, type GameSnapshot } from '../poker/game'
import { getStore, type RoomStore } from './db'

export interface RoomEntry {
  code: string
  game: PokerGame
  /** playerId → 认证 token */
  tokens: Map<string, string>
  /** 每次状态变化递增；客户端据此做增量轮询，存储层据此做 CAS 条件写入 */
  version: number
  createdAt: number
  /** 最近一次活动时间（轮询心跳 / 游戏事件），超过 TTL 未活动即解散 */
  lastActive: number
  /** 最近一次写穿存储的时间（心跳节流用） */
  lastPersistedAt: number
}

declare global {
  // eslint-disable-next-line ts/no-var-requires
  var __holdemRooms: Map<string, RoomEntry> | undefined
  // eslint-disable-next-line ts/no-var-requires
  var __holdemDissolved: Set<string> | undefined
}

/**
 * 房间注册表：内存为热路径缓存（轮询读零 SQL），持久层做写穿。
 *
 * 多实例一致性（Vercel 等 Serverless 平台必须面对）：
 * - 实例内存可能落后于共享存储 → 读路径 refreshIfStale() 按版本号校验并重载；
 * - 写入用 CAS 条件更新（版本号不匹配则拒绝），失败时丢弃本地副本并从存储重载，
 *   不会用旧状态覆盖新状态；被丢弃的引擎事件由下一次 tick() 自愈重放；
 * - 所有写入经串行化队列，路由返回前 await flushWrites() 确保 Serverless
 *   函数冻结前落库完成。
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

/** 存储不可用时的解散墓碑降级记录 */
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

/* ---------------------------------- 存储访问 ---------------------------------- */

let storePromise: Promise<RoomStore | null> | null = null

function store(): Promise<RoomStore | null> {
  storePromise ??= getStore()
  return storePromise
}

let writeQueue: Promise<unknown> = Promise.resolve()

/** 串行化写入，保持版本递增顺序 */
function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.catch(() => {})
  return run
}

/**
 * 等待所有已入队的写入完成。
 * Serverless 平台在响应返回后可能立即冻结函数，
 * 路由必须在返回前调用以保证状态落库。
 */
export function flushWrites(): Promise<unknown> {
  return writeQueue
}

/* ---------------------------------- 持久化 ---------------------------------- */

interface StoredRoom {
  v: number
  tokens: [string, string][]
  createdAt: number
  lastActive: number
  game: GameSnapshot
}

function snapshotOf(entry: RoomEntry): StoredRoom {
  return {
    v: entry.version,
    tokens: [...entry.tokens.entries()],
    createdAt: entry.createdAt,
    lastActive: entry.lastActive,
    game: entry.game.serialize(),
  }
}

/**
 * 待写入载荷：code → (version → payload)。
 * 同一版本的多次 persistRoom（如 markDirty 后又 registerPlayer）合并为一次
 * CAS 写（payload 取最新）；不同版本各自入队，按 FIFO 顺序落库。
 */
const pendingWrites = new Map<string, Map<number, { data: string, updatedAt: number }>>()
const scheduledVersion = new Map<string, number>()

/** CAS 条件写穿：版本号不匹配（另一实例已推进）时丢弃本地副本并从存储重载。
 *  版本与快照在入队时捕获；同版本重复调用只合并数据、不重复排队。 */
export function persistRoom(entry: RoomEntry) {
  let byVersion = pendingWrites.get(entry.code)
  if (!byVersion) {
    byVersion = new Map()
    pendingWrites.set(entry.code, byVersion)
  }
  byVersion.set(entry.version, {
    data: JSON.stringify(snapshotOf(entry)),
    updatedAt: entry.lastActive,
  })
  if (scheduledVersion.get(entry.code) === entry.version)
    return // 该版本的 flush 已在队列中，届时会取到合并后的最新 payload
  scheduledVersion.set(entry.code, entry.version)
  const scheduledVer = entry.version
  enqueueWrite(async () => {
    scheduledVersion.delete(entry.code)
    const byV = pendingWrites.get(entry.code)
    const payload = byV?.get(scheduledVer)
    if (byV && payload) {
      byV.delete(scheduledVer)
      if (byV.size === 0)
        pendingWrites.delete(entry.code)
    }
    if (!payload)
      return
    const s = await store()
    if (!s) return
    const ok = await s.casRow(entry.code, scheduledVer - 1, scheduledVer, payload.data, payload.updatedAt)
    if (!ok && scheduledVer > 1)
      await reloadRoom(entry.code)
  })
}

/** 状态变化入口：版本号 +1 并写穿到存储 */
export function markDirty(entry: RoomEntry) {
  entry.version++
  entry.lastActive = Date.now()
  entry.lastPersistedAt = entry.lastActive
  persistRoom(entry)
}

/** 轮询心跳：刷新在线时间与房间活跃时间；活跃时间按节流落盘，避免每秒写库 */
export function heartbeat(entry: RoomEntry, playerId: string) {
  const now = Date.now()
  entry.game.touch(playerId, now)
  entry.lastActive = now
  if (now - entry.lastPersistedAt >= HEARTBEAT_PERSIST_MS) {
    entry.lastPersistedAt = now
    persistRoom(entry)
  }
}

/** 解散房间：内存 + 存储记录一并删除，并留下墓碑供成员端区分 410/404。
 *  经写队列执行，保证排在之前已入队的引擎写入之后，避免删除又被旧写入复活。 */
export async function dissolveRoom(entry: RoomEntry) {
  rooms.delete(entry.code)
  dissolvedCodes.add(entry.code)
  await enqueueWrite(async () => {
    const s = await store()
    if (!s) return
    await s.delRow(entry.code)
    await s.markDissolved(entry.code, Date.now())
  })
}

/* ---------------------------------- 查询 ---------------------------------- */

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

async function reloadRoom(code: string): Promise<RoomEntry | undefined> {
  const s = await store()
  const row = (await s?.getRow(code)) ?? undefined
  if (!row) return undefined
  const stored = JSON.parse(row.data) as StoredRoom
  const entry = hydrateRoom(code, stored)
  rooms.set(code, entry)
  return entry
}

export async function createRoom(): Promise<RoomEntry> {
  const s = await store()
  const now = Date.now()

  // 清理超时未活动的房间与过期墓碑
  for (const [code, entry] of rooms) {
    if (now - entry.lastActive > ROOM_TTL_MS)
      rooms.delete(code)
  }
  if (s) {
    await s.purgeRows(now - ROOM_TTL_MS)
    await s.purgeDissolved(now - TOMBSTONE_TTL_MS)
  }

  let code = randomCode()
  // createRow 对同码冲突返回 false（跨实例同时生成同码的概率约百万分之一），重试即可
  for (let attempt = 0; attempt < 5; attempt++) {
    if (rooms.has(code)) {
      code = randomCode()
      continue
    }
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
    const created = await enqueueWrite(async () => {
      const s = await store()
      if (!s) return true
      return await s.createRow(code, entry.version, JSON.stringify(snapshotOf(entry)), entry.lastActive)
    })
    if (created) {
      rooms.set(code, entry)
      return entry
    }
    code = randomCode()
  }
  throw createError({ statusCode: 503, statusMessage: '房间码分配失败，请重试' })
}

export async function getRoom(code: string): Promise<RoomEntry | undefined> {
  const key = code?.toUpperCase()
  const cached = rooms.get(key)
  if (cached) {
    // 活跃时间在内存里持续刷新；超过 TTL 说明确实无人活动
    if (Date.now() - cached.lastActive > ROOM_TTL_MS) {
      await dissolveRoom(cached)
      return undefined
    }
    return cached
  }

  const s = await store()
  const row = (await s?.getRow(key)) ?? undefined
  if (!row) return undefined
  try {
    const stored = JSON.parse(row.data) as StoredRoom
    if (Date.now() - stored.lastActive > ROOM_TTL_MS) {
      await s?.delRow(key)
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

/**
 * 多实例一致性：检查共享存储中的最新版本。
 * 本实例内存落后则重载；房间已被其它实例解散/删除则返回 undefined
 * （调用方应再走 requireRoom 抛出 410/404）。
 */
export async function refreshIfStale(entry: RoomEntry): Promise<RoomEntry | undefined> {
  const s = await store()
  if (!s) return entry
  const remoteVersion = await s.getVersion(entry.code)
  if (remoteVersion === undefined) {
    rooms.delete(entry.code)
    return undefined
  }
  if (remoteVersion <= entry.version)
    return entry
  return await reloadRoom(entry.code)
}

/** 路由用：房间不存在抛 404；已被解散抛 410（成员端据此提示「房间已解散」） */
export async function requireRoom(code: string): Promise<RoomEntry> {
  const key = code?.toUpperCase()
  const entry = await getRoom(key)
  if (entry) return entry
  if (dissolvedCodes.has(key) || (await isDissolvedInStore(key)))
    throw createError({ statusCode: 410, statusMessage: '房间已解散' })
  throw createError({ statusCode: 404, statusMessage: '房间不存在或已过期' })
}

async function isDissolvedInStore(key: string): Promise<boolean> {
  if (dissolvedCodes.has(key)) return true
  const s = await store()
  return (await s?.getDissolved(key)) !== undefined
}

/* ---------------------------------- 玩家 ---------------------------------- */

export function registerPlayer(entry: RoomEntry, playerId: string, token: string) {
  entry.tokens.set(playerId, token)
  persistRoom(entry)
}

export function verifyToken(entry: RoomEntry, playerId: string, token: string): boolean {
  return entry.tokens.get(playerId) === token
}
