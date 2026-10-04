import type { ActionKind, ClientRoomState, HandView, LastAction, PotResult, SeatView, Stage, RoomPhase } from '#shared/protocol'
import { newDeck, shuffle, type Card as CardType } from './cards'
import { describeScore, evaluate } from './evaluator'
import { settlePots } from './pots'
import { decideBot } from './bots'

export class GameError extends Error {}

export type Rng = () => number

export interface GameConfig {
  smallBlind: number
  bigBlind: number
  buyIn: number
  minPlayers: number
  maxPlayers: number
  turnMs: number
  botMinMs: number
  botMaxMs: number
  streetMs: number
  resultMs: number
  nextHandMs: number
}

export const DEFAULT_CONFIG: GameConfig = {
  smallBlind: 50,
  bigBlind: 100,
  buyIn: 50_000_000, // 每人默认额度 5000万
  minPlayers: 3,
  maxPlayers: 10,
  turnMs: 25_000,
  botMinMs: 900,
  botMaxMs: 2400,
  streetMs: 1100,
  resultMs: 6500,
  nextHandMs: 5000,
}

/** 在线判定阈值：最近一次心跳在该时限内视为在线 */
export const PRESENCE_TTL_MS = 12_000

export interface JoinInfo {
  id: string
  name: string
  avatar: string
  isBot: boolean
}

export interface GPlayer {
  id: string
  name: string
  avatar: string
  isBot: boolean
  isHost: boolean
  connected: boolean
  /** 最近一次心跳（轮询/命令）时间，epoch ms */
  lastSeen: number
  seatOrder: number
  stack: number
  inHand: boolean
  folded: boolean
  allIn: boolean
  roundBet: number
  totalBet: number
  cards: CardType[]
  acted: boolean
  lastAction: LastAction | null
  revealed: boolean
  handDesc: string | null
  won: number
}

/**
 * 待处理事件：同一时刻最多一个。
 * 用可序列化的「时间点 + 类型」替代 setTimeout，配合 tick() 惰性推进，
 * 使引擎不依赖后台定时器（serverless 冻结安全，重启后可追赶进度）。
 */
export type PendingKind = 'bot-act' | 'turn-timeout' | 'street' | 'result' | 'next-hand'

export interface PokerDeps {
  rng?: Rng
  now?: () => number
  /** 状态变化后通知（服务端在此递增版本号并持久化） */
  onChange?: () => void
  config?: Partial<GameConfig>
}

export interface GameSnapshot {
  cfg: GameConfig
  phase: RoomPhase
  championId: string | null
  handNo: number
  stage: Stage
  dealerOrder: number
  community: CardType[]
  currentBet: number
  minRaise: number
  toActId: string | null
  deadline: number
  nextHandAt: number | null
  results: PotResult[] | null
  hand: HandView | null
  remainingDeck: CardType[]
  seatSeq: number
  pendingAt: number | null
  pendingKind: PendingKind | null
  pendingWho: string | null
  players: GPlayer[]
}

const baseSeat = (p: GPlayer): SeatView => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  isBot: p.isBot,
  connected: p.connected,
  isHost: p.isHost,
  status: 'waiting',
  stack: p.stack,
  roundBet: 0,
  totalBet: 0,
  cards: null,
  isDealer: false,
  lastAction: null,
  handDesc: null,
  won: 0,
})

export class PokerGame {
  code = ''
  cfg: GameConfig
  phase: RoomPhase = 'lobby'
  players = new Map<string, GPlayer>()
  championId: string | null = null

  hand: HandView | null = null
  handNo = 0
  stage: Stage = 'preflop'
  dealerOrder = -1
  community: CardType[] = []
  currentBet = 0
  minRaise = 0
  toActId: string | null = null
  deadline = 0
  nextHandAt: number | null = null
  results: PotResult[] | null = null

  pendingAt: number | null = null
  pendingKind: PendingKind | null = null
  pendingWho: string | null = null

  private rng: Rng
  private now: () => number
  private onChange: () => void
  private seatSeq = 0

  constructor(deps: PokerDeps = {}) {
    this.rng = deps.rng ?? Math.random
    this.now = deps.now ?? Date.now
    this.onChange = deps.onChange ?? (() => {})
    this.cfg = { ...DEFAULT_CONFIG, ...deps.config }
  }

