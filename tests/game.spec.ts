import { describe, expect, it } from 'vitest'
import { PokerGame, type Scheduler } from '../server/poker/game'

/** 虚拟时钟：手动推进定时器，确定性测试 */
class FakeClock {
  nowMs = 0
  private seq = 0
  private items: Array<{ at: number, fn: () => void, seq: number }> = []

  schedule = (fn: () => void, ms: number): (() => void) => {
    const item = { at: this.nowMs + ms, fn, seq: this.seq++ }
    this.items.push(item)
    return () => {
      this.items = this.items.filter(i => i !== item)
    }
  }

  now = () => this.nowMs

  advance(to: number) {
    for (;;) {
      const due = this.items.filter(i => i.at <= to)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (!due) break
      this.nowMs = Math.max(this.nowMs, due.at)
      this.items = this.items.filter(i => i !== due)
      due.fn()
    }
    this.nowMs = Math.max(this.nowMs, to)
  }

  get pending() {
    return this.items.length
  }
}

function makeGame(clock: FakeClock) {
  const game = new PokerGame({
    schedule: clock.schedule as Scheduler,
    now: clock.now,
    config: {
      turnMs: 25_000,
      botMinMs: 1000,
      botMaxMs: 2000,
      streetMs: 1000,
      resultMs: 5000,
      nextHandMs: 1e12, // 测试中不自动开下一局
    },
  })
  game.code = 'TEST'
  return game
}

const join3 = (game: PokerGame) => {
  game.join({ id: 'a', name: 'A', avatar: '🦊', isBot: false })
  game.join({ id: 'b', name: 'B', avatar: '🐼', isBot: false })
  game.join({ id: 'c', name: 'C', avatar: '🐸', isBot: false })
}

describe('PokerGame 引擎', () => {
  it('发牌与盲注正确', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    expect(game.phase).toBe('playing')
    expect(game.hand).not.toBeNull()
    expect(game.hand!.pot).toBe(150) // 50 + 100
    for (const p of game.players.values())
      expect(p.cards.length).toBe(2)
    expect(game.toActId).not.toBeNull()
  })

  it('平跟到河牌并摊牌，筹码守恒', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    // 翻牌前全部跟注/过牌
    let g1 = 0
    while (game.stage === 'preflop' && game.toActId && g1++ < 10) {
      const p = game.players.get(game.toActId)!
      const toCall = game.currentBet - p.roundBet
      if (toCall > 0) game.act(game.toActId, 'call')
      else game.act(game.toActId, 'check')
    }
    // 之后各街无人下注，超时自动过牌直到摊牌
    for (let i = 0; i < 30 && !game.hand?.results; i++)
      clock.advance(clock.nowMs + 26_000)
    expect(game.hand?.results).not.toBeNull()
    // 结算后 totalBet 仅作展示，守恒看纯筹码和
    const stacks = [...game.players.values()].reduce((s, p) => s + p.stack, 0)
    expect(stacks).toBe(3 * game.cfg.buyIn)
    // community 应该有 5 张
    expect(game.community.length).toBe(5)
  })

  it('有人下注其余全弃：赢家直接收池且不亮牌', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    // 找到行动玩家，先让所有人弃牌（超时自动弃牌仅当有人下注，因此直接手动弃）
    let guard = 0
    while (game.toActId && guard++ < 10) {
      game.act(game.toActId, 'fold')
    }
    expect(game.hand?.results).not.toBeNull()
    const winner = game.hand!.results![0]
    expect(winner.amount).toBe(game.hand!.pot)
    // 不亮牌
    for (const p of game.players.values())
      expect(p.revealed).toBe(false)
  })

  it('玩家行动：跟注/加注/最小加注校验', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    const first = game.toActId!
    // 非行动玩家不能行动
    const other = ['a', 'b', 'c'].find(id => id !== first)!
    expect(() => game.act(other, 'call')).toThrow()
    // 跟注
    game.act(first, 'call')
    const fp = game.players.get(first)!
    expect(fp.roundBet).toBe(100)
    // 下一个玩家：若面对下注则最小加注到 200（加注额≥前一注 100）；若是BB选项则是开池下注（最小 100）
    const second = game.toActId!
    const sp = game.players.get(second)!
    const toCall = game.currentBet - sp.roundBet
    if (toCall > 0) {
      expect(() => game.act(second, 'raise', 150)).toThrow()
      game.act(second, 'raise', 200)
      expect(game.players.get(second)!.roundBet).toBe(200)
      expect(game.currentBet).toBe(200)
    }
    else {
      expect(() => game.act(second, 'raise', 50)).toThrow() // 低于大盲
      game.act(second, 'raise', 250)
      expect(game.players.get(second)!.roundBet).toBe(250)
      expect(game.currentBet).toBe(250)
    }
  })

  it('短筹码全下触发边池与跑马', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    // 直接压缩筹码制造全下场景
    game.players.get('a')!.stack = 300
    game.players.get('b')!.stack = 1000
    game.players.get('c')!.stack = 1000
    game.startGame('a')

    let guard = 0
    while (!game.hand?.results && guard++ < 100) {
      const toAct = game.toActId
      if (toAct) {
        const p = game.players.get(toAct)!
        const toCall = game.currentBet - p.roundBet
        if (toCall <= 0)
          game.act(toAct, 'check')
        else
          game.act(toAct, 'call')
      }
      else {
        clock.advance(clock.nowMs + 2000) // 跑马发牌
      }
    }
    expect(game.hand?.results).not.toBeNull()
    const stacks = [...game.players.values()].reduce((s, p) => s + p.stack, 0)
    expect(stacks).toBe(2300)
    // 摊牌阶段所有人 roundBet 清零展示
    for (const p of game.players.values())
      expect(p.roundBet).toBe(0)
  })

  it('重连后视图只泄露自己的底牌', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    const viewA = game.view('a')
    const viewB = game.view('b')
    for (const s of viewA.seats) {
      if (s.id !== 'a') expect(s.cards).toBeNull()
      else expect(s.cards).not.toBeNull()
    }
    for (const s of viewB.seats) {
      if (s.id !== 'b') expect(s.cards).toBeNull()
      else expect(s.cards).not.toBeNull()
    }
  })

  it('超时自动行动：需跟注时弃牌、无需跟注时过牌', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    join3(game)
    game.startGame('a')
    const first = game.toActId!
    clock.advance(clock.nowMs + 26_000)
    expect(game.players.get(first)!.folded).toBe(true) // 面对大盲注，超时弃牌
  })

  it('机器人完整对局能正常结束', () => {
    const clock = new FakeClock()
    const game = makeGame(clock)
    game.join({ id: 'h', name: '人', avatar: '🦊', isBot: false })
    game.addBot()
    game.addBot()
    game.startGame('h')
    let guard = 0
    while (!game.hand?.results && guard++ < 200)
      clock.advance(clock.nowMs + 3000)
    expect(game.hand?.results).not.toBeNull()
  })
})
