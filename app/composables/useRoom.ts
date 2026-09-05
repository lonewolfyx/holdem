import type { ActionKind, ClientRoomState } from '#shared/protocol'
import { computed, shallowRef } from 'vue'
import { clearIdentity, loadIdentity, saveIdentity } from '~/lib/format'

type ConnState = 'idle' | 'connecting' | 'open' | 'closed'

/** 单例房间连接状态：牌桌各组件共享 */
const state = shallowRef<ClientRoomState | null>(null)
const connection = shallowRef<ConnState>('idle')
const toast = shallowRef<{ text: string, at: number } | null>(null)

let ws: WebSocket | null = null
let currentCode = ''
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(text: string) {
  toast.value = { text, at: Date.now() }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 3000)
}

function closeWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (ws) {
    ws.onclose = null
    ws.onmessage = null
    ws.onerror = null
    ws.close()
    ws = null
  }
}

function openWs(code: string, playerId: string, token: string) {
  connection.value = 'connecting'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}/ws`)

  ws.onopen = () => {
    ws!.send(JSON.stringify({ t: 'hello', code, playerId, token }))
  }

  ws.onmessage = (ev) => {
    let msg: any
    try {
      msg = JSON.parse(ev.data)
    }
    catch {
      return
    }
    if (msg.t === 'state') {
      state.value = msg.state
      connection.value = 'open'
    }
    else if (msg.t === 'error') {
      showToast(msg.text)
    }
  }

  ws.onclose = () => {
    ws = null
    if (currentCode !== code) return
    connection.value = 'closed'
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (currentCode === code)
        openWs(code, playerId, token)
    }, 2000)
  }

  ws.onerror = () => {}
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
    closeWs()
    openWs(code, id.playerId, id.token)
    return true
  }

  function leaveRoom() {
    try {
      ws?.send(JSON.stringify({ t: 'leave' }))
    }
    catch {}
    closeWs()
    if (currentCode) clearIdentity(currentCode)
    currentCode = ''
    state.value = null
    connection.value = 'idle'
  }

  /** 挂起连接但不退出房间（页面卸载时） */
  function suspend() {
    closeWs()
    connection.value = 'idle'
  }

  function send(msg: Record<string, unknown>) {
    ws?.send(JSON.stringify(msg))
  }

  const act = (kind: ActionKind, amount?: number) => send({ t: 'action', kind, amount })
  const start = () => send({ t: 'start' })
  const addBot = () => send({ t: 'add-bot' })
  const rebuy = () => send({ t: 'rebuy' })
  const reset = () => send({ t: 'reset' })

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
