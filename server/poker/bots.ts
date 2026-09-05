import type { ActionKind, Stage } from '#shared/protocol'
import type { Card } from './cards'
import { evaluate, CATEGORY } from './evaluator'

export type Rng = () => number

interface BotHand {
  cards: Card[]
  stack: number
  roundBet: number
}

interface BotCtx {
  community: Card[]
  pot: number
  currentBet: number
  minRaise: number
  bigBlind: number
  stage: Stage
  oppCount: number
}

/** 估算翻牌前手牌强度 0..1（简化版，足够休闲对局） */
function preflopStrength(cards: Card[]): number {
  const sorted = [...cards].sort((x, y) => y.r - x.r)
  const a = sorted[0]!
  const b = sorted[1]!
  if (a.r === b.r)
    return Math.min(1, 0.52 + (a.r - 2) * 0.024)
  let s = (a.r + b.r - 5) / 24
  if (a.s === b.s) s += 0.05
  const gap = a.r - b.r
  if (gap === 1) s += 0.03
  else if (gap === 2) s += 0.015
  if (a.r >= 12 && b.r >= 10) s += 0.06
  return Math.max(0.05, Math.min(0.95, s))
}

/** 根据当前成牌估算强度 0..1 */
function madeStrength(cards: Card[], community: Card[]): number {
  const score = evaluate([...cards, ...community])
  const cat = Math.floor(score / 16 ** 5)
  const bases: Record<number, number> = {
    [CATEGORY.HIGH]: 0.2,
    [CATEGORY.PAIR]: 0.4,
    [CATEGORY.TWO_PAIR]: 0.58,
    [CATEGORY.TRIPS]: 0.66,
    [CATEGORY.STRAIGHT]: 0.76,
    [CATEGORY.FLUSH]: 0.8,
    [CATEGORY.FULL_HOUSE]: 0.88,
    [CATEGORY.QUADS]: 0.95,
    [CATEGORY.STRAIGHT_FLUSH]: 0.99,
  }
  const top = Math.floor(score / 16 ** 4) % 16
  const base = bases[cat] ?? 0.2
  return Math.max(0.05, Math.min(0.99, base + (top - 8) * 0.008))
}

/** 机器人决策：简单但合理的范围 + 底池赔率策略 */
export function decideBot(
  me: BotHand,
  ctx: BotCtx,
  rng: Rng,
): { kind: ActionKind, amount?: number } {
  const toCall = Math.max(0, ctx.currentBet - me.roundBet)
  const maxTo = me.roundBet + me.stack
  const strength = ctx.stage === 'preflop'
    ? preflopStrength(me.cards)
    : madeStrength(me.cards, ctx.community)
  const jitter = (rng() - 0.5) * 0.08

  const raiseTarget = (mult: number) => {
    const base = ctx.currentBet > 0
      ? Math.max(ctx.currentBet * mult, ctx.bigBlind * 3)
      : Math.max(Math.round(ctx.pot * mult), ctx.bigBlind * 2)
    return Math.min(Math.round(base), maxTo)
  }

  const doCall = (): { kind: ActionKind, amount?: number } =>
    toCall === 0 ? { kind: 'check' } : { kind: 'call' }
  const doRaise = (): { kind: ActionKind, amount?: number } => ({
    kind: 'raise',
    amount: raiseTarget(2.2 + rng() * 0.6),
  })

  const potOdds = toCall > 0 ? toCall / (ctx.pot + toCall) : 0
  const s = strength + jitter
  const facingRaise = toCall > ctx.bigBlind

  if (toCall >= me.stack) {
    // 被逼全下：只在强牌时跟
    return s > 0.78 || (potOdds < 0.25 && s > 0.6) ? { kind: 'call' } : { kind: 'fold' }
  }

  if (toCall === 0) {
    if (s > 0.72) return doRaise()
    if (s > 0.5 && rng() < 0.45) return doRaise()
    if (rng() < 0.1) return doRaise() // 偷盲/诈唬
    return { kind: 'check' }
  }

  // 面对下注
  if (facingRaise && s > 0.85 && rng() < 0.65)
    return doRaise()
  if (!facingRaise && s > 0.78 && rng() < 0.5)
    return doRaise()
  if (s > potOdds + 0.04)
    return doCall()
  if (s > potOdds - 0.08 && rng() < 0.25)
    return doCall()
  return { kind: 'fold' }
}
