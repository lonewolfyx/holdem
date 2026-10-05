import { flushWrites, requireRoom } from '../../../../utils/rooms'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const entry = await requireRoom(code)
  entry.game.tick()
  await flushWrites()
  return {
    code,
    phase: entry.game.phase,
    playerCount: entry.game.players.size,
    maxPlayers: entry.game.cfg.maxPlayers,
  }
})
