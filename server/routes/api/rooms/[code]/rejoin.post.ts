import { getRoom, heartbeat, verifyToken } from '../../../../utils/rooms'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const body = await readBody<{ playerId?: string, token?: string }>(event) ?? {}
  const entry = await getRoom(code)
  if (!entry || !body.playerId || !verifyToken(entry, body.playerId, body.token ?? ''))
    return { ok: false }
  heartbeat(entry, body.playerId)
  entry.game.tick()
  const player = entry.game.players.get(body.playerId)
  if (!player)
    return { ok: false }
  return { ok: true, name: player.name, avatar: player.avatar, isHost: player.isHost }
})
