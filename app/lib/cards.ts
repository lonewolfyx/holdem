/** 牌面渲染辅助（客户端） */
export const SUIT_GLYPHS = ['♠', '♥', '♣', '♦'] as const
export const RED_SUITS = new Set([1, 3])
export const RANK_NAMES: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
  9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}
