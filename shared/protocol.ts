/**
 * 客户端 / 服务端共享的德州扑克协议类型。
 * 服务端按玩家视角序列化状态（只下发该玩家可见的底牌）。
 */

/** 花色：0 黑桃 ♠ / 1 红桃 ♥ / 2 梅花 ♣ / 3 方块 ♦ */
export interface Card {
  /** 点数 2..14（14 = A） */
  r: number
  s: number
}

export type Stage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export type RoomPhase = 'lobby' | 'playing' | 'ended'

export type PlayerStatus = 'waiting' | 'in-hand' | 'folded' | 'all-in' | 'busted'

export interface SeatView {
  id: string
  name: string
  avatar: string
  isBot: boolean
  connected: boolean
  isHost: boolean
  status: PlayerStatus
  stack: number
  /** 本轮已下注额（用于 Bet 气泡） */
  roundBet: number
  /** 本手牌总投入（含之前轮次） */
  totalBet: number
  /** 底牌：null = 背面；有值 = 明牌（仅自己或摊牌阶段） */
  cards: Card[] | null
  isDealer: boolean
  lastAction: LastAction | null
  /** 摊牌结果 */
  handDesc: string | null
  won: number
}

export interface LastAction {
  k: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in' | 'sb' | 'bb'
  amount: number
}

export interface PotResult {
  playerId: string
  amount: number
  desc: string | null
}

export interface HandView {
  no: number
  stage: Stage
  community: Card[]
  /** 主池（所有人已投入总额） */
  pot: number
  currentBet: number
  minRaise: number
  /** 轮到谁行动 */
  toActId: string | null
  /** 行动截止时间（epoch ms），客户端据此渲染倒计时 */
  deadline: number
  /** 摊牌/结算信息 */
  results: PotResult[] | null
  /** 结束倒计时（下一局开始，epoch ms） */
  nextHandAt: number | null
}

export interface RoomSettings {
  smallBlind: number
  bigBlind: number
  buyIn: number
  minPlayers: number
  maxPlayers: number
  turnSeconds: number
}

export interface ClientRoomState {
  code: string
  phase: RoomPhase
  meId: string
  hostId: string
  settings: RoomSettings
  seats: SeatView[]
  hand: HandView | null
  /** 游戏结束时的赢家 */
  championId: string | null
  /** 服务端推送的提示（错误等） */
  notice: string | null
  noticeAt: number | null
}

export type ActionKind = 'fold' | 'check' | 'call' | 'raise'

/** 客户端 → 服务端：房间命令体（POST /api/rooms/:code/command） */
export type CommandBody =
  | { t: 'start' }
  | { t: 'add-bot' }
  | { t: 'action'; kind: ActionKind; amount?: number }
  | { t: 'rebuy' }
  | { t: 'reset' }
  | { t: 'leave' }

/** 附带鉴权的完整命令请求（扁平结构，便于服务端读取） */
export interface CommandRequest {
  playerId: string
  token: string
  t: CommandBody['t']
  kind?: ActionKind
  amount?: number
}

/** 命令响应：总是返回执行后的最新状态，省一次轮询 */
export interface CommandResponse {
  v: number
  state: ClientRoomState
}

/** 状态轮询响应（GET /api/rooms/:code/state?playerId&token&v）：无变化时返回轻量心跳 */
export type StateResponse =
  | { v: number; changed: false }
  | { v: number; changed: true; state: ClientRoomState }
