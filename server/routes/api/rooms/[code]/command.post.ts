import type { ActionKind, CommandRequest } from '#shared/protocol'
import { GameError } from '../../../../poker/game'
import { getRoom, persistRoom, verifyToken } from '../../../../utils/rooms'

const ACTION_KINDS = new Set<ActionKind>(['fold', 'check', 'call', 'raise'])

/**
 * 房间命令（WebSocket 消息的 HTTP 替代）：
 * start / add-bot / action / rebuy / reset / leave。
 * 总是返回执行后的最新状态，给操作者即时反馈、省一次轮询。
 */
export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const body = await readBody<Partial<CommandRequest>>(event) ?? {}
  const { playerId, token } = body
  if (!playerId || !token)
    throw createError({ statusCode: 401, statusMessage: '登录已失效，请重新加入' })

  const entry = await getRoom(code)
  if (!entry)
    throw createError({ statusCode: 404, statusMessage: '房间不存在或已过期' })
  if (!verifyToken(entry, playerId, token))
    throw createError({ statusCode: 401, statusMessage: '登录已失效，请重新加入' })

  entry.game.touch(playerId)
  entry.game.tick()

  const { game } = entry
  try {
    switch (body.t) {
      case 'start':
        game.startGame(playerId)
        break
      case 'add-bot': {
        const by = game.players.get(playerId)
        if (!by?.isHost)
          throw new GameError('只有房主才能添加电脑玩家')
        game.addBot()
        break
      }
      case 'action': {
        const kind = body.kind
        if (!kind || !ACTION_KINDS.has(kind))
          throw createError({ statusCode: 400, statusMessage: '无效的行动' })
        const amount = body.amount == null ? undefined : Number(body.amount)
        if (amount != null && !Number.isFinite(amount))
          throw createError({ statusCode: 400, statusMessage: '无效的注额' })
        game.act(playerId, kind, amount)
        break
      }
      case 'rebuy':
        game.rebuy(playerId)
        break
      case 'reset':
        game.resetGame(playerId)
        break
      case 'leave':
        game.remove(playerId)
        entry.tokens.delete(playerId)
        persistRoom(entry)
        break
      default:
        throw createError({ statusCode: 400, statusMessage: '未知命令' })
    }
  }
  catch (err) {
    if (err instanceof GameError)
      throw createError({ statusCode: 400, statusMessage: err.message })
    throw err
  }

  return { v: entry.version, state: game.view(playerId) }
})
