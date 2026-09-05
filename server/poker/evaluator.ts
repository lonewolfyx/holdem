import type { Card } from './cards'
import { RANK_NAMES } from './cards'

/**
 * 7 选 5 德州扑克牌力评估。
 * 返回可比较的整数分值：类别(0..8) * 16^5 + 决胜张（高位在前，base-16）。
 * 分值越大牌越强。
 */

export const CATEGORY = {
  HIGH: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const

interface Scored {
  score: number
  cat: number
  tie: number[]
}

function score5(cards: Card[]): Scored {
  const rs = cards.map(c => c.r).sort((a, b) => b - a)
  const isFlush = cards.every(c => c.s === cards[0]!.s)

  let straightHigh = 0
  const uniq = [...new Set(rs)]
  if (uniq.length === 5) {
    const [r0, r1, r4] = [rs[0]!, rs[1]!, rs[4]!]
    if (r0 - r4 === 4)
      straightHigh = r0
    else if (r0 === 14 && r1 === 5) // A2345 轮子
      straightHigh = 5
  }

  const cnt = new Map<number, number>()
  for (const r of rs) cnt.set(r, (cnt.get(r) ?? 0) + 1)
  // 按数量降序、点数降序排列（5 张牌至少存在一组）
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const g = (i: number): [number, number] => groups[i] ?? [0, 0]

  let cat: number
  let tie: number[]
  if (straightHigh && isFlush) {
    cat = CATEGORY.STRAIGHT_FLUSH
    tie = [straightHigh]
  }
  else if (g(0)[1] === 4) {
    cat = CATEGORY.QUADS
    tie = [g(0)[0], g(1)[0]]
  }
  else if (g(0)[1] === 3 && g(1)[1] === 2) {
    cat = CATEGORY.FULL_HOUSE
    tie = [g(0)[0], g(1)[0]]
  }
  else if (isFlush) {
    cat = CATEGORY.FLUSH
    tie = rs
  }
  else if (straightHigh) {
    cat = CATEGORY.STRAIGHT
    tie = [straightHigh]
  }
  else if (g(0)[1] === 3) {
    cat = CATEGORY.TRIPS
    tie = [g(0)[0], g(1)[0], g(2)[0]]
  }
  else if (g(0)[1] === 2 && g(1)[1] === 2) {
    cat = CATEGORY.TWO_PAIR
    tie = [g(0)[0], g(1)[0], g(2)[0]]
  }
  else if (g(0)[1] === 2) {
    cat = CATEGORY.PAIR
    tie = [g(0)[0], g(1)[0], g(2)[0], g(3)[0]]
  }
  else {
    cat = CATEGORY.HIGH
    tie = rs
  }

  let score = cat
  for (let i = 0; i < 5; i++) score = score * 16 + (tie[i] ?? 0)
  return { score, cat, tie }
}

function* combinations5(n: number): Generator<number[]> {
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++)
            yield [a, b, c, d, e]
}

/** 评估 5~7 张牌中的最佳 5 张，返回可比较分值 */
export function evaluate(cards: Card[]): number {
  if (cards.length < 5)
    throw new Error(`评估至少需要 5 张牌，收到 ${cards.length}`)
  if (cards.length === 5)
    return score5(cards).score
  let best = -1
  for (const idx of combinations5(cards.length)) {
    const five = idx.map(i => cards[i]!)
    const s = score5(five).score
    if (s > best) best = s
  }
  return best
}

/** 从分值反解出中文牌型描述 */
export function describeScore(score: number): string {
  const tie: number[] = []
  let s = score
  for (let i = 0; i < 5; i++) {
    tie.unshift(s % 16)
    s = Math.floor(s / 16)
  }
  const cat = s
  const n = (v: number | undefined) => RANK_NAMES[v ?? 0] ?? String(v ?? 0)
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH:
      return tie[0] === 14 ? '皇家同花顺' : `同花顺（${n(tie[0])} 高）`
    case CATEGORY.QUADS:
      return `四条 ${n(tie[0])}`
    case CATEGORY.FULL_HOUSE:
      return `葫芦（${n(tie[0])} 带 ${n(tie[1])}）`
    case CATEGORY.FLUSH:
      return `同花（${n(tie[0])} 高）`
    case CATEGORY.STRAIGHT:
      return `顺子（${n(tie[0])} 高）`
    case CATEGORY.TRIPS:
      return `三条 ${n(tie[0])}`
    case CATEGORY.TWO_PAIR:
      return `两对（${n(tie[0])} 和 ${n(tie[1])}）`
    case CATEGORY.PAIR:
      return `一对 ${n(tie[0])}`
    default:
      return `高牌 ${n(tie[0])}`
  }
}
