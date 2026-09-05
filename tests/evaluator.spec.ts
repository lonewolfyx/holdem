import { describe, expect, it } from 'vitest'
import { describeScore, evaluate } from '../server/poker/evaluator'
import { newDeck, shuffle } from '../server/poker/cards'

type SS = 0 | 1 | 2 | 3
const c = (r: number, s: SS) => ({ r, s })

describe('evaluate 牌型排序', () => {
  const cases: Array<{ name: string, cards: ReturnType<typeof c>[] }> = [
    { name: '高牌', cards: [c(2, 0), c(7, 1), c(9, 2), c(11, 3), c(13, 0)] },
    { name: '一对', cards: [c(2, 0), c(2, 1), c(9, 2), c(11, 3), c(13, 0)] },
    { name: '两对', cards: [c(2, 0), c(2, 1), c(9, 2), c(9, 3), c(13, 0)] },
    { name: '三条', cards: [c(2, 0), c(2, 1), c(2, 2), c(11, 3), c(13, 0)] },
    { name: '顺子', cards: [c(5, 0), c(6, 1), c(7, 2), c(8, 3), c(9, 0)] },
    { name: '同花', cards: [c(2, 0), c(7, 0), c(9, 0), c(11, 0), c(13, 0)] },
    { name: '葫芦', cards: [c(2, 0), c(2, 1), c(2, 2), c(13, 3), c(13, 0)] },
    { name: '四条', cards: [c(2, 0), c(2, 1), c(2, 2), c(2, 3), c(13, 0)] },
    { name: '同花顺', cards: [c(5, 0), c(6, 0), c(7, 0), c(8, 0), c(9, 0)] },
    { name: '皇家同花顺', cards: [c(10, 0), c(11, 0), c(12, 0), c(13, 0), c(14, 0)] },
  ]

  it('类别严格递增', () => {
    for (let i = 1; i < cases.length; i++) {
      const prev = evaluate(cases[i - 1].cards)
      const cur = evaluate(cases[i].cards)
      expect(cur, `${cases[i].name} 应大于 ${cases[i - 1].name}`).toBeGreaterThan(prev)
    }
  })

  it('描述正确', () => {
    expect(describeScore(evaluate(cases[9].cards))).toBe('皇家同花顺')
    expect(describeScore(evaluate(cases[6].cards))).toBe('葫芦（2 带 K）')
    expect(describeScore(evaluate(cases[1].cards))).toBe('一对 2')
    expect(describeScore(evaluate(cases[4].cards))).toBe('顺子（9 高）')
  })

  it('轮子 A2345 是 5 高顺子，弱于 23456', () => {
    const wheel = [c(14, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)]
    const six = [c(2, 1), c(3, 2), c(4, 3), c(5, 0), c(6, 1)]
    expect(evaluate(six)).toBeGreaterThan(evaluate(wheel))
    expect(describeScore(evaluate(wheel))).toBe('顺子（5 高）')
  })

  it('同花比大小依次比较踢脚', () => {
    const a = [c(14, 0), c(13, 0), c(9, 0), c(5, 0), c(3, 0)]
    const b = [c(14, 1), c(13, 1), c(9, 1), c(5, 1), c(2, 1)]
    expect(evaluate(a)).toBeGreaterThan(evaluate(b))
  })

  it('平分秋色时分值相同', () => {
    const a = [c(14, 0), c(13, 0), c(9, 0), c(5, 0), c(3, 0)]
    const b = [c(14, 1), c(13, 1), c(9, 1), c(5, 1), c(3, 1)]
    expect(evaluate(a)).toBe(evaluate(b))
  })
})

describe('evaluate 7 选 5', () => {
  it('从 7 张中选出最佳 5 张', () => {
    // 公共牌构成同花 9 高，手牌对 K 用不上
    const seven = [
      c(2, 0), c(5, 0), c(7, 0), c(9, 0), c(11, 0),
      c(13, 1), c(13, 2),
    ]
    const expectFlush = [c(2, 0), c(5, 0), c(7, 0), c(9, 0), c(11, 0)]
    expect(evaluate(seven)).toBe(evaluate(expectFlush))
  })

  it('7 张中顺子优先于低对', () => {
    const seven = [c(5, 0), c(6, 1), c(7, 2), c(8, 3), c(9, 0), c(9, 1), c(2, 2)]
    const expectStraight = [c(5, 0), c(6, 1), c(7, 2), c(8, 3), c(9, 0)]
    expect(evaluate(seven)).toBe(evaluate(expectStraight))
  })

  it('随机牌堆不抛错且分值域正确', () => {
    for (let i = 0; i < 500; i++) {
      const deck = shuffle(newDeck())
      const seven = deck.slice(0, 7)
      const s = evaluate(seven)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(8 * 16 ** 5 + 14 * 16 ** 4 + 14 * 16 ** 3 + 14 * 16 ** 2 + 14 * 16 + 14)
    }
  })
})
