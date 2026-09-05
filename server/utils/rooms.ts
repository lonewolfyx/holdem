import { PokerGame } from '../poker/game'

export interface RoomEntry {
  code: string
  game: PokerGame
  /** playerId → 认证 token */
  tokens: Map<string, string>
  createdAt: number
  lastActive: number
}

/** 每个在线玩家可能有多条连接（多标签页） */
export const peersByPlayer = new Map<string, Set<any>>()

declare global {
  // eslint-disable-next-line ts/no-var-requires
  var __holdemRooms: Map<string, RoomEntry> | undefined
}

const rooms: Map<string, RoomEntry> = (globalThis.__holdemRooms ??= new Map())

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

/** 推送个性化状态给房间内每个连接 */
export function broadcast(entry: RoomEntry) {
  entry.lastActive = Date.now()
  const payloadFor = new Map<string, string>()
  for (const p of entry.game.players.values()) {
    if (p.isBot || !p.connected) continue
    payloadFor.set(p.id, JSON.stringify({ t: 'state', state: entry.game.view(p.id) }))
  }
  for (const [playerId, payload] of payloadFor) {
    for (const peer of peersByPlayer.get(playerId) ?? []) {
      try {
        peer.send(payload)
      }
      catch {
        // 连接已断开，close 回调会清理
      }
    }
  }
}

export function createRoom(): RoomEntry {
  // 顺手清理 24 小时未活跃的房间
  const now = Date.now()
  for (const [code, entry] of rooms) {
    if (now - entry.lastActive > 24 * 3600 * 1000)
      rooms.delete(code)
  }
  let code = randomCode()
  while (rooms.has(code)) code = randomCode()
  const entry: RoomEntry = {
    code,
    game: new PokerGame({ onChange: () => broadcast(entry) }),
    tokens: new Map(),
    createdAt: now,
    lastActive: now,
  }
  entry.game.code = code
  rooms.set(code, entry)
  return entry
}

export function getRoom(code: string): RoomEntry | undefined {
  return rooms.get(code?.toUpperCase())
}

export function registerPlayer(entry: RoomEntry, playerId: string, token: string) {
  entry.tokens.set(playerId, token)
}

export function verifyToken(entry: RoomEntry, playerId: string, token: string): boolean {
  return entry.tokens.get(playerId) === token
}

export function attachPeer(playerId: string, peer: any) {
  let set = peersByPlayer.get(playerId)
  if (!set) {
    set = new Set()
    peersByPlayer.set(playerId, set)
  }
  set.add(peer)
}

export function detachPeer(playerId: string, peer: any): boolean {
  const set = peersByPlayer.get(playerId)
  if (!set) return false
  set.delete(peer)
  if (set.size === 0) {
    peersByPlayer.delete(playerId)
    return true
  }
  return false
}

export function sendTo(playerId: string, payload: object) {
  for (const peer of peersByPlayer.get(playerId) ?? []) {
    try {
      peer.send(JSON.stringify(payload))
    }
    catch {}
  }
}
