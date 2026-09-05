<script setup lang="ts">
const { toast } = useRoom()
</script>

<template>
  <div class="min-h-dvh bg-background text-foreground">
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
