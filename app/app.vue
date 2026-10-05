<script setup lang="ts">
const { toast } = useRoom()

/** 部署诊断：Serverless 平台上未连接共享数据库时给出醒目警告 */
const storeWarning = shallowRef(false)
const warningClosed = shallowRef(false)

onMounted(async () => {
  try {
    const h = await $fetch<{ store: string }>('/api/health')
    // 本地开发（file 模式）是正常形态；仅在 vercel.app 部署且未连共享库时警告
    storeWarning.value = h.store !== 'remote' && location.hostname.includes('vercel.app')
  }
  catch {
    // 健康检查失败不阻塞页面
  }
})
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
    <div
      v-if="storeWarning && !warningClosed"
      class="relative z-50 bg-amber-50 px-4 py-2.5 text-center text-[12px] leading-relaxed text-amber-800 ring-1 ring-amber-200"
    >
      ⚠️ 当前部署未连接共享数据库（<code class="font-mono">/api/health</code> 报告 file 模式）：
      多人房间将互相不可见、实例回收后丢失。请在
      <strong>Vercel 控制台 → Storage → Marketplace → Turso → Connect</strong>
      连接数据库并重新部署，本警告会自动消失。
      <button
        class="ml-2 text-amber-500 hover:text-amber-700"
        aria-label="关闭警告"
        @click="warningClosed = true"
      >
        ✕
      </button>
    </div>
    <NuxtPage />
    <!-- 全局轻提示 -->
    <Transition name="toast">
      <div
        v-if="toast"
        class="fixed top-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-4 py-2 text-[13px] text-white shadow-lg backdrop-blur"
      >
        {{ toast.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
</style>
