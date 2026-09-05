import { describe, expect, it } from 'vitest'
import { settlePots, type PotEntry } from '../server/poker/pots'

const e = (playerId: string, seatOrder: number, amount: number, folded = false, score = 100): PotEntry =>
  ({ playerId, seatOrder, amount, folded, score })

describe('settlePots 边池结算', () => {
  it('单一主池：赢家通吃', () => {
    const won = settlePots([
      e('a', 1, 500, false, 300),
      e('b', 2, 500, false, 200),
      e('c', 3, 500, true, -1),
    ])
    expect(won.get('a')).toBe(1500)
    expect(won.size).toBe(1)
  })

  it('三层边池：各层归属各自赢家', () => {
    // a 全下 300，b 全下 800，c 覆盖 2000；c 牌最大
    const won = settlePots([
      e('a', 1, 300, false, 100),
      e('b', 2, 800, false, 200),
      e('c', 3, 2000, false, 300),
    ])
    // L300: 900（a/b/c 各 300）→ c；L800: 1000（b/c 各 500）→ c；L2000: 1200 仅 c
    expect(won.get('c')).toBe(900 + 1000 + 1200)
    expect(won.has('a')).toBe(false)
  })

  it('中层赢家只拿对应层', () => {
    // a 最小，b 中间牌力，c 最大
    const won = settlePots([
      e('a', 1, 300, false, 100),
      e('b', 2, 800, false, 200),
      e('c', 3, 2000, false, 300),
    ])
    // 反过来让 b 最大：
    const won2 = settlePots([
      e('a', 1, 300, false, 100),
      e('b', 2, 800, false, 300),
      e('c', 3, 2000, false, 200),
    ])
    expect(won2.get('b')).toBe(900 + 1000)
    expect(won2.get('c')).toBe(1200)
    expect(won.get('c')).toBe(3100)
  })

  it('弃牌者投入归池但不可赢池', () => {
    const won = settlePots([
      e('a', 1, 1000, true, -1),
      e('b', 2, 400, false, 200),
      e('c', 3, 400, false, 300),
    ])
    // 全部 1800 进入各层，但只有 b/c 可分
    expect(won.get('c')).toBe(1800)
  })

  it('平分时余数按座次分配', () => {
    const won = settlePots([
      e('a', 5, 101, false, 300),
      e('b', 2, 101, false, 300),
      e('c', 8, 101, false, 100),
    ])
    expect(won.get('b')).toBe(152) // 座次靠前先拿余数
    expect(won.get('a')).toBe(151)
    expect(won.has('c')).toBe(false)
  })

  it('分配总额恒等于投入总额', () => {
    const won = settlePots([
      e('a', 1, 777, true, -1),
      e('b', 2, 123, false, 50),
      e('c', 3, 999, false, 400),
      e('d', 4, 456, false, 300),
    ])
    const total = 777 + 123 + 999 + 456
    const sum = [...won.values()].reduce((s, v) => s + v, 0)
    expect(sum).toBe(total)
  })
})