  /* ---------------------------------- 待处理事件 ---------------------------------- */

  private setPending(kind: PendingKind, ms: number, who: string | null = null) {
    this.pendingAt = this.now() + ms
    this.pendingKind = kind
    this.pendingWho = who
  }

  private cancelPending() {
    this.pendingAt = null
    this.pendingKind = null
    this.pendingWho = null
  }

  /**
   * 惰性推进：把所有到期的待处理事件按序执行。
   * 每个请求入口先调用，保证读到的状态是「当前时间」的最新状态。
   */
  tick(now = this.now()) {
    let guard = 0
    while (this.pendingAt !== null && this.pendingAt <= now && guard++ < 1000) {
      const kind = this.pendingKind
      const who = this.pendingWho
      this.cancelPending()
      if (!kind) break
      switch (kind) {
        case 'bot-act': {
          const p = who ? this.players.get(who) : undefined
          if (p?.isBot && this.toActId === p.id) this.botAct(p)
          break
        }
        case 'turn-timeout': {
          const p = who ? this.players.get(who) : undefined
          if (p && this.toActId === p.id) this.autoAct(p)
          break
        }
        case 'street':
          if (this.hand) this.endStreet()
          break
        case 'result':
          if (this.hand) this.finishHand()
          break
        case 'next-hand':
          if (this.phase === 'playing') this.startHand()
          break
      }
    }

    // 在线状态翻转检测：断线玩家的 connected 变化需广播给其他客户端
    for (const p of this.players.values()) {
      if (p.isBot) continue
      const online = now - p.lastSeen < PRESENCE_TTL_MS
      if (online !== p.connected) {
        p.connected = online
        this.push()
      }
    }
  }

  /** 心跳：刷新玩家在线时间（不触发版本变化，由 tick 的翻转检测负责广播） */
  touch(id: string, now = this.now()) {
    const p = this.players.get(id)
    if (p && !p.isBot) p.lastSeen = now
  }

  /* ---------------------------------- 玩家管理 ---------------------------------- */

  join(info: JoinInfo): GPlayer {
    if (this.players.size >= this.cfg.maxPlayers)
      throw new GameError('房间已满（最多 10 人）')
    for (const p of this.players.values()) {
      if (p.name === info.name)
        throw new GameError('已有同名玩家，换一个昵称吧')
    }
    const player: GPlayer = {
      id: info.id,
      name: info.name,
      avatar: info.avatar,
      isBot: info.isBot,
      isHost: this.players.size === 0,
      connected: !info.isBot,
      lastSeen: this.now(),
      seatOrder: this.seatSeq++,
      stack: this.cfg.buyIn,
      inHand: false,
      folded: false,
      allIn: false,
      roundBet: 0,
      totalBet: 0,
      cards: [],
      acted: false,
      lastAction: null,
      revealed: false,
      handDesc: null,
      won: 0,
    }
    this.players.set(player.id, player)
    this.push()
    return player
  }

  remove(id: string) {
    const p = this.players.get(id)
    if (!p) return
    const wasToAct = this.toActId === id
    if (p.inHand && !p.folded && this.hand) {
      // 牌局中离开视为弃牌，已投入筹码留在池内
      p.folded = true
      p.inHand = false
      p.lastAction = { k: 'fold', amount: 0 }
    }
    this.players.delete(id)
    if (wasToAct && this.hand) {
      // 行动者离场：立即把行动权推进到下一位，避免牌局卡死
      this.cancelPending()
      this.deadline = 0
      this.afterAction(p)
    }
    this.push()
  }

  addBot(): GPlayer {
    const n = [...this.players.values()].filter(p => p.isBot).length + 1
    const names = ['小爱', '小度', '小讯', '小微', '小星', '小辰', '小溪', '小风', '小岚', '小瑾']
    const avatars = ['🤖', '🧮', '👾', '🎮', '🛸', '⚡', '🌙', '🍀', '🦾', '📡']
    return this.join({
      id: `bot-${Math.random().toString(36).slice(2, 10)}`,
      name: `${names[(n - 1) % names.length] ?? '机器人'}bot`,
      avatar: avatars[(n - 1) % avatars.length] ?? '🤖',
      isBot: true,
    })
  }

