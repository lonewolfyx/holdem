import type { ActionKind, ClientRoomState, CommandBody, CommandResponse, StateResponse } from '#shared/protocol'
import { computed, shallowRef } from 'vue'
import { clearIdentity, loadIdentity, saveIdentity } from '~/lib/format'

type ConnState = 'idle' | 'connecting' | 'open' | 'closed'

/**
 * 单例房间连接：HTTP 轮询替代 WebSocket。
 * WebSocket 无法在 Vercel 等 Serverless 平台保持长连接（这就是线上
 * 「连接中 / 连接失败」的根因），改为对 /state 的增量轮询 +
 * /command 命令上报，任何支持 HTTP 的平台都能工作。
 */

/** 轮询间隔：空闲稍慢，有人行动时加快；出错后指数退避 */
const POLL_BASE_MS = 900
const POLL_ACTIVE_MS = 500
const POLL_BACKOFF_MAX_MS = 6000
/** 连续 4xx（房间消失/登录失效）达到该次数后停止轮询 */
const FATAL_4XX_LIMIT = 3

const state = shallowRef<ClientRoomState | null>(null)
const connection = shallowRef<ConnState>('idle')
const toast = shallowRef<{ text: string, at: number } | null>(null)

let currentCode = ''
let credentials: { playerId: string, token: string } | null = null
let version = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
let pollGeneration = 0
let pollInFlight = false
let errorStreak = 0
let fatal4xx = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(text: string) {
  toast.value = { text, at: Date.now() }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function nextPollInterval(): number {
  return state.value?.hand?.toActId ? POLL_ACTIVE_MS : POLL_BASE_MS
}

function schedulePoll(delayMs?: number) {
  stopPolling()
  pollTimer = setTimeout(pollLoop, delayMs ?? nextPollInterval())
}

function applyState(next: ClientRoomState, v: number) {
  state.value = next
  version = v
  connection.value = 'open'
  errorStreak = 0
  fatal4xx = 0
}

async function pollLoop() {
  pollTimer = null
  if (!credentials || !currentCode) return
  if (pollInFlight) {
    schedulePoll(120)
    return
  }
  const gen = pollGeneration
  pollInFlight = true
  try {
    const res = await $fetch<StateResponse>(`/api/rooms/${currentCode}/state`, {
      params: { playerId: credentials.playerId, token: credentials.token, v: version },
    })
    if (gen !== pollGeneration) return
    if (res.changed) {
      applyState(res.state, res.v)
    }
    else {
      // 无变化：轻量心跳，仅复位错误计数与连接态
      version = res.v
      connection.value = 'open'
      errorStreak = 0
      fatal4xx = 0
    }
    schedulePoll()
  }
  catch (err) {
    if (gen !== pollGeneration) return
    handlePollError(err)
  }
  finally {
    pollInFlight = false
  }
}

function handlePollError(err: any) {
  const status = err?.status ?? err?.response?.status
  if (status === 404 || status === 401) {
    fatal4xx++
    if (fatal4xx >= FATAL_4XX_LIMIT) {
      // 房间真的没了（或身份失效）：停止轮询并提示
      stopPolling()
      connection.value = 'closed'
      state.value = null
      showToast(status === 404 ? '房间不存在或已过期' : '登录已失效，请重新加入')
      if (currentCode) clearIdentity(currentCode)
      return
    }
  }
  else {
    fatal4xx = 0
  }
  errorStreak++
  // 连续两次失败才亮「重连」状态，避免单次网络抖动造成闪烁
  if (errorStreak >= 2)
    connection.value = 'closed'
  const backoff = Math.min(POLL_BACKOFF_MAX_MS, POLL_BASE_MS * 2 ** Math.min(errorStreak, 4))
  schedulePoll(backoff)
}

async function command(msg: CommandBody): Promise<boolean> {
  if (!credentials || !currentCode) return false
  try {
    const res = await $fetch<CommandResponse>(`/api/rooms/${currentCode}/command`, {
      method: 'POST',
      body: { ...msg, playerId: credentials.playerId, token: credentials.token },
    })
    applyState(res.state, res.v)
    schedulePoll(POLL_ACTIVE_MS)
    return true
  }
  catch (err: any) {
    const status = err?.status ?? err?.response?.status
    if (status === 400) {
      showToast(err?.data?.statusMessage ?? '操作失败')
      // 400 可能伴随服务端状态推进（如行动超时被自动过牌），立即拉一次
      schedulePoll(0)
    }
    else if (status === 404 || status === 401) {
      showToast(status === 404 ? '房间不存在或已过期' : '登录已失效，请重新加入')
      schedulePoll(POLL_BASE_MS)
    }
    else {
      showToast('网络异常，请重试')
      handlePollError(err)
    }
    return false
  }
}

function onVisibilityChange() {
  // 移动端从后台切回时定时器可能被节流，立即同步一次
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && credentials)
    schedulePoll(0)
}

