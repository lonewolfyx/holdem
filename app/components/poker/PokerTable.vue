<script setup lang="ts">
import { computed } from 'vue'
import { useNow } from '~/composables/useNow'
import { useRoom } from '~/composables/useRoom'
import { fmtChips } from '~/lib/format'

const { state, seats, hand, me } = useRoom()
const now = useNow(200)

/**
 * 跑道形（体育场形）桌沿定位。
 * 以「半高」为单位：半宽 A = 1.82（容器宽高比 1.82），端盖半径 r = 1，
 * 上下直边半长 = A - 1。railPoint 求屏幕角度射线与桌沿的交点，
 * 让每个座位的胶囊中心精确压在桌沿上（与设计稿一致）。
 */
const CX = 50
const CY = 50
const A = 1.82
const STRAIGHT = A - 1

function railPoint(deg: number): { x: number, y: number } {
  const rad = deg * (Math.PI / 180)
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  let t: number
  if (Math.abs(dy) > 1e-9 && Math.abs(dx) / Math.abs(dy) <= STRAIGHT) {
    // 从上/下直边射出
    t = 1 / Math.abs(dy)
  }
  else {
    // 从左/右半圆端盖射出：解 |P - C|² = r²，C = (sign(dx)·STRAIGHT, 0)
    const s = dx >= 0 ? 1 : -1
    t = s * STRAIGHT * dx + Math.sqrt((STRAIGHT * dx) ** 2 + 1 - STRAIGHT ** 2)
  }
  return {
    x: 50 + (dx * t / A) * 50,
    y: 50 + dy * t * 50,
  }
}

const myIndex = computed(() =>
  seats.value.findIndex(s => s.id === state.value?.meId))

/** 座位环形布局：自己永远在正下方，按行动顺序顺时针展开 */
const placed = computed(() => {
  const n = seats.value.length
  const anchor = Math.max(myIndex.value, 0)
  return seats.value.map((seat, i) => {
    const k = (i - anchor + n) % n
    const deg = 90 + (k * 360) / n
    const { x, y } = railPoint(deg)
    const dx = CX - x
    const dy = CY - y
    const len = Math.hypot(dx, dy) || 1
    const nx = dx / len
    const ny = dy / len
    // 下半区座位的下注气泡放在胶囊右上角，避免被自己的手牌遮挡
    const betPos = y > CY
      ? { x: x + 8.5, y: y - 4.5 }
      : { x: x + dx * 0.24, y: y + dy * 0.24 }
    // 下半区座位的庄家钮放胶囊右侧
    const dealerPos = y > CY
      ? { x: x + 10.5, y: y + 0.5 }
      : { x: x + nx * len * 0.38 - ny * 6.5, y: y + ny * len * 0.38 + nx * 6.5 }
    return {
      seat,
      pos: { x, y },
      betPos,
      dealerPos,
    }
  })
})

const remainMap = computed(() => {
  const map = new Map<string, number>()
  if (hand.value?.toActId && hand.value.deadline > 0) {
    map.set(hand.value.toActId, Math.max(0, Math.ceil((hand.value.deadline - now.value) / 1000)))
  }
  return map
})

const showResult = computed(() =>
  !!hand.value && hand.value.stage === 'showdown' && !!hand.value.results && hand.value.results.length > 0)

/** 摊牌横幅 */
const resultBanner = computed(() => {
  if (!showResult.value || !hand.value?.results) return null
  const parts: string[] = []
  for (const r of hand.value.results) {
    if (r.amount <= 0) continue
    const seat = seats.value.find(s => s.id === r.playerId)
    if (!seat) continue
    parts.push(`${seat.avatar} ${seat.name} +${fmtChips(r.amount)}${r.desc ? `（${r.desc}）` : ''}`)
  }
  return parts.join('　')
})

/** 公共牌槽位（始终 5 个） */
const communitySlots = computed(() => {
  const cards = hand.value?.community ?? []
  return Array.from({ length: 5 }, (_, i) => cards[i] ?? null)
})

const nextIn = computed(() => {
  if (!hand.value?.nextHandAt) return null
  return Math.max(0, Math.ceil((hand.value.nextHandAt - now.value) / 1000))
})
</script>

<template>
  <div class="relative mx-auto aspect-[1.82] w-[min(100%,1180px,calc((100dvh-210px)*1.82))]">
    <!-- 跑道形桌面：上下长直边 + 左右半圆端（真实扑克桌形状，非纯椭圆） -->
    <div
      class="absolute inset-0 bg-[#f3f3f4] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03),inset_0_2px_24px_rgba(0,0,0,0.02)]"
      :style="{ borderRadius: '27.4725% / 50%' }"
    />

    <!-- 牌局未开始时的桌面水印 -->
    <div
      v-if="!hand"
      class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[64px] font-bold text-neutral-200/80 select-none"
    >
      ♠
    </div>

    <!-- 底池 -->
    <div
      v-if="hand"
      class="absolute left-1/2 top-[33%] -translate-x-1/2 -translate-y-1/2"
    >
      <div class="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[13px] ring-1 ring-black/[0.06] shadow-sm">
        <span class="text-neutral-400">底池</span>
        <span class="font-bold text-neutral-900">{{ fmtChips(hand.pot) }}</span>
      </div>
    </div>

    <!-- 公共牌 -->
    <div class="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 gap-2">
      <template v-for="(c, i) in communitySlots" :key="i">
        <PokerCardView v-if="c" :card="c" size="lg" />
        <div
          v-else-if="hand"
          class="grid place-items-center rounded-[11px] bg-white/60 ring-1 ring-black/[0.04] text-neutral-200"
          style="width: 58px; height: 82px"
        >
          <span class="text-[20px]">♠</span>
        </div>
      </template>
    </div>

    <!-- 摊牌结果横幅 -->
    <div
      v-if="resultBanner"
      class="absolute left-1/2 top-[25%] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-neutral-700 ring-1 ring-emerald-200 shadow-[0_4px_16px_rgba(16,185,129,0.15)] whitespace-nowrap"
    >
      {{ resultBanner }}
    </div>

    <!-- 下一局倒计时 -->
    <div
      v-if="nextIn != null"
      class="absolute left-1/2 top-[25%] -translate-x-1/2 rounded-full bg-white px-3.5 py-1.5 text-[12px] text-neutral-400 ring-1 ring-black/[0.06]"
    >
      下一局 · {{ nextIn }}s
    </div>

    <!-- 座位 -->
    <PokerSeatView
      v-for="p in placed"
      :key="p.seat.id"
      :seat="p.seat"
      :pos="p.pos"
      :bet-pos="p.betPos"
      :dealer-pos="p.dealerPos"
      :is-hero="p.seat.id === state?.meId"
      :is-turn="hand?.toActId === p.seat.id"
      :remain-seconds="remainMap.get(p.seat.id) ?? null"
      :show-result="showResult"
      :has-hand="!!hand"
    />
  </div>
</template>

