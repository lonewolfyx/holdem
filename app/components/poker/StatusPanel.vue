<script setup lang="ts">
import { useNow } from '~/composables/useNow'
import { useRoom } from '~/composables/useRoom'
import { fmtChips } from '~/lib/format'

const { state, seats, hand, me, isHost, connection, phase, start, addBot, rebuy, reset } = useRoom()
const now = useNow(250)

const settings = computed(() => state.value?.settings)

const canStart = computed(() => seats.value.length >= (settings.value?.minPlayers ?? 3))
const startHint = computed(() => {
  const need = (settings.value?.minPlayers ?? 3) - seats.value.length
  return need > 0 ? `还需 ${need} 位玩家` : ''
})

const toActSeat = computed(() =>
  seats.value.find(s => s.id === hand.value?.toActId) ?? null)
const remain = computed(() => {
  if (!hand.value?.toActId || !hand.value.deadline) return null
  return Math.max(0, Math.ceil((hand.value.deadline - now.value) / 1000))
})
const nextIn = computed(() => {
  if (!hand.value?.nextHandAt) return null
  return Math.max(0, Math.ceil((hand.value.nextHandAt - now.value) / 1000))
})

const isShowdown = computed(() => hand.value?.stage === 'showdown')
const champion = computed(() =>
  state.value?.championId ? seats.value.find(s => s.id === state.value!.championId) ?? null : null)
const amBusted = computed(() => me.value?.status === 'busted' && (me.value?.stack ?? 0) === 0)

const copied = shallowRef(false)
async function copyInvite() {
  if (!state.value) return
  const url = `${location.origin}/?join=${state.value.code}`
  try {
    await navigator.clipboard.writeText(url)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  }
  catch {}
}
</script>

<template>
  <div class="flex w-[min(680px,96vw)] flex-col items-center gap-2.5">
    <!-- 连接状态 -->
    <div
      v-if="connection === 'closed'"
      class="rounded-full bg-amber-50 px-3.5 py-1.5 text-[12px] font-medium text-amber-600 ring-1 ring-amber-200"
    >
      连接断开，正在重连…
    </div>

    <!-- 大厅阶段：邀请 + 开始 -->
    <template v-if="phase === 'lobby'">
      <button
        class="flex items-center gap-2 rounded-full bg-white py-2 pr-3 pl-4 text-[13px] ring-1 ring-black/[0.07] shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-transform hover:scale-[1.02] active:scale-95"
        @click="copyInvite"
      >
        <span class="text-neutral-400">房间码</span>
        <span class="font-mono text-[15px] font-bold tracking-widest text-neutral-900">{{ state?.code }}</span>
        <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">
          {{ copied ? '已复制链接 ✓' : '复制邀请' }}
        </span>
      </button>

      <div class="flex items-center gap-2.5">
        <template v-if="isHost">
          <button
            class="h-11 rounded-full px-7 text-[14px] font-semibold transition-all active:scale-95"
            :class="canStart
              ? 'bg-neutral-900 text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] hover:bg-neutral-700'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'"
            :disabled="!canStart"
            @click="start"
          >
            开始游戏{{ startHint ? `（${startHint}）` : `（${seats.length} 人）` }}
          </button>
          <button
            v-if="seats.length < (settings?.maxPlayers ?? 10)"
            class="h-11 rounded-full bg-white px-5 text-[14px] font-semibold text-neutral-700 ring-1 ring-black/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all hover:bg-neutral-50 active:scale-95"
            @click="addBot"
          >
            + 电脑玩家
          </button>
        </template>
        <div
          v-else
          class="rounded-full bg-white px-5 py-3 text-[13px] text-neutral-500 ring-1 ring-black/[0.06] shadow-sm"
        >
          已就座，等待房主开始…（{{ seats.length }}/{{ settings?.maxPlayers ?? 10 }} 人）
        </div>
      </div>
    </template>

    <!-- 游戏结束 -->
    <template v-else-if="phase === 'ended'">
      <div class="rounded-full bg-white px-5 py-3 text-[14px] font-semibold text-neutral-800 ring-1 ring-amber-200 shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
        🏆 {{ champion ? `${champion.avatar} ${champion.name}` : '对局结束' }} 赢得全场 · {{ fmtChips(champion?.stack ?? 0) }} 筹码
      </div>
      <div class="flex items-center gap-2.5">
        <button
          v-if="isHost"
          class="h-11 rounded-full bg-neutral-900 px-7 text-[14px] font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:bg-neutral-700 active:scale-95"
          @click="reset"
        >
          再来一局
        </button>
        <button
          v-else
          class="h-11 rounded-full bg-white px-6 text-[14px] font-semibold text-neutral-700 ring-1 ring-black/[0.08] shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-all hover:bg-neutral-50 active:scale-95"
          @click="rebuy"
        >
          重新买入并等待房主重开
        </button>
      </div>
    </template>

    <!-- 牌局中：等待别人行动 / 下一局倒计时 -->
    <template v-else>
      <div
        v-if="isHost && seats.length < (settings?.maxPlayers ?? 10) && !isShowdown"
        class="rounded-full bg-white/90 px-3.5 py-1 text-[12px] text-neutral-400 ring-1 ring-black/[0.04]"
      >
        <button class="font-medium text-neutral-500 hover:text-neutral-800" @click="addBot">
          + 添加电脑玩家（{{ seats.length }}/{{ settings?.maxPlayers ?? 10 }}）
        </button>
      </div>
      <template v-if="isShowdown">
        <div
          v-if="amBusted"
          class="flex items-center gap-2.5"
        >
          <span class="rounded-full bg-white px-4 py-2.5 text-[13px] text-neutral-500 ring-1 ring-black/[0.06] shadow-sm">筹码已输光</span>
          <button
            class="h-11 rounded-full bg-neutral-900 px-6 text-[14px] font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:bg-neutral-700 active:scale-95"
            @click="rebuy"
          >
            重新买入 {{ fmtChips(settings?.buyIn ?? 0) }}
          </button>
        </div>
      </template>
      <div
        v-else-if="toActSeat"
        class="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] text-neutral-500 ring-1 ring-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      >
        <span class="flex gap-0.5">
          <i v-for="d in 3" :key="d" class="size-1 rounded-full bg-neutral-300 wait-dot" :style="{ animationDelay: `${d * 0.15}s` }" />
        </span>
        等待 <span class="font-semibold text-neutral-800">{{ toActSeat.name }}</span> 行动
        <span v-if="remain != null" class="font-mono text-[12px] text-neutral-400">{{ remain }}s</span>
      </div>
    </template>
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
