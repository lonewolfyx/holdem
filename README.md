# ♠ 德州扑克 · Holdem

Nuxt 4 + Tailwind CSS v4 + shadcn-vue 实现的 **3–10 人在线无限注德州扑克**。
一张桌子一个房间，把房间码发给朋友即可开局；人不够可以一键添加电脑玩家凑桌。

## 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

1. 大厅输入昵称、选形象，**创建房间**（或用 4 位房间码加入：`/?join=CODE` 直达）。
2. 房主点「+ 电脑玩家」补齐座位（**至少 3 人开局，最多 10 人**）。
3. 「开始游戏」——盲注 50/100，每人默认 5000万 额度，全下、边池、平分池、跑马一应俱全。
4. 轮到自己时用底部操作栏行动：快捷注额（最小 / ⅓池 / ½池 / ¾池 / 1池）、滑杆、键盘快捷键
   `F` 弃牌 · `C` 过牌/跟注 · `R`/`Enter` 下注加注 · `A` 全下。

## 测试

```bash
pnpm test         # 牌力评估 / 边池结算 / 引擎流程 / 序列化恢复 / 随机对局模糊测试
pnpm exec nuxi typecheck
node scripts/smoke.mjs   # 需先启动 dev：建房→轮询对局→摊牌→筹码守恒 冒烟验证
```

模糊测试用可复现随机种子跑 3–10 人随机筹码整场对局，逐状态校验**筹码守恒、无负筹码、roundBet 一致性**。

## 架构

```
shared/protocol.ts          # 前后端共享协议：牌面 / 座位视图 / 命令与状态响应
server/
  poker/
    cards.ts                # 牌堆与洗牌（可注入随机源）
    evaluator.ts            # 7 选 5 牌力评估 → 可比较分值 + 中文牌型描述
    pots.ts                 # 边池分层结算纯函数（死钱并入规则）
    bots.ts                 # 机器人 AI（翻前范围 + 成牌强度 + 底池赔率）
    game.ts                 # 牌局状态机：盲注/四轮下注/最小加注/全下/摊牌；
                            #   定时事件全部序列化为 pending 事件，由 tick() 惰性推进
  utils/db.ts               # better-sqlite3 惰性单例（WAL + 预编译语句，失败自动降级内存）
  utils/rooms.ts            # 房间注册表：内存热缓存 + SQLite 写穿持久化、令牌鉴权
  routes/
    api/rooms/**            # 建房 / 查房 / 加入 / 重连 / 命令 / 状态轮询（REST）
app/
  composables/useRoom.ts    # 单例房间连接：增量轮询 + 心跳 + 退避重连 + 派生状态
  composables/useNow.ts     # 倒计时 tick
  lib/                      # cn 工具、筹码缩写、牌面符号、本地身份存储
  components/poker/
    PokerTable.vue          # 椭圆桌面 + 座位环形定位（自己永远在正下方）
    SeatView.vue            # 玩家胶囊 / 手牌 / 庄家钮 / 下注气泡 / 思考倒计时
    CardView.vue            # 扑克牌（明牌 / 牌背）
    ActionBar.vue           # 弃牌 / 过牌跟注 / 下注加注 + 快捷注额与滑杆
    StatusPanel.vue         # 大厅邀请 / 开始控制 / 等待提示 / 结算重开
  pages/
    index.vue               # 大厅：昵称 + 形象 + 创建/加入
    rooms/[code].vue        # 牌桌页
```

## 实时同步：HTTP 轮询（而非 WebSocket）

早期版本用 Nitro WebSocket 推送，部署到 **Vercel 等 Serverless 平台后无法保持
长连接**（函数返回响应后即被冻结，不支持 WS 升级），客户端会永远停留在
「连接中 / 连接失败 / 正在重连」。现在改为纯 HTTP：

- `GET /api/rooms/:code/state?playerId&token&v` —— 增量轮询：版本号未变时只返回
  轻量心跳，变化时返回个性化视图；同时充当在线心跳（断线 12s 后座位显示离线）。
- `POST /api/rooms/:code/command` —— 行动/开局/加机器人等命令，响应直接携带最新
  状态，操作即时生效。
- 牌局的机器人决策、25s 行动超时、全下跑马、下一局倒计时都不再依赖后台定时器，
  而是序列化为「待处理事件」，每个请求先 `tick()` 追赶到当前时间 —— 因此
  **Serverless 冻结安全**，进程重启后状态恢复、进度自动补跑。

## 存储：本地 SQLite

房间状态（牌局 + 令牌 + 版本号）通过 better-sqlite3 持久化（WAL 模式，写穿缓存：
热路径读内存、变更写 SQLite），进程重启后房间自动恢复。

- 数据库路径：环境变量 `NUXT_DB_PATH`（默认 `./.data/holdem.sqlite`；
  部署在 Vercel 等只读平台时自动用 `/tmp/holdem.sqlite`）。
- 原生模块在 `nuxt.config.ts` 中通过 `nitro.externals.external` 外置，动态 import
  惰性加载——不影响页面渲染路由的冷启动；初始化失败自动降级为纯内存模式。

### 部署说明

- **Node 服务器 / Docker / Railway / Fly（带持久卷）**：推荐方式，SQLite 落盘，
  重启不丢房。
- **Vercel**：连接问题已修复（轮询不依赖长连接），但 `/tmp` 是实例本地的临时盘，
  冷启动会清空；多实例之间状态不共享 —— 只适合低流量试玩。生产使用请部署到带
  持久文件系统的 Node 环境（或把 `server/utils/db.ts` 换成外置数据库）。

## 设计要点

- **服务端权威**：所有规则校验、计时（25s 超时自动过牌/弃牌）、机器人决策都在服务端，
  客户端只拿到「自己视角」的状态（他人底牌永远是牌背，摊牌才揭示）；状态接口校验
  playerId + token，防止越权读取他人底牌。
- **断线重连**：身份（playerId + token）存在 localStorage，刷新/断网自动重连回到座位；
  断线期间超时自动过牌/弃牌，不会卡住牌局。
- **规则完整度**：标准无限注最小加注（短全下不重开行动权）、翻前大盲选项、多人全下边池、
  平分池余数分配、剩余一人自动跑马。
- **视觉**：参照极简椭圆桌风格——浅灰桌面、白色胶囊座位、蓝圈当前行动者、绿圈赢家、
  黑色主行动按钮、快捷注额 + 滑杆 + 筹码缩写（561K / 1.28M）。

## 已知边界（娱乐原型）

- 单实例部署假设：多实例需把房间注册表换到外置共享存储（如 Redis / Postgres）。
- 机器人策略为休闲强度（范围 + 底池赔率 + 少量诈唬），非 GTO。
