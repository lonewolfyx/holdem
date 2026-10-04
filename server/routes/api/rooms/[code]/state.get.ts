import { heartbeat, requireRoom, verifyToken } from '../../../../utils/rooms'

/**
 * 状态轮询（WebSocket 的替代传输）：
 * - 携带 playerId + token 做鉴权与心跳（在线状态由 lastSeen 推导）；
 * - 先 tick() 惰性推进牌局（机器人/超时/跑马/下一局）；
 * - 版本号未变化时只返回轻量心跳，changed 时才序列化个性化视图；
 * - 心跳同时刷新房间活跃时间（30 分钟无活动强制解散）。
 */
export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const query = getQuery(event)
  const playerId = String(query.playerId ?? '')
  const token = String(query.token ?? '')
  const clientV = Number(query.v ?? 0)

  const entry = await requireRoom(code)
  if (!playerId || !verifyToken(entry, playerId, token))
    throw createError({ statusCode: 401, statusMessage: '登录已失效，请重新加入' })

  heartbeat(entry, playerId)
  entry.game.tick()

  if (entry.version === clientV)
    return { v: entry.version, changed: false }
  return { v: entry.version, changed: true, state: entry.game.view(playerId) }
})
