import type { Peer, Message } from 'crossws'
import type { ClientMessage } from '#shared/protocol'
import { attachPeer, detachPeer, getRoom, sendTo, verifyToken } from '../utils/rooms'
import { GameError } from '../poker/game'

interface PeerInfo {
  code: string
  playerId: string
}

declare global {
  // eslint-disable-next-line ts/no-var-requires
  var __holdemPeerInfo: Map<string, PeerInfo> | undefined
}

const peerInfo: Map<string, PeerInfo> = (globalThis.__holdemPeerInfo ??= new Map())

function pushState(code: string, playerId: string) {
  const entry = getRoom(code)
  if (!entry) return
  sendTo(playerId, { t: 'state', state: entry.game.view(playerId) })
}

export default defineWebSocketHandler({
  open(peer: Peer) {},

  close(peer: Peer) {
    const info = peerInfo.get(peer.id)
    peerInfo.delete(peer.id)
    if (!info) return
    const last = detachPeer(info.playerId, peer)
    if (last) {
      const entry = getRoom(info.code)
      entry?.game.setConnected(info.playerId, false)
    }
  },

  message(peer: Peer, message: Message) {
    let data: ClientMessage
    try {
      data = JSON.parse(message.text())
    }
    catch {
      return
    }

    // 首条消息：携带身份握手
    if (!peerInfo.has(peer.id)) {
      if (data.t !== 'hello') {
        peer.send(JSON.stringify({ t: 'error', text: '请先握手' }))
        return
      }
      const code = data.code.toUpperCase()
      const entry = getRoom(code)
      if (!entry || !verifyToken(entry, data.playerId, data.token)) {
        peer.send(JSON.stringify({ t: 'error', text: '房间不存在或登录已失效' }))
        peer.close()
        return
      }
      peerInfo.set(peer.id, { code, playerId: data.playerId })
      attachPeer(data.playerId, peer)
      entry.game.setConnected(data.playerId, true)
      pushState(code, data.playerId)
      return
    }

    const info = peerInfo.get(peer.id)!
    const entry = getRoom(info.code)
    if (!entry) return
    const { game } = entry

    try {
      switch (data.t) {
        case 'start':
          game.startGame(info.playerId)
          break
        case 'add-bot': {
          const by = game.players.get(info.playerId)
          if (!by?.isHost)
            throw new GameError('只有房主才能添加电脑玩家')
          game.addBot()
          break
        }
        case 'action':
          game.act(info.playerId, data.kind, data.amount)
          break
        case 'rebuy':
          game.rebuy(info.playerId)
          break
        case 'reset':
          game.resetGame(info.playerId)
          break
        case 'leave':
          game.remove(info.playerId)
          entry.tokens.delete(info.playerId)
          peerInfo.delete(peer.id)
          detachPeer(info.playerId, peer)
          peer.close()
          break
      }
    }
    catch (err) {
      if (err instanceof GameError)
        sendTo(info.playerId, { t: 'error', text: err.message })
      else
        throw err
    }
  },
})
