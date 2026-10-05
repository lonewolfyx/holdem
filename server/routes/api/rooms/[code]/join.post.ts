import { GameError } from '../../../../poker/game'
import { flushWrites, randomId, refreshIfStale, registerPlayer, requireRoom } from '../../../../utils/rooms'

const AVATAR_POOL = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦉', '🐧', '🐺', '🦄', '🐙']

export default defineEventHandler(async (event) => {
  const code = getRouterParam(event, 'code')?.toUpperCase() ?? ''
  const body = await readBody<{ name?: string, avatar?: string }>(event) ?? {}
  const name = String(body.name ?? '').trim().slice(0, 12)
  if (!name)
    throw createError({ statusCode: 400, statusMessage: '昵称不能为空' })

  let entry = await requireRoom(code)

  // 另一实例可能已推进房间状态：以共享存储为准
  entry = (await refreshIfStale(entry)) ?? await requireRoom(code)

  // 追赶牌局进度后再入座
  entry.game.tick()

  const playerId = randomId()
  const token = randomId(16)
  const fallback = AVATAR_POOL[Math.floor(Math.random() * AVATAR_POOL.length)] ?? '🦊'
  const avatar = AVATAR_POOL.includes(body.avatar ?? '') ? body.avatar! : fallback

  try {
    entry.game.join({ id: playerId, name, avatar, isBot: false })
  }
  catch (err) {
    if (err instanceof GameError)
      throw createError({ statusCode: 400, statusMessage: err.message })
    throw err
  }
  registerPlayer(entry, playerId, token)
  await flushWrites()
  return { code: entry.code, playerId, token, isHost: entry.game.players.get(playerId)!.isHost }
})
