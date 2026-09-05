<script setup lang="ts">
import type { SeatView } from '#shared/protocol'
import { computed } from 'vue'
import { actionLabel, fmtChips } from '~/lib/format'

const props = withDefaults(defineProps<{
  seat: SeatView
  isHero: boolean
  isTurn: boolean
  /** 轮到该玩家时的剩余秒数 */
  remainSeconds: number | null
  pos: { x: number, y: number }
  betPos: { x: number, y: number }
  dealerPos: { x: number, y: number } | null
  /** 摊牌展示阶段 */
  showResult: boolean
  hasHand: boolean
}>(), {
  remainSeconds: null,
  dealerPos: null,
})

const at = (p: { x: number, y: number }) => ({ left: `${p.x}%`, top: `${p.y}%` })

const inHand = computed(() => props.seat.status === 'in-hand' || props.seat.status === 'all-in')
const revealed = computed(() => props.seat.cards != null && props.seat.cards.length > 0)
const isWinner = computed(() => props.showResult && props.seat.won > 0)

const statusPill = computed(() => {
  const s = props.seat
  if (s.status === 'busted') return '出局'
  if (s.status === 'folded') return '已弃牌'
  if (props.isTurn && props.remainSeconds != null) return `思考中 · ${props.remainSeconds}s`
  return null
})

/** 下注气泡内容 */
const betPill = computed(() => {
  const s = props.seat
  if (props.showResult && s.won > 0)
    return { text: `+${fmtChips(s.won)}`, tone: 'win' as const }
  if (s.roundBet > 0)
    return { text: fmtChips(s.roundBet), tone: 'bet' as const }
  if (s.status === 'folded' && s.lastAction?.k === 'fold')
    return { text: '弃牌', tone: 'fold' as const }
  return null
})
</script>

<template>
  <div
    class="absolute inset-0 pointer-events-none"
    :class="isTurn || isWinner ? 'z-30' : 'z-20'"
  >
    <!-- 卡片：绝对定位于容器，锚点在胶囊上方 -->
    <div
      v-if="hasHand && (inHand || revealed) && seat.status !== 'folded'"
      class="absolute -translate-x-1/2 -translate-y-full"
      :style="{ ...at(pos), marginTop: '-58px' }"
    >
      <div v-if="revealed" class="flex gap-1">
        <PokerCardView
          v-for="(c, i) in seat.cards!"
          :key="i"
          :card="c"
          :size="isHero ? 'lg' : 'md'"
        />
      </div>
      <div v-else class="flex gap-1">
        <PokerCardView :size="isHero ? 'lg' : 'sm'" />
        <PokerCardView :size="isHero ? 'lg' : 'sm'" />
      </div>
    </div>

    <!-- 玩家胶囊 -->
    <div
      class="absolute -translate-x-1/2 -translate-y-1/2"
      :style="at(pos)"
    >
      <div
        class="flex items-center gap-2 rounded-full bg-white py-1 pl-1.5 pr-4 ring-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow duration-300"
        :class="[
          isWinner ? 'ring-2 ring-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : '',
          isTurn && !isWinner ? 'ring-2 ring-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.12)] scale-[1.03]' : '',
          !isTurn && !isWinner ? 'ring-black/[0.06]' : '',
          seat.status === 'folded' || seat.status === 'busted' ? 'opacity-45 saturate-50' : '',
        ]"
      >
          <div class="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 text-[20px]">
            <span>{{ seat.avatar }}</span>
            <span
              v-if="!seat.connected && !seat.isBot"
              class="absolute right-0 bottom-0 size-2.5 rounded-full bg-neutral-400 ring-2 ring-white"
              title="离线"
            />
          </div>
          <div class="flex min-w-0 flex-col">
            <span class="max-w-[104px] truncate text-[13px] leading-tight font-semibold text-neutral-900">
              {{ seat.name }}<span v-if="isHero" class="ml-1 font-normal text-blue-500">你</span>
              <span v-if="seat.isHost" class="ml-0.5 text-[10px] text-neutral-300">房主</span>
            </span>
            <span class="text-[11px] leading-tight text-neutral-400">
              {{ fmtChips(seat.stack) }}
              <span v-if="seat.status === 'all-in'" class="ml-0.5 font-semibold text-amber-500">ALL-IN</span>
            </span>
          </div>
      </div>
    </div>

    <!-- 状态气泡（胶囊下方） -->
    <div
      v-if="statusPill"
      class="absolute -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] text-neutral-500 ring-1 ring-black/[0.06] shadow-sm whitespace-nowrap"
      :style="{ ...at(pos), marginTop: '58px' }"
    >
      <template v-if="isTurn">
        <span class="flex gap-0.5">
          <i v-for="d in 3" :key="d" class="dot size-1 rounded-full bg-blue-500" :style="{ animationDelay: `${d * 0.15}s` }" />
        </span>
      </template>
      <span :class="seat.status === 'folded' || seat.status === 'busted' ? 'text-neutral-400' : ''">{{ statusPill }}</span>
    </div>

    <!-- 摊牌牌型标签 -->
    <div
      v-if="showResult && seat.handDesc && seat.status !== 'folded'"
      class="absolute -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
      :class="isWinner ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200' : 'bg-white text-neutral-500 ring-1 ring-black/[0.06]'"
      :style="{ ...at(pos), marginTop: '58px' }"
    >
      {{ seat.handDesc }}
    </div>

    <!-- 下注 / 赢池气泡（朝桌心方向） -->
    <div
      v-if="betPill"
      class="absolute -translate-x-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap ring-1 shadow-sm"
      :class="[
        betPill.tone === 'win' ? 'bg-emerald-500 text-white ring-emerald-500' : '',
        betPill.tone === 'bet' ? 'bg-white text-neutral-700 ring-black/[0.06]' : '',
        betPill.tone === 'fold' ? 'bg-neutral-100 text-neutral-400 ring-black/[0.04] font-normal' : '',
      ]"
      :style="at(betPos)"
    >
      <span v-if="betPill.tone === 'bet'" class="size-1.5 rounded-full bg-neutral-300" />
      {{ betPill.text }}
    </div>

    <!-- 庄家按钮 -->
    <div
      v-if="seat.isDealer"
      class="absolute -translate-x-1/2 -translate-y-1/2 grid size-5 place-items-center rounded-full bg-neutral-900 text-[10px] font-bold text-white ring-2 ring-white shadow"
      :style="at(dealerPos ?? pos)"
    >
      D
    </div>
  </div>
</template>

<style scoped>
.dot {
  animation: bounce-dot 1s infinite ease-in-out;
}
@keyframes bounce-dot {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-3px); opacity: 1; }
}
</style>
