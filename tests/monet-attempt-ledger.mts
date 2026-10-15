import test from 'node:test'
import assert from 'node:assert/strict'

import { ATTEMPT_COOLDOWN_MS, INFLIGHT_TIMEOUT_MS, createAttemptLedger } from '../src/utils/monet/attemptLedger.ts'
import { NEGATIVE_TTL_MS } from '../src/utils/monet/coverPalette.ts'

const A = 'https://cdn.example.com/a.jpg'
const B = 'https://cdn.example.com/b.jpg'
const T0 = 1_000_000

// 这个账本存在的理由就一句话：取色失败过一次之后，播放页必须还能自己好回来。
// 老实现是一个 `requested: string | null` 闩 —— "问过就算过了"，于是瞬时失败即整会话不上色，
// 用户唯一的出口是去设置里翻"动态背景"开关（2026-10-15 真机就是这个现象）。
test('没问过的封面：该发一次请求', () => {
  const ledger = createAttemptLedger()
  assert.equal(ledger.want(A, T0), 'request')
})

test('在途的封面：不再并发第二条（原生侧是单线程队列）', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  assert.equal(ledger.want(A, T0 + 1000), 'in-flight')
})

// 原生那条单线程队列可能被一个慢慢滴的服务器占住（HttpURLConnection 的 4s 是每次 read 的超时，
// 不是总时长），于是 JS 这边这条 promise 永不 settle。没有期限的话 'in-flight' 就是另一把永久闩。
test('在途过了期限就当没在途：永不 settle 的 promise 不许变成新闩', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  assert.equal(ledger.want(A, T0 + INFLIGHT_TIMEOUT_MS - 1), 'in-flight')
  assert.equal(ledger.want(A, T0 + INFLIGHT_TIMEOUT_MS), 'request')
})

// store 挂唤醒定时器用的就是这条剩余时间；判据要和 want 的边界一致（同一刻到期）。
test('inflightLeft 倒数、到期归零', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  assert.equal(ledger.inflightLeft(A, T0), INFLIGHT_TIMEOUT_MS)
  assert.equal(ledger.inflightLeft(A, T0 + 5000), INFLIGHT_TIMEOUT_MS - 5000)
  assert.equal(ledger.inflightLeft(A, T0 + INFLIGHT_TIMEOUT_MS), 0)
  assert.equal(ledger.inflightLeft(B, T0), 0)
})

test('一次成功或失败之后：进入冷却，而不是永久封杀', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + 1000), 'cooldown')
  assert.ok(ledger.cooldownLeft(A, T0 + 1000) > 0)
})

test('冷却到期后可以自愈（这条是整个修复的承重）', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + ATTEMPT_COOLDOWN_MS - 1), 'cooldown')
  assert.equal(ledger.want(A, T0 + ATTEMPT_COOLDOWN_MS), 'request')
})

test('冷却时间随时间单调缩短，到期归零', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  const first = ledger.cooldownLeft(A, T0)
  const later = ledger.cooldownLeft(A, T0 + 5000)
  assert.equal(first, ATTEMPT_COOLDOWN_MS)
  assert.equal(later, ATTEMPT_COOLDOWN_MS - 5000)
  assert.equal(ledger.cooldownLeft(A, T0 + ATTEMPT_COOLDOWN_MS * 2), 0)
})

test('换歌互不影响：上一首的冷却不许压住新封面', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + 100), 'cooldown')
  assert.equal(ledger.want(B, T0 + 100), 'request')
})

test('同一张封面重新问之前不必等冷却：begin 之后 end 之前不许留下过期记录', () => {
  // 冷却只记"上一次什么时候开始问过"，所以第二次 begin 会把它推到下一个窗口
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  ledger.begin(A, T0 + ATTEMPT_COOLDOWN_MS)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + ATTEMPT_COOLDOWN_MS + 1000), 'cooldown')
  assert.equal(ledger.cooldownLeft(A, T0 + ATTEMPT_COOLDOWN_MS + 1000), ATTEMPT_COOLDOWN_MS - 1000)
})

test('reset：翻开关这条手动出口必须立刻可请求', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + 100), 'cooldown')
  ledger.reset()
  assert.equal(ledger.want(A, T0 + 100), 'request')
})

test('end 幂等：没在途时不该抛，也不该凭空造出一条冷却记录', () => {
  const ledger = createAttemptLedger()
  ledger.end(A)
  assert.equal(ledger.want(A, T0), 'request')
  ledger.begin(A, T0)
  ledger.end(A)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + 100), 'cooldown')
})

test('冷却期内反复 want 不会把窗口往后推（否则一直听这首歌就永远不再取色）', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  for (let t = T0 + 1000; t < T0 + ATTEMPT_COOLDOWN_MS; t += 1000) assert.equal(ledger.want(A, t), 'cooldown')
  assert.equal(ledger.want(A, T0 + ATTEMPT_COOLDOWN_MS), 'request')
})

test('账本只记 url，不记颜色：同一张封面换字色重取也该被允许（缓存层自己的事）', () => {
  const ledger = createAttemptLedger()
  ledger.begin(A, T0)
  ledger.end(A)
  assert.equal(ledger.want(A, T0 + ATTEMPT_COOLDOWN_MS), 'request')
})

// 两个窗口的大小关系是承重的，而它跨了两个文件（账本在这，保质期在 coverPalette），
// 谁都不会顺手去查 —— 所以钉在这里。理由：两层失败时间戳都记在"结果到手那一刻"，
// 而这里的窗口从"发起请求那一刻"起算；store 的重试点必须落在缓存层已经过期之后，
// 否则那次重试只是读到同一份还没过期的 null，自愈要多等一整个冷却窗口（15s 变 30s）。
test('store 的冷却必须长于缓存层的失败保质期，不然重试会读到同一份 null', () => {
  assert.ok(ATTEMPT_COOLDOWN_MS > NEGATIVE_TTL_MS,
    `ATTEMPT_COOLDOWN_MS(${ATTEMPT_COOLDOWN_MS}) 必须 > NEGATIVE_TTL_MS(${NEGATIVE_TTL_MS})`)
})
