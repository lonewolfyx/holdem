<script setup lang="ts">
import type { ActionKind } from '#shared/protocol'
import { computed, shallowRef, watch } from 'vue'
import { useRoom } from '~/composables/useRoom'
import { fmtChips } from '~/lib/format'

const { hand, me, state, isMyTurn, act } = useRoom()

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const round10 = (v: number) => Math.round(v / 10) * 10

const toCall = computed(() =>
  me.value && hand.value
    ? Math.max(0, Math.min(hand.value.currentBet - me.value.roundBet, me.value.stack))
    : 0)
const canCheck = computed(() =>
  !!me.value && !!hand.value && hand.value.currentBet - me.value.roundBet <= 0)
const minRaiseTo = computed(() => {
  if (!hand.value) return 0
  return hand.value.currentBet === 0
    ? state.value!.settings.bigBlind
    : hand.value.currentBet + hand.value.minRaise
})
const maxRaiseTo = computed(() =>
  me.value ? me.value.roundBet + me.value.stack : 0)
const effMin = computed(() => clamp(minRaiseTo.value, 0, maxRaiseTo.value))

/** 滑杆步进随额度自适应（约 200 档），大额筹码也能顺滑拖动 */
const step = computed(() => {
  const span = Math.max(maxRaiseTo.value - effMin.value, 100)
  const raw = span / 200
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const mult = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10
  return Math.max(10, mult * mag)
})

/** 底池比例加注目标 */
function potTarget(f: number): number {
  if (!hand.value || !me.value) return 0
  const potAfterCall = hand.value.pot + toCall.value
  return clamp(round10(me.value.roundBet + toCall.value + potAfterCall * f), effMin.value, maxRaiseTo.value)
}

const presets = computed(() => [
  { label: '最小', value: effMin.value },
  { label: '⅓池', value: potTarget(1 / 3) },
  { label: '½池', value: potTarget(1 / 2) },
  { label: '¾池', value: potTarget(3 / 4) },
  { label: '1池', value: potTarget(1) },
])

/** 多个预设被最小注钳制到同一金额时，只点亮最左侧一个 */
const activePreset = computed(() =>
  presets.value.find(p => p.value === amount.value)?.label ?? null)

const amount = shallowRef(0)

/** reka 滑杆的回调值可能是数字或数组，统一取第一个数值 */
function onSlide(v: number | number[] | undefined) {
  const val = Array.isArray(v) ? v[0] : v
  if (typeof val === 'number')
    amount.value = val
}

watch(() => hand.value?.toActId, (id) => {
  if (id && id === state.value?.meId) {
    // 默认按 ½ 池预填
    amount.value = potTarget(1 / 2)
  }
}, { immediate: true })

function applyPreset(v: number) {
  amount.value = v
}

const isAllInBet = computed(() => amount.value >= maxRaiseTo.value)
const primaryLabel = computed(() => {
  if (isAllInBet.value) return `全下 ${fmtChips(maxRaiseTo.value)}`
  if (canCheck.value) return `下注 ${fmtChips(amount.value)}`
  return `加注到 ${fmtChips(amount.value)}`
})
const callLabel = computed(() =>
  canCheck.value ? '过牌' : `跟注 ${fmtChips(toCall.value)}`)

function doFold() {
  if (!isMyTurn.value) return
  act('fold')
}
function doCall() {
  if (!isMyTurn.value) return
  act(canCheck.value ? 'check' : 'call')
}
function doRaise() {
  if (!isMyTurn.value) return
  const kind: ActionKind = 'raise'
  act(kind, isAllInBet.value ? maxRaiseTo.value : amount.value)
}

