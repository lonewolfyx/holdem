import { flushWrites, getRoom, heartbeat, refreshIfStale, verifyToken } from '../../../../utils/rooms'

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const body = await readBody<{ playerId?: string, token?: string }>(event) ?? {}
  const found = await getRoom(code)
  if (!found || !body.playerId || !verifyToken(found, body.playerId, body.token ?? ''))
    return { ok: false }
  const entry = (await refreshIfStale(found)) ?? found
  if (!verifyToken(entry, body.playerId, body.token ?? ''))
    return { ok: false }
  heartbeat(entry, body.playerId)
  entry.game.tick()
  await flushWrites()
  const player = entry.game.players.get(body.playerId)
  if (!player)
    return { ok: false }
  return { ok: true, name: player.name, avatar: player.avatar, isHost: player.isHost }
})