export function useRoom() {
  async function enterRoom(code: string): Promise<boolean> {
    currentCode = code
    const identity = loadIdentity(code)
    if (identity) {
      // 校验身份是否仍然有效（服务端可能已重启）
      try {
        const re = await $fetch<{ ok: boolean }>(`/api/rooms/${code}/rejoin`, {
          method: 'POST',
          body: identity,
        })
        if (!re.ok) clearIdentity(code)
      }
      catch {
        clearIdentity(code)
      }
    }

    let id = loadIdentity(code)
    if (!id) {
      const { loadProfile } = await import('~/lib/format')
      const profile = loadProfile()
      if (!profile) return false
      try {
        const joined = await $fetch<{ playerId: string, token: string }>(`/api/rooms/${code}/join`, {
          method: 'POST',
          body: profile,
        })
        id = { playerId: joined.playerId, token: joined.token }
        saveIdentity(code, id)
      }
      catch (err: any) {
        const text = err?.data?.statusMessage ?? '进入房间失败'
        showToast(text)
        return false
      }
    }
    stopPolling()
    pollGeneration++
    pollInFlight = false
    credentials = id
    version = 0
    errorStreak = 0
    fatal4xx = 0
    connection.value = 'connecting'
    schedulePoll(0)
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', onVisibilityChange)
    return true
  }

  function leaveRoom() {
    const code = currentCode
    stopPolling()
    pollGeneration++
    if (code && credentials) {
      // 离开房间：尽力通知服务端（失败不阻塞本地退出）
      $fetch(`/api/rooms/${code}/command`, {
        method: 'POST',
        body: { t: 'leave', playerId: credentials.playerId, token: credentials.token },
      }).catch(() => {})
    }
    if (code) clearIdentity(code)
    currentCode = ''
    credentials = null
    state.value = null
    connection.value = 'idle'
  }

  /** 挂起轮询但不退出房间（页面卸载时） */
  function suspend() {
    stopPolling()
    pollGeneration++
    connection.value = 'idle'
  }

  const act = (kind: ActionKind, amount?: number) => command({ t: 'action', kind, amount })
  const start = () => command({ t: 'start' })
  const addBot = () => command({ t: 'add-bot' })
  const rebuy = () => command({ t: 'rebuy' })
  const reset = () => command({ t: 'reset' })

  // 派生数据
  const seats = computed(() => state.value?.seats ?? [])
  const hand = computed(() => state.value?.hand ?? null)
  const me = computed(() => seats.value.find(s => s.id === state.value?.meId) ?? null)
  const isHost = computed(() => !!me.value?.isHost)
  const phase = computed(() => state.value?.phase ?? 'lobby')
  const isMyTurn = computed(() =>
    !!hand.value && hand.value.toActId === state.value?.meId && !!me.value && me.value.status !== 'folded')

  return {
    state,
    connection,
    toast,
    seats,
    hand,
    me,
    isHost,
    phase,
    isMyTurn,
    enterRoom,
    leaveRoom,
    suspend,
    act,
    start,
    addBot,
    rebuy,
    reset,
    showToast,
  }
}
