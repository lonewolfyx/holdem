import { getStore } from '../../utils/db'

/**
 * 部署诊断：返回当前存储模式。
 * - remote: 已配置 NUXT_DB_URL（Turso/libSQL），多实例共享状态 ✓
 * - file:   本地文件模式（自托管正常；Vercel 上出现此值说明环境变量未生效）
 * - memory: 存储初始化失败，纯内存模式（重启即丢）
 */
export default defineEventHandler(async () => {
  const s = await getStore()
  if (!s)
    return { store: 'memory' }
  if (s.remote)
    return { store: 'remote', db: process.env.NUXT_DB_URL ?? '' }
  return { store: 'file' }
})
