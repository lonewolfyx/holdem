import { createRoom } from '../../../utils/rooms'

export default defineEventHandler(async () => {
  const entry = await createRoom()
  return { code: entry.code }
})
