<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useRoom } from '~/composables/useRoom'

const route = useRoute()
const router = useRouter()

const code = computed(() =>
  String(route.params.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))

const { state, connection, hand, me, isHost, gone, enterRoom, leaveRoom, suspend } = useRoom()
const failed = shallowRef(false)

onMounted(async () => {
  const ok = await enterRoom(code.value)
  if (!ok) {
    failed.value = true
    await router.replace({ path: '/', query: { join: code.value } })
    return
  }
  failed.value = false
})

/** 房间被解散（房主离开或超时清理）后自动退回大厅（保留房间码便于重进/重开） */
watch(gone, (isGone) => {
  if (isGone)
    router.replace({ path: '/', query: { join: code.value } })
})

/** 页面卸载挂起连接（保留身份，可自动重连） */
onBeforeUnmount(() => suspend())

function onLeave() {
  leaveRoom()
  router.replace('/')
}
</script>

<template>
  <div class="relative flex h-dvh flex-col overflow-hidden">
    <!-- 顶部栏 -->
    <header class="z-40 flex items-center justify-between px-4 pt-3 text-[12px] text-neutral-400">
      <button
        class="flex items-center gap-1 rounded-full bg-white px-3.5 py-2 font-medium text-neutral-500 ring-1 ring-black/[0.06] shadow-sm transition-colors hover:bg-neutral-50"
        @click="onLeave"
      >
        {{ isHost ? '← 解散房间' : '← 离开' }}
      </button>
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-white px-3.5 py-2 font-mono text-[13px] font-bold tracking-[0.25em] text-neutral-700 ring-1 ring-black/[0.06] shadow-sm">
          {{ code }}
        </span>
      </div>
      <div class="rounded-full bg-white px-3.5 py-2 ring-1 ring-black/[0.06] shadow-sm">
        盲注 {{ state?.settings.smallBlind ?? '–' }}/{{ state?.settings.bigBlind ?? '–' }}
        <template v-if="state?.hand"> · 第 {{ state.hand.no }} 手</template>
      </div>
    </header>

    <!-- 牌桌 -->
    <main class="relative flex flex-1 items-center justify-center px-5 pt-2 pb-[150px]">
      <div
        v-if="!state"
        class="grid h-full place-items-center text-[13px] text-neutral-400"
      >
        {{ connection === 'closed' ? '连接断开，正在重连…' : '正在进入房间…' }}
      </div>
      <PokerTable v-else />
    </main>

    <!-- 底部操作区：这手牌还在手中就常驻显示操作栏（未轮到时为禁用态） -->
    <footer class="pointer-events-none absolute inset-x-0 bottom-5 z-40 flex justify-center px-3">
      <div class="pointer-events-auto flex flex-col items-center">
        <PokerActionBar
          v-if="state && hand && me && (me.status === 'in-hand' || me.status === 'all-in')"
        />
        <PokerStatusPanel v-else-if="state" />
      </div>
    </footer>
  </div>
</template>
