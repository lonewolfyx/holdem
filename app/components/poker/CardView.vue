<script setup lang="ts">
import type { Card } from '#shared/protocol'
import { computed } from 'vue'
import { RED_SUITS, RANK_NAMES, SUIT_GLYPHS } from '~/lib/cards'

const props = withDefaults(defineProps<{
  /** null = 牌背 */
  card?: Card | null
  size?: 'sm' | 'md' | 'lg'
}>(), {
  card: null,
  size: 'md',
})

const isRed = computed(() => props.card != null && RED_SUITS.has(props.card.s))
const rank = computed(() => props.card ? RANK_NAMES[props.card.r] : '')
const glyph = computed(() => props.card ? SUIT_GLYPHS[props.card.s] : '♠')

const dims = computed(() => {
  switch (props.size) {
    case 'sm': return { w: 38, h: 54, rank: 'text-[13px]', suit: 'text-[17px]', radius: 'rounded-[8px]' }
    case 'lg': return { w: 58, h: 82, rank: 'text-[17px]', suit: 'text-[24px]', radius: 'rounded-[11px]' }
    default: return { w: 50, h: 72, rank: 'text-[15px]', suit: 'text-[21px]', radius: 'rounded-[10px]' }
  }
})

const cardClass = computed(() => [
  'relative flex flex-col items-center justify-center bg-white ring-1 ring-black/10 shadow-[0_1px_3px_rgba(0,0,0,0.08)] select-none',
  dims.value.radius,
])

const rankClass = computed(() => [
  dims.value.rank,
  'font-bold leading-none tracking-tight',
  props.card == null ? 'text-neutral-300' : isRed.value ? 'text-red-500' : 'text-neutral-900',
])
const suitClass = computed(() => [
  dims.value.suit,
  'leading-none',
  props.card == null ? 'text-neutral-300' : isRed.value ? 'text-red-500' : 'text-neutral-900',
])
</script>

<template>
  <div
    :class="cardClass"
    :style="{ width: `${dims.w}px`, height: `${dims.h}px` }"
  >
    <template v-if="card">
      <span :class="rankClass">{{ rank }}</span>
      <span :class="suitClass" class="mt-0.5">{{ glyph }}</span>
    </template>
    <template v-else>
      <!-- 牌背：居中灰纹章 -->
      <span class="text-[20px] leading-none text-neutral-300">♠</span>
    </template>
  </div>
</template>
