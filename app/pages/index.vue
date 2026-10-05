<script setup lang="ts">
import { onMounted, shallowRef } from 'vue'
import { AVATARS, loadProfile, saveProfile } from '~/lib/format'

const route = useRoute()
const router = useRouter()

const joinCode = computed(() =>
  String(route.query.join ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))

/** 从房间页跳回（/?join=CODE）时进入「加入模式」：只展示加入流程，不展示创建房间 */
const joinMode = computed(() => !!joinCode.value)

const name = shallowRef('')
const avatar = shallowRef(AVATARS[0] ?? '🦊')
const code = shallowRef('')
const busy = shallowRef<'create' | 'join' | null>(null)
const err = shallowRef('')

onMounted(() => {
  const p = loadProfile()
  if (p) {
    name.value = p.name
    avatar.value = p.avatar
  }
  if (joinCode.value)
    code.value = joinCode.value
})

const nameOk = computed(() => name.value.trim().length >= 1)

async function persist() {
  saveProfile({ name: name.value.trim().slice(0, 12), avatar: avatar.value })
}

async function createRoom() {
  if (!nameOk.value || busy.value) return
  err.value = ''
  busy.value = 'create'
  try {
    await persist()
    const r = await $fetch<{ code: string }>('/api/rooms', { method: 'POST' })
    await router.push(`/rooms/${r.code}`)
  }
  catch {
    err.value = '创建房间失败，请重试'
  }
  finally {
    busy.value = null
  }
}

async function joinRoom() {
  if (!nameOk.value || busy.value) return
  const c = code.value.trim().toUpperCase()
  if (c.length !== 4) {
    err.value = '房间码为 4 位字符'
    return
  }
  err.value = ''
  busy.value = 'join'
  try {
    await $fetch(`/api/rooms/${c}`)
    await persist()
    await router.push(`/rooms/${c}`)
  }
  catch {
    err.value = '房间不存在或已过期'
  }
  finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
    <!-- 标题 -->
    <div class="mb-10 flex flex-col items-center">
      <div class="mb-4 flex items-end gap-1 text-[28px] leading-none">
        <span class="font-bold text-neutral-900">♠</span>
        <span class="font-bold text-red-500">♥</span>
        <span class="font-bold text-neutral-900">♣</span>
        <span class="font-bold text-red-500">♦</span>
      </div>
      <h1 class="text-[32px] font-bold tracking-tight text-neutral-900">
        德州扑克
      </h1>
      <p class="mt-2 text-[13px] text-neutral-400">
        3–10 人 · 好友房间 · 休闲筹码
      </p>
    </div>

    <!-- 表单卡片：加入模式（?join=CODE）只展示加入流程 -->
    <div class="w-full max-w-[360px] rounded-3xl bg-white p-6 ring-1 ring-black/[0.06] shadow-[0_12px_50px_rgba(0,0,0,0.07)]">
      <template v-if="joinMode">
        <div class="mb-5 text-center">
          <div class="text-[12px] font-medium text-neutral-400">加入好友房间</div>
          <div class="mt-1 font-mono text-[28px] font-bold tracking-[0.3em] text-neutral-900">{{ joinCode }}</div>
        </div>

        <label class="mb-1.5 block text-[12px] font-medium text-neutral-500">你的昵称</label>
        <input
          v-model="name"
          maxlength="12"
          placeholder="给自己起个名字"
          class="mb-5 h-11 w-full rounded-xl bg-neutral-50 px-3.5 text-[14px] text-neutral-900 ring-1 ring-black/[0.06] outline-none transition-shadow placeholder:text-neutral-300 focus:ring-2 focus:ring-blue-400"
        >

        <label class="mb-1.5 block text-[12px] font-medium text-neutral-500">选择形象</label>
        <div class="mb-6 grid grid-cols-6 gap-1.5">
          <button
            v-for="a in AVATARS"
            :key="a"
            class="grid aspect-square place-items-center rounded-xl text-[22px] transition-all"
            :class="avatar === a
              ? 'bg-blue-50 ring-2 ring-blue-400 scale-105'
              : 'bg-neutral-50 ring-1 ring-black/[0.04] hover:bg-neutral-100'"
            @click="avatar = a"
          >
            {{ a }}
          </button>
        </div>

        <button
          class="h-12 w-full rounded-full bg-neutral-900 text-[15px] font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:bg-neutral-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!nameOk || busy != null"
          @click="joinRoom"
        >
          {{ busy === 'join' ? '加入中…' : '加入房间' }}
        </button>

        <p v-if="err" class="mt-3 text-center text-[12px] text-red-500">
          {{ err }}
        </p>

        <button
          class="mt-4 w-full text-center text-[12px] text-neutral-300 transition-colors hover:text-neutral-500"
          @click="router.replace('/')"
        >
          或创建新房间
        </button>
      </template>

      <template v-else>
        <label class="mb-1.5 block text-[12px] font-medium text-neutral-500">你的昵称</label>
        <input
          v-model="name"
          maxlength="12"
          placeholder="给自己起个名字"
          class="mb-5 h-11 w-full rounded-xl bg-neutral-50 px-3.5 text-[14px] text-neutral-900 ring-1 ring-black/[0.06] outline-none transition-shadow placeholder:text-neutral-300 focus:ring-2 focus:ring-blue-400"
        >

        <label class="mb-1.5 block text-[12px] font-medium text-neutral-500">选择形象</label>
        <div class="mb-6 grid grid-cols-6 gap-1.5">
          <button
            v-for="a in AVATARS"
            :key="a"
            class="grid aspect-square place-items-center rounded-xl text-[22px] transition-all"
            :class="avatar === a
              ? 'bg-blue-50 ring-2 ring-blue-400 scale-105'
              : 'bg-neutral-50 ring-1 ring-black/[0.04] hover:bg-neutral-100'"
            @click="avatar = a"
          >
            {{ a }}
          </button>
        </div>

        <button
          class="h-12 w-full rounded-full bg-neutral-900 text-[15px] font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)] transition-all hover:bg-neutral-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!nameOk || busy != null"
          @click="createRoom"
        >
          {{ busy === 'create' ? '创建中…' : '创建房间' }}
        </button>

        <div class="my-5 flex items-center gap-3 text-[12px] text-neutral-300">
          <span class="h-px flex-1 bg-neutral-200" />
          或加入好友房间
          <span class="h-px flex-1 bg-neutral-200" />
        </div>

        <div class="flex gap-2">
          <input
            v-model="code"
            maxlength="4"
            placeholder="房间码"
            class="h-12 min-w-0 flex-1 rounded-full bg-neutral-50 px-4 text-center font-mono text-[16px] font-bold tracking-[0.3em] uppercase text-neutral-900 ring-1 ring-black/[0.06] outline-none transition-shadow placeholder:tracking-normal placeholder:text-neutral-300 placeholder:font-sans placeholder:text-[14px] focus:ring-2 focus:ring-blue-400"
          >
          <button
            class="h-12 shrink-0 rounded-full bg-white px-5 text-[14px] font-semibold text-neutral-900 ring-1 ring-black/[0.08] transition-all hover:bg-neutral-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!nameOk || busy != null"
            @click="joinRoom"
          >
            {{ busy === 'join' ? '加入中…' : '加入' }}
          </button>
        </div>

        <p v-if="err" class="mt-3 text-center text-[12px] text-red-500">
          {{ err }}
        </p>
      </template>
    </div>

    <p class="mt-8 text-[12px] text-neutral-300">
      仅供娱乐 · 无真实货币
    </p>
  </div>
</template>
