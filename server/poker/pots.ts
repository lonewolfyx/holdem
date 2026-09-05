/**
 * 边池结算：按每个玩家的总投入分层构建底池，逐层比牌分配。
 * 纯函数，便于单元测试。
 */

export interface PotEntry {
  playerId: string
  seatOrder: number
  /** 本手牌总投入 */
  amount: number
  /** 已弃牌（投入归池但无权赢池） */
  folded: boolean
  /** 7 张牌评估分值；弃牌者可传 -1 */
  score: number
}

/** 返回每个玩家赢得的筹码数（只含赢家） */
export function settlePots(entries: PotEntry[]): Map<string, number> {
  const contribs = entries.filter(e => e.amount > 0)
  const levels = [...new Set(contribs.map(e => e.amount))].sort((a, b) => a - b)
  const won = new Map<string, number>()
  let prev = 0

  // 逐层构建：金额 + 有权赢该层的玩家
  const pots: Array<{ amount: number, eligible: PotEntry[] }> = []
  for (const level of levels) {
    let amount = 0
    for (const e of contribs)
      amount += Math.min(Math.max(e.amount - prev, 0), level - prev)
    const eligible = contribs.filter(e => !e.folded && e.amount >= level)
    if (amount > 0)
      pots.push({ amount, eligible })
    prev = level
  }

  // 弃牌超额投入形成的“无人层”并入最后一个有资格者的层
  let orphan = 0
  const distribute = pots.filter(p => p.eligible.length > 0)
  for (const pot of pots) {
    if (pot.eligible.length === 0) {
      orphan += pot.amount
      continue
    }
    pot.amount += orphan
    orphan = 0
  }
  if (orphan > 0 && distribute.length > 0)
    distribute[distribute.length - 1]!.amount += orphan

  for (const pot of distribute) {
    const best = Math.max(...pot.eligible.map(e => e.score))
    const winners = pot.eligible.filter(e => e.score === best)
      .sort((a, b) => a.seatOrder - b.seatOrder)
    const share = Math.floor(pot.amount / winners.length)
    let remainder = pot.amount - share * winners.length
    for (const w of winners) {
      let got = share
      if (remainder > 0) {
        got++
        remainder--
      }
      won.set(w.playerId, (won.get(w.playerId) ?? 0) + got)
    }
  }
  return won
}
