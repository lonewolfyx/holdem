export interface Card {
  /** 点数 2..14（14 = A） */
  r: number
  /** 花色 0♠ 1♥ 2♣ 3♦ */
  s: number
}

export const SUIT_GLYPHS = ['♠', '♥', '♣', '♦'] as const
export const RED_SUITS = new Set([1, 3])

export const RANK_NAMES: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

export function newDeck(): Card[] {
  const deck: Card[] = []
  for (let s = 0; s < 4; s++)
    for (let r = 2; r <= 14; r++)
      deck.push({ r, s })
  return deck
}

/** Fisher–Yates 洗牌（可注入随机源便于测试） */
export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]!
    arr[i] = arr[j]!
    arr[j] = tmp
  }
  return arr
}

export function cardLabel(c: Card): string {
  return `${RANK_NAMES[c.r]}${SUIT_GLYPHS[c.s]}`
}