  rebuy(id: string) {
    const p = this.players.get(id)
    if (!p) return
    if (p.stack > 0)
      throw new GameError('还有筹码，无需补充')
    if (p.inHand)
      throw new GameError('本局结束后再补充筹码')
    p.stack = this.cfg.buyIn
    if (this.phase === 'ended')
      this.phase = 'lobby'
    this.push()
  }

  /* ---------------------------------- 牌局控制 ---------------------------------- */

  startGame(byId: string) {
    const by = this.players.get(byId)
    if (!by?.isHost)
      throw new GameError('只有房主才能开始游戏')
    if (this.phase === 'playing' && this.hand)
      throw new GameError('游戏已在进行中')
    const seated = [...this.players.values()]
    if (seated.length < this.cfg.minPlayers)
      throw new GameError(`至少需要 ${this.cfg.minPlayers} 名玩家才能开局`)
    if (seated.filter(p => p.stack > 0).length < 2)
      throw new GameError('需要至少 2 名有筹码的玩家')
    this.phase = 'playing'
    this.championId = null
    this.startHand()
  }

  resetGame(byId: string) {
    const by = this.players.get(byId)
    if (!by?.isHost)
      throw new GameError('只有房主才能重开游戏')
    this.cancelPending()
    this.hand = null
    this.results = null
    this.phase = 'lobby'
    this.championId = null
    for (const p of this.players.values()) {
      p.stack = this.cfg.buyIn
      p.inHand = false
      p.folded = false
      p.allIn = false
      p.roundBet = 0
      p.totalBet = 0
      p.cards = []
      p.acted = false
      p.lastAction = null
      p.revealed = false
      p.handDesc = null
      p.won = 0
    }
    this.push()
  }

  private eligible() {
    return [...this.players.values()]
      .filter(p => p.stack > 0)
      .sort((a, b) => a.seatOrder - b.seatOrder)
  }

