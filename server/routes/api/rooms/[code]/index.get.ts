import { getRoom } from '../../../../utils/rooms'

export default defineEventHandler((event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const entry = getRoom(code)
  if (!entry)
    throw createError({ statusCode: 404, statusMessage: '房间不存在或已过期' })
  return {
    code,
    phase: entry.game.phase,
    playerCount: entry.game.players.size,
    maxPlayers: entry.game.cfg.maxPlayers,
  }
})
