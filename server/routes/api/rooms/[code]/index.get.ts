import { getRoom } from '../../../../utils/rooms'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const entry = await getRoom(code)
  if (!entry)
    throw createError({ statusCode: 404, statusMessage: '房间不存在或已过期' })
  entry.game.tick()
  return {
    code,
    phase: entry.game.phase,
    playerCount: entry.game.players.size,
    maxPlayers: entry.game.cfg.maxPlayers,
  }
})