/** 键盘快捷键：F 弃牌 / C 过牌或跟注 / R或回车 下注 / A 全下 */
function onKey(e: KeyboardEvent) {
  if (!isMyTurn.value || e.repeat) return
  const k = e.key.toLowerCase()
  if (k === 'f') doFold()
  else if (k === 'c') doCall()
  else if (k === 'r' || k === 'enter') doRaise()
  else if (k === 'a') applyPreset(maxRaiseTo.value)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    v-if="me && hand"
    class="flex w-[min(560px,94vw)] flex-col items-stretch gap-2.5 transition-opacity duration-300"
    :class="isMyTurn ? 'opacity-100' : 'opacity-40'"
  >
    <!-- 等待提示 -->
    <div
      v-if="!isMyTurn"
      class="mx-auto rounded-full bg-white/90 px-3.5 py-1 text-[12px] text-neutral-400 ring-1 ring-black/[0.04]"
    >
      等待其他玩家行动，轮到你时这里亮起
    </div>

    <!-- 加注滑杆行 -->
    <div
      class="flex items-center gap-3 rounded-full bg-white py-2.5 pr-4 ring-1 shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
      :class="isMyTurn ? 'pl-2 ring-black/[0.07]' : 'pl-4 ring-black/[0.04]'"
    >
      <div v-if="isMyTurn" class="flex items-center gap-1.5">
        <button
          v-for="p in presets"
          :key="p.label"
          class="rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors"
          :class="activePreset === p.label ? 'bg-blue-500 text-white' : 'text-neutral-500 hover:bg-neutral-100'"
          @click="applyPreset(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
      <div v-else class="text-[12px] text-neutral-300">
        <span class="inline-flex items-center gap-1">
          <i v-for="d in 3" :key="d" class="size-1 rounded-full bg-neutral-300 wait-dot" :style="{ animationDelay: `${d * 0.15}s` }" />
        </span>
      </div>
      <!-- 滑杆：粗轨道 + 蓝色已选段 + 白色拖块，轨道上有刻度点（与设计稿一致） -->
      <Slider
        :model-value="[amount]"
        :min="effMin"
        :max="maxRaiseTo"
        :step="step"
        :disabled="!isMyTurn"
        class="flex-1 [&_[data-slot=slider-range]]:rounded-full [&_[data-slot=slider-range]]:bg-blue-500 [&_[data-slot=slider-range]]:[background-image:radial-gradient(circle,rgba(255,255,255,0.6)_2px,transparent_2.5px)] [&_[data-slot=slider-range]]:[background-size:48px_100%] [&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-neutral-200 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-[0_2px_10px_rgba(0,0,0,0.2)] [&_[data-slot=slider-thumb]]:ring-blue-500/20 [&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-track]]:rounded-full [&_[data-slot=slider-track]]:bg-neutral-100 [&_[data-slot=slider-track]]:[background-image:radial-gradient(circle,#d4d4d8_2px,transparent_2.5px)] [&_[data-slot=slider-track]]:[background-size:48px_100%]"
        @update:model-value="onSlide"
      />
      <div class="flex w-[96px] flex-col items-end leading-none">
        <span
          class="text-[15px] font-bold whitespace-nowrap"
          :class="isMyTurn ? 'text-neutral-900' : 'text-neutral-400'"
        >
          {{ fmtChips(amount) }}
        </span>
        <span class="mt-1.5 text-[11px] whitespace-nowrap text-neutral-400">
          额度 {{ fmtChips(me?.stack ?? 0) }}
        </span>
      </div>
    </div>

    <!-- 动作按钮行 -->
    <div class="mx-auto flex w-fit items-center justify-center gap-1 rounded-full bg-white p-1.5 ring-1 ring-black/[0.07] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
      <button
        class="h-10 rounded-full px-5 text-[14px] font-semibold transition-colors"
        :class="isMyTurn
          ? 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 active:scale-95'
          : 'cursor-not-allowed text-neutral-300'"
        :disabled="!isMyTurn"
        @click="doFold"
      >
        弃牌
      </button>
      <button
        class="h-10 rounded-full px-5 text-[14px] font-semibold transition-colors"
        :class="isMyTurn
          ? 'text-neutral-900 hover:bg-neutral-100 active:scale-95'
          : 'cursor-not-allowed text-neutral-300'"
        :disabled="!isMyTurn"
        @click="doCall"
      >
        {{ callLabel }}
      </button>
      <button
        class="h-10 rounded-full px-5 text-[14px] font-semibold transition-all"
        :class="isMyTurn
          ? 'bg-neutral-900 text-white shadow-[0_4px_14px_rgba(0,0,0,0.3)] hover:bg-neutral-700 active:scale-95'
          : 'cursor-not-allowed bg-neutral-200 text-neutral-400'"
        :disabled="!isMyTurn"
        @click="doRaise"
      >
        {{ primaryLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.wait-dot {
  animation: wait-bounce 1s infinite ease-in-out;
}
@keyframes wait-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-3px); opacity: 1; }
}
</style>
