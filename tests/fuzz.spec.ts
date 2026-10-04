import { describe, expect, it } from 'vitest'
import { PokerGame } from '../server/poker/game'

/** mulberry32 可复现随机源 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function runSeededGame(seed: number) {
  const rng = mulberry32(seed)
  let nowMs = 0
  const now = () => nowMs
  const playerCount = 3 + Math.floor(rng() * 8) // 3..10
  const initial = new Map<string, number>()
  let violations = ''
  let totalChips = 0
  let ready = false

  const check = () => {
    if (!ready) return
    let sum = 0
    for (const p of game.players.values()) {
      if (p.stack < 0) violations = `负筹码: ${p.id}`
      if (p.totalBet < 0 || p.roundBet < 0) violations = '负投注'
      if (p.roundBet > p.totalBet) violations = 'roundBet > totalBet'
      sum += p.stack + p.totalBet - p.won
    }
    if (sum !== totalChips) violations = `筹码不守恒: ${sum} != ${totalChips}`
    if (violations)
      throw new Error(`seed ${seed}: ${violations}`)
  }

  const game = new PokerGame({
    rng,
    now,
    onChange: check,
    config: {
      bigBlind: 100,
      smallBlind: 50,
      turnMs: 20_000,
      botMinMs: 500,
      botMaxMs: 1500,
      streetMs: 500,
      resultMs: 2000,
      nextHandMs: 3000,
    },
  })
  game.code = 'FUZZ'

  for (let i = 0; i < playerCount; i++) {
    // 随机初始筹码制造全下/边池
    const stack = 500 + Math.floor(rng() * 10) * 500
    const g = game.addBot()
    g.stack = stack
    initial.set(g.id, stack)
  }
  totalChips = [...initial.values()].reduce((s, v) => s + v, 0)
  ready = true
  check()

  game.startGame([...game.players.keys()][0]!)

  // 推进到游戏结束（只剩一人有筹码）或达到手数上限；
  // 每次 tick 只执行一个到期事件，模拟轮询驱动
  let hands = 0
  let lastHandNo = 0
  for (let step = 0; step < 300_000; step++) {
    nowMs += 500
    game.tick(nowMs)
    if (game.phase === 'ended') break
    if (game.handNo > lastHandNo) {
      lastHandNo = game.handNo
      hands++
      if (hands > 400) break // 防御上限
    }
  }

  check()
  const withChips = [...game.players.values()].filter(p => p.stack > 0).length
  return { seed, playerCount, hands, ended: game.phase === 'ended', withChips }
}

describe('引擎模糊测试：随机对局不变量', () => {
  const results = []
  for (let seed = 1; seed <= 12; seed++) {
    it(`seed=${seed}`, () => {
      const r = runSeededGame(seed)
      results.push(r)
      // 每一局都在不变量校验下运行，跑到结束或 400 手
      expect(r.playerCount).toBeGreaterThanOrEqual(3)
    })
  }
  it('汇总：多数随机局能在 400 手内分出胜负', () => {
    const endedRatio = results.filter(r => r.ended).length / results.length
    console.log('对局结果:', results)
    expect(results.length).toBe(12)
    expect(endedRatio).toBeGreaterThan(0.5)
  })
})
