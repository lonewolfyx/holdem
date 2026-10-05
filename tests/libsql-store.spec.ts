import { describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibsqlStoreFromClient } from '../server/utils/db'

/**
 * libSQL 存储实现的集成测试：用 @libsql/client 的 node 入口（file: 模式）
 * 驱动与生产远程模式（Turso）完全相同的 SQL 与行映射逻辑。
 * 生产环境 web 入口仅传输层不同（HTTP），SQL 语义一致。
 */

async function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'holdem-libsql-'))
  const client = createClient({ url: `file:${join(dir, 'test.sqlite')}` })
  // 生产路径会在打开时幂等建表（db.ts 内），这里不手动建表以覆盖该行为
  const store = await createLibsqlStoreFromClient(client)
  return {
    store,
    close: () => {
      client.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('libSQL 存储实现（远程模式共用逻辑）', () => {
  it('createRow 建行成功，同码重复建行失败', async () => {
    const { store, close } = await makeStore()
    try {
      await expect(store.createRow('AAAA', 1, '{"v":1}', 1000)).resolves.toBe(true)
      await expect(store.createRow('AAAA', 1, '{"v":1}', 1000)).resolves.toBe(false)
    }
    finally {
      close()
    }
  })

  it('getVersion / getRow 读取行并正确映射类型', async () => {
    const { store, close } = await makeStore()
    try {
      await expect(store.getVersion('NOPE')).resolves.toBeUndefined()
      await store.createRow('BBBB', 7, '{"k":"数据"}', 2000)
      await expect(store.getVersion('BBBB')).resolves.toBe(7)
      await expect(store.getRow('BBBB')).resolves.toEqual({ version: 7, data: '{"k":"数据"}' })
    }
    finally {
      close()
    }
  })

  it('casRow 版本匹配写入、不匹配拒绝（不复活、不覆盖新状态）', async () => {
    const { store, close } = await makeStore()
    try {
      await store.createRow('CCCC', 3, '{"v":3}', 3000)
      // 版本匹配
      await expect(store.casRow('CCCC', 3, 4, '{"v":4}', 3001)).resolves.toBe(true)
      await expect(store.getVersion('CCCC')).resolves.toBe(4)
      // 期望版本不匹配 → 拒绝且状态不变
      await expect(store.casRow('CCCC', 3, 5, '{"v:stale"}', 3002)).resolves.toBe(false)
      await expect(store.getVersion('CCCC')).resolves.toBe(4)
      // 行不存在（已删除）→ 更新失败，绝不复活
      await store.delRow('CCCC')
      await expect(store.casRow('CCCC', 4, 5, '{"v":5}', 3003)).resolves.toBe(false)
      await expect(store.getVersion('CCCC')).resolves.toBeUndefined()
    }
    finally {
      close()
    }
  })

  it('delRow 删除行', async () => {
    const { store, close } = await makeStore()
    try {
      await store.createRow('DDDD', 1, '{}', 4000)
      await store.delRow('DDDD')
      await expect(store.getRow('DDDD')).resolves.toBeUndefined()
    }
    finally {
      close()
    }
  })

  it('墓碑：markDissolved / getDissolved / purgeDissolved', async () => {
    const { store, close } = await makeStore()
    try {
      await expect(store.getDissolved('EEEE')).resolves.toBeUndefined()
      await store.markDissolved('EEEE', 5000)
      await expect(store.getDissolved('EEEE')).resolves.toEqual({ at: 5000 })
      // 重复标记更新时间
      await store.markDissolved('EEEE', 5001)
      await expect(store.getDissolved('EEEE')).resolves.toEqual({ at: 5001 })
      await store.purgeDissolved(6000)
      await expect(store.getDissolved('EEEE')).resolves.toBeUndefined()
    }
    finally {
      close()
    }
  })

  it('purgeRows 清理过期房间行', async () => {
    const { store, close } = await makeStore()
    try {
      await store.createRow('FFFF', 1, '{}', 1000)
      await store.createRow('GGGG', 1, '{}', 9000)
      await store.purgeRows(5000)
      await expect(store.getVersion('FFFF')).resolves.toBeUndefined()
      await expect(store.getVersion('GGGG')).resolves.toBe(1)
    }
    finally {
      close()
    }
  })
})
