/**
 * 轮询全流程冒烟测试：
 * 创建房间 → 人类玩家加入 → 添加 2 个机器人 → 开始 → 自动跟到底 → 验证摊牌与筹码守恒。
 */
const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000'
const log = (...args) => console.log(...args)

async function command(code, cred, body) {
  const res = await fetch(`${BASE}/api/rooms/${code}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, ...cred }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(`命令 ${body.t} 失败: ${res.status} ${data.statusMessage ?? ''}`)
  }
  return res.json()
}

async function main() {
  // 1. 建房
  const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST' })).json()
  log('房间码:', code)

  // 2. 加入
  const joinRes = await (await fetch(`${BASE}/api/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '玩家阿黄', avatar: '🦊' }),
  })).json()
  log('加入:', JSON.stringify(joinRes))
  const cred = { playerId: joinRes.playerId, token: joinRes.token }

  // 3. 加机器人 + 开始
  await command(code, cred, { t: 'add-bot' })
  await command(code, cred, { t: 'add-bot' })
  const { state: startState } = await command(code, cred, { t: 'start' })
  log('已开始，等待牌局演进…')

  // 4. 轮询驱动牌局；人类玩家自动行动（能过就过，跟注都跟，保证进摊牌）
  let lastState = startState
  let v = 0
  let sawShowdown = false
  let sawCommunity5 = false
  const deadline = Date.now() + 90_000

  while (Date.now() < deadline) {
    const res = await (await fetch(
      `${BASE}/api/rooms/${code}/state?playerId=${cred.playerId}&token=${cred.token}&v=${v}`,
    )).json()
    v = res.v
    if (res.changed) lastState = res.state

    const { hand } = lastState
    if (!hand) {
      await new Promise(r => setTimeout(r, 400))
      continue
    }
    if (hand.community.length === 5) sawCommunity5 = true
    if (hand.results && hand.results.length > 0 && !sawShowdown) {
      sawShowdown = true
      log('=== 摊牌 ===')
      log('公共牌:', hand.community.map(c => `${c.r}${'♠♥♣♦'[c.s]}`).join(' '))
      log('底池:', hand.pot)
      for (const s of lastState.seats) {
        log(`  ${s.avatar} ${s.name} stack=${s.stack} status=${s.status} cards=${s.cards ? s.cards.map(c => `${c.r}${'♠♥♣♦'[c.s]}`).join(' ') : '暗'} desc=${s.handDesc ?? '-'} won=${s.won}`)
      }
      break
    }
    if (hand.toActId && hand.toActId === cred.playerId && hand.stage !== 'showdown') {
      const me = lastState.seats.find(s => s.id === cred.playerId)
      const toCall = hand.currentBet - me.roundBet
      const kind = toCall <= 0 ? 'check' : 'call'
      const { state: after } = await command(code, cred, { t: 'action', kind })
      lastState = after
      continue
    }
    await new Promise(r => setTimeout(r, 400))
  }

  // 断言
  log('--- 结果 ---')
  if (!lastState) throw new Error('未收到任何状态')
  const total = lastState.seats.reduce((s, p) => s + p.stack, 0)
  const expectTotal = lastState.seats.length * lastState.settings.buyIn
  log('见到五张公共牌:', sawCommunity5, ' 见到摊牌:', sawShowdown)
  log(`${lastState.seats.length} 人筹码合计:`, total, `(期望 ${expectTotal})`)
  if (!sawCommunity5) throw new Error('未见到 5 张公共牌')
  if (!sawShowdown) throw new Error('未进入摊牌')
  if (total !== expectTotal) throw new Error(`筹码不守恒: ${total} != ${expectTotal}`)
  log('✅ 轮询全流程验证通过')
  process.exit(0)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
