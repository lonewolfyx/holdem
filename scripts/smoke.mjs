/**
 * WS 全流程冒烟测试：
 * 创建房间 → 人类玩家加入 → 添加 2 个机器人 → 开始 → 自动跟到底 → 验证摊牌与筹码守恒。
 */
import WebSocket from 'ws'

const BASE = 'http://localhost:3000'
const log = (...args) => console.log(...args)

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

  // 3. WS 握手
  const ws = new WebSocket(`ws://localhost:3000/ws`)
  let lastState = null
  let sawShowdown = false
  let sawCommunity5 = false

  let finished
  const done = new Promise((resolve, reject) => {
    finished = resolve
    const timeout = setTimeout(() => reject(new Error('超时（90s）未完成一局')), 90_000)
    ws.on('close', () => { clearTimeout(timeout); resolve() })
  })

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.t === 'error') {
      log('服务端错误:', msg.text)
      return
    }
    if (msg.t !== 'state') return
    lastState = msg.state
    const { hand } = msg.state
    if (!hand) return
    if (hand.community.length === 5) sawCommunity5 = true
    if (hand.results && hand.results.length > 0 && !sawShowdown) {
      sawShowdown = true
      log('=== 摊牌 ===')
      log('公共牌:', hand.community.map(c => `${c.r}${'♠♥♣♦'[c.s]}`).join(' '))
      log('底池:', hand.pot)
      for (const s of msg.state.seats) {
        log(`  ${s.avatar} ${s.name} stack=${s.stack} status=${s.status} cards=${s.cards ? s.cards.map(c => `${c.r}${'♠♥♣♦'[c.s]}`).join(' ') : '暗'} desc=${s.handDesc ?? '-'} won=${s.won}`)
      }
      // 收到摊牌即可结束验证
      setTimeout(() => finished(), 300)
    }
  })

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'hello', code, playerId: joinRes.playerId, token: joinRes.token }))
  })

  // 等握手状态
  await new Promise(r => setTimeout(r, 800))

  // 4. 加机器人 + 开始
  ws.send(JSON.stringify({ t: 'add-bot' }))
  await new Promise(r => setTimeout(r, 300))
  ws.send(JSON.stringify({ t: 'add-bot' }))
  await new Promise(r => setTimeout(r, 300))
  ws.send(JSON.stringify({ t: 'start' }))
  log('已发送 start，等待牌局演进…')

  // 5. 人类玩家自动行动（能过就过，跟注都跟，保证进摊牌）
  const actLoop = setInterval(() => {
    if (!lastState?.hand) return
    const { toActId, stage } = lastState.hand
    if (toActId && toActId === joinRes.playerId && stage !== 'showdown') {
      const me = lastState.seats.find(s => s.id === joinRes.playerId)
      const toCall = lastState.hand.currentBet - me.roundBet
      if (toCall <= 0)
        ws.send(JSON.stringify({ t: 'action', kind: 'check' }))
      else if (toCall >= me.stack)
        ws.send(JSON.stringify({ t: 'action', kind: 'call' }))
      else
        ws.send(JSON.stringify({ t: 'action', kind: 'call' }))
    }
  }, 500)

  try {
    await done
  }
  finally {
    clearInterval(actLoop)
  }

  // 断言
  log('--- 结果 ---')
  log('见到五张公共牌:', sawCommunity5, ' 见到摊牌:', sawShowdown)
  if (lastState) {
    const total = lastState.seats.reduce((s, p) => s + p.stack, 0)
    log('三人筹码合计:', total, '(期望 60000)')
    if (!sawCommunity5) throw new Error('未见到 5 张公共牌')
    if (!sawShowdown) throw new Error('未进入摊牌')
    if (total !== 60000) throw new Error(`筹码不守恒: ${total}`)
  }
  else {
    throw new Error('未收到任何状态')
  }
  log('✅ WS 全流程验证通过')
  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
