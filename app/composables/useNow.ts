import { onScopeDispose, shallowRef } from 'vue'

/** 每秒跳动的当前时间，用于倒计时渲染 */
export function useNow(intervalMs = 250) {
  const now = shallowRef(Date.now())
  const timer = setInterval(() => {
    now.value = Date.now()
  }, intervalMs)
  onScopeDispose(() => clearInterval(timer))
  return now
}