  startHand() {
    this.cancelPending()
    this.nextHandAt = null
    this.results = null

    const list = this.eligible()
    if (list.length < 2) {
      this.phase = 'ended'
      const champ = list[0] ?? [...this.players.values()].sort((a, b) => b.stack - a.stack)[0]
      this.championId = champ?.id ?? null
      this.push()
      return
    }

    // 重置手牌内状态
    for (const p of this.players.values()) {
      p.inHand = false
      p.folded = false
      p.allIn = false
      p.roundBet = 0
      p.totalBet = 0
      p.cards = []
      p.acted = false
      p.lastAction = null
      p.revealed = false
      p.handDesc = null
      p.won = 0
    }
    for (const p of list) {
      p.inHand = true
      p.cards = []
    }

    this.handNo++
    this.community = []
    this.stage = 'preflop'

    // 庄家轮转：从上一个庄家的下一位有资格玩家开始
    const dealerIdxRaw = this.dealerOrder < 0
      ? Math.floor(this.rng() * list.length)
      : list.findIndex(p => p.seatOrder > this.dealerOrder)
    const dealerIdx = dealerIdxRaw === -1 ? 0 : dealerIdxRaw
    const dealer = list[dealerIdx]
    if (!dealer)
      throw new GameError('没有可参与牌局的玩家')
    this.dealerOrder = dealer.seatOrder
    const heads = list.length === 2
    const sb = heads ? dealer : list[(dealerIdx + 1) % list.length]
    const bb = heads ? list[(dealerIdx + 1) % list.length] : list[(dealerIdx + 2) % list.length]
    if (!sb || !bb)
      throw new GameError('盲注位缺失')

    // 发牌
    const deck = shuffle(newDeck(), this.rng)
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < list.length; i++)
        list[(dealerIdx + 1 + i) % list.length]?.cards.push(deck.pop()!)
    }
    this.remainingDeck = deck

    // 盲注
    this.currentBet = this.cfg.bigBlind
    this.minRaise = this.cfg.bigBlind
    this.commit(sb, Math.min(this.cfg.smallBlind, sb.stack))
    sb.lastAction = { k: 'sb', amount: sb.roundBet }
    this.commit(bb, Math.min(this.cfg.bigBlind, bb.stack))
    bb.lastAction = { k: 'bb', amount: bb.roundBet }

    this.hand = this.buildHandView()

    // 盲注可能直接打光筹码：无人可行动则直接发完公共牌
    const canAct = this.canAct()
    if (canAct.length <= 1) {
      this.toActId = null
      this.deadline = 0
      this.push()
      this.endStreet()
      return
    }
    const first = heads ? sb : this.nextFrom(bb.seatOrder)
    this.beginTurn(first)
  }

  private buildHandView(): HandView {
    return {
      no: this.handNo,
      stage: this.stage,
      community: [...this.community],
      pot: this.potTotal(),
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      toActId: this.toActId,
      deadline: this.deadline,
      results: this.results,
      nextHandAt: this.nextHandAt,
    }
  }

  private potTotal(): number {
    let sum = 0
    for (const p of this.players.values()) sum += p.totalBet
    return sum
  }

  private commit(p: GPlayer, amount: number) {
    const pay = Math.min(amount, p.stack)
    p.stack -= pay
    p.roundBet += pay
    p.totalBet += pay
    if (p.stack === 0)
      p.allIn = true
  }

  private nextFrom(order: number): GPlayer {
    const list = this.eligible().filter(p => p.inHand)
    const idx = list.findIndex(p => p.seatOrder > order)
    const start = idx === -1 ? 0 : idx
    for (let i = 0; i < list.length; i++) {
      const p = list[(start + i) % list.length]
      if (p && p.inHand && !p.folded && !p.allIn && p.stack > 0)
        return p
    }
    throw new GameError('没有可行动的玩家')
  }

  private beginTurn(p: GPlayer) {
    this.toActId = p.id
    p.acted = false
    this.deadline = this.now() + this.cfg.turnMs
    if (p.isBot) {
      const delay = this.cfg.botMinMs + this.rng() * (this.cfg.botMaxMs - this.cfg.botMinMs)
      this.setPending('bot-act', Math.min(delay, this.cfg.turnMs), p.id)
    }
    else {
      this.setPending('turn-timeout', this.cfg.turnMs, p.id)
    }
    this.push()
  }

  private autoAct(p: GPlayer) {
    const toCall = this.currentBet - p.roundBet
    try {
      if (toCall > 0) this.applyFold(p)
      else this.applyCheck(p)
    }
    catch {
      // 状态兜底：绝不让牌局卡死
      this.applyFold(p)
    }
    this.afterAction(p)
  }

  private botAct(p: GPlayer) {
    const decision = decideBot(
      { cards: p.cards, stack: p.stack, roundBet: p.roundBet },
      {
        community: this.community,
        pot: this.potTotal(),
        currentBet: this.currentBet,
        minRaise: this.minRaise,
        bigBlind: this.cfg.bigBlind,
        stage: this.stage,
        oppCount: this.alive().length - 1,
      },
      this.rng,
    )
    try {
      this.apply(p, decision.kind, decision.amount)
    }
    catch {
      if (this.currentBet - p.roundBet > 0) this.applyFold(p)
      else this.applyCheck(p)
    }
    this.afterAction(p)
  }

  /** 玩家/客户端请求行动（含校验）。校验失败时不取消待处理事件 */
  act(playerId: string, kind: ActionKind, amount?: number) {
    const p = this.players.get(playerId)
    if (!this.hand || !this.toActId)
      throw new GameError('当前没有进行中的行动')
    if (this.toActId !== playerId)
      throw new GameError('还没轮到你行动')
    if (!p) throw new GameError('玩家不存在')
    this.apply(p, kind, amount)
    this.cancelPending()
    this.afterAction(p)
  }

  private apply(p: GPlayer, kind: ActionKind, amount?: number) {
    switch (kind) {
      case 'fold': return this.applyFold(p)
      case 'check': return this.applyCheck(p)
      case 'call': return this.applyCall(p)
      case 'raise': return this.applyRaise(p, amount)
    }
  }

  private applyFold(p: GPlayer) {
    p.folded = true
    p.lastAction = { k: 'fold', amount: 0 }
  }

  private applyCheck(p: GPlayer) {
    if (this.currentBet - p.roundBet > 0)
      throw new GameError('有人下注，不能过牌')
    p.lastAction = { k: 'check', amount: 0 }
  }

  private applyCall(p: GPlayer) {
    const toCall = this.currentBet - p.roundBet
    if (toCall <= 0)
      throw new GameError('无人下注，可以过牌')
    this.commit(p, toCall)
    p.lastAction = p.allIn
      ? { k: 'all-in', amount: p.roundBet }
      : { k: 'call', amount: p.roundBet }
  }

  private applyRaise(p: GPlayer, amount?: number) {
    const toCall = this.currentBet - p.roundBet
    const maxTo = p.roundBet + p.stack
    const minTo = toCall === 0
      ? Math.min(this.cfg.bigBlind, maxTo)
      : Math.min(this.currentBet + this.minRaise, maxTo)
    let target = Math.floor(amount ?? 0)
    if (target <= 0) target = minTo
    if (target < minTo)
      throw new GameError(`加注至少到 ${minTo}`)
    if (target > maxTo)
      target = maxTo
    if (target <= this.currentBet && !(target === maxTo && maxTo > this.currentBet))
      throw new GameError('加注必须大于当前注额')

    const raiseSize = target - this.currentBet
    const isAllIn = target === maxTo
    this.commit(p, target - p.roundBet)

    if (raiseSize >= this.minRaise) {
      // 完整加注：更新最小加注额，重新开启其他人的行动权
      this.minRaise = raiseSize
      for (const o of this.alive()) {
        if (o.id !== p.id && !o.allIn)
          o.acted = false
      }
    }
    this.currentBet = Math.max(this.currentBet, target)
    p.lastAction = isAllIn
      ? { k: 'all-in', amount: p.roundBet }
      : toCall === 0
        ? { k: 'bet', amount: p.roundBet }
        : { k: 'raise', amount: p.roundBet }
  }

  private alive(): GPlayer[] {
    return [...this.players.values()].filter(p => p.inHand && !p.folded)
      .sort((a, b) => a.seatOrder - b.seatOrder)
  }

  private canAct(): GPlayer[] {
    return this.alive().filter(p => !p.allIn && p.stack > 0)
  }

  private afterAction(actor: GPlayer) {
    actor.acted = true
    const alive = this.alive()
    const last = alive[0]
    if (alive.length === 1 && last) {
      this.payoutUncontested(last)
      return
    }
    const needAction = this.canAct()
    const settled = needAction.every(p => p.acted && p.roundBet === this.currentBet)
    if (settled) {
      this.toActId = null
      this.endStreet()
    }
    else {
      this.beginTurn(this.nextFrom(actor.seatOrder))
    }
  }

  private advanceStreet() {
    if (this.stage === 'preflop') {
      this.community.push(...this.remainingDeck.splice(0, 3))
      this.stage = 'flop'
    }
    else if (this.stage === 'flop') {
      const card = this.remainingDeck.shift()
      if (card) this.community.push(card)
      this.stage = 'turn'
    }
    else if (this.stage === 'turn') {
      const card = this.remainingDeck.shift()
      if (card) this.community.push(card)
      this.stage = 'river'
    }
    for (const p of this.players.values()) {
      p.roundBet = 0
      p.acted = false
      if (p.inHand && !p.folded)
        p.lastAction = null
    }
    this.currentBet = 0
    this.minRaise = this.cfg.bigBlind
  }

  /** 下一街要发的公共牌所在牌堆 */
  private remainingDeck: CardType[] = []

  private endStreet() {
    if (this.stage === 'river') {
      this.showdown()
      return
    }
    this.advanceStreet()
    const canAct = this.canAct()
    this.push()
    if (canAct.length <= 1) {
      // 其余玩家全下：稍后自动发完剩余公共牌（跑马）
      this.setPending('street', this.cfg.streetMs)
    }
    else {
      this.beginTurn(this.nextFrom(this.dealerOrder))
    }
  }

  /* ---------------------------------- 结算 ---------------------------------- */

  private payoutUncontested(winner: GPlayer) {
    const total = this.potTotal()
    winner.stack += total
    winner.won = total
    this.results = [{ playerId: winner.id, amount: total, desc: null }]
    this.stage = 'showdown'
    this.toActId = null
    for (const p of this.players.values()) p.roundBet = 0
    this.push()
    this.setPending('result', this.cfg.resultMs * 0.7)
  }

  private showdown() {
    this.stage = 'showdown'
    this.toActId = null
    const alive = this.alive()
    for (const p of alive) {
      p.revealed = true
      p.handDesc = describeScore(evaluate([...p.cards, ...this.community]))
    }

    const shares = settlePots([...this.players.values()]
      .filter(p => p.totalBet > 0)
      .map(p => ({
        playerId: p.id,
        seatOrder: p.seatOrder,
        amount: p.totalBet,
        folded: p.folded,
        score: p.folded ? -1 : evaluate([...p.cards, ...this.community]),
      })))

    this.results = []
    for (const [id, amount] of shares) {
      const p = this.players.get(id)!
      p.stack += amount
      p.won += amount
    }
    for (const p of alive)
      this.results.push({ playerId: p.id, amount: p.won, desc: p.handDesc })

    // 结算展示阶段清空本轮下注气泡
    for (const p of this.players.values()) p.roundBet = 0

    this.push()
    this.setPending('result', this.cfg.resultMs)
  }

  private finishHand() {
    this.cancelPending()
    this.toActId = null
    for (const p of this.players.values()) {
      if (p.stack === 0 && p.inHand) {
        p.inHand = false
        p.folded = false
        p.allIn = false
      }
    }
    const withChips = this.eligible()
    if (withChips.length < 2) {
      this.phase = 'ended'
      this.championId = withChips[0]?.id ?? null
      this.nextHandAt = null
      this.push()
      return
    }
    this.nextHandAt = this.now() + this.cfg.nextHandMs
    this.setPending('next-hand', this.cfg.nextHandMs)
    this.push()
  }

  private push() {
    if (this.hand)
      Object.assign(this.hand, this.buildHandView())
    this.onChange()
  }

  /* ---------------------------------- 序列化 ---------------------------------- */

  serialize(): GameSnapshot {
    return {
      cfg: this.cfg,
      phase: this.phase,
      championId: this.championId,
      handNo: this.handNo,
      stage: this.stage,
      dealerOrder: this.dealerOrder,
      community: [...this.community],
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      toActId: this.toActId,
      deadline: this.deadline,
      nextHandAt: this.nextHandAt,
      results: this.results,
      hand: this.hand,
      remainingDeck: [...this.remainingDeck],
      seatSeq: this.seatSeq,
      pendingAt: this.pendingAt,
      pendingKind: this.pendingKind,
      pendingWho: this.pendingWho,
      players: [...this.players.values()],
    }
  }

  /** 从持久化快照恢复； overdue 的待处理事件由下一次 tick() 追赶执行 */
  static restore(snap: GameSnapshot, deps: PokerDeps = {}): PokerGame {
    const game = new PokerGame(deps)
    const { players, ...rest } = snap
    Object.assign(game, rest)
    game.players = new Map(players.map(p => [p.id, p]))
    return game
  }

  /* ---------------------------------- 视图 ---------------------------------- */

  view(forId: string): ClientRoomState {
    const me = this.players.get(forId)
    const seats: SeatView[] = [...this.players.values()]
      .sort((a, b) => a.seatOrder - b.seatOrder)
      .map((p) => {
        const v = baseSeat(p)
        const inHandActive = !!this.hand && p.inHand
        v.status = p.stack === 0 && !p.inHand ? 'busted'
          : inHandActive && p.folded ? 'folded'
            : inHandActive && p.allIn ? 'all-in'
              : inHandActive ? 'in-hand' : 'waiting'
        v.roundBet = p.roundBet
        v.totalBet = p.totalBet
        v.cards = this.hand && p.cards.length > 0 && (p.id === forId || p.revealed)
          ? p.cards.map(c => ({ ...c }))
          : null
        v.isDealer = !!this.hand && p.seatOrder === this.dealerOrder
        v.lastAction = p.lastAction
        v.handDesc = p.handDesc
        v.won = p.won
        return v
      })

    const hand = this.hand
      ? { ...this.hand, community: this.hand.community.map(c => ({ ...c })) }
      : null

    return {
      code: this.code,
      phase: this.phase,
      meId: forId,
      hostId: [...this.players.values()].find(p => p.isHost)?.id ?? '',
      settings: {
        smallBlind: this.cfg.smallBlind,
        bigBlind: this.cfg.bigBlind,
        buyIn: this.cfg.buyIn,
        minPlayers: this.cfg.minPlayers,
        maxPlayers: this.cfg.maxPlayers,
        turnSeconds: Math.round(this.cfg.turnMs / 1000),
      },
      seats,
      hand,
      championId: this.championId,
      notice: null,
      noticeAt: null,
    }
  }

  /** 模糊测试用：校验筹码守恒 */
  totalChips(): number {
    let sum = 0
    for (const p of this.players.values()) sum += p.stack + p.totalBet
    return sum
  }
}
