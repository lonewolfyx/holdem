import { createRoom } from '../../../utils/rooms'

export default defineEventHandler(async () => {
  const entry = createRoom()
  return { code: entry.code }
})
