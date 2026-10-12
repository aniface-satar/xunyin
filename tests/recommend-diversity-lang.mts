import test from 'node:test'
import assert from 'node:assert/strict'
import { selectFinalQueue } from '../src/core/recommend/diversity.ts'
import { planChannelQuotas } from '../src/core/recommend/channels.ts'
import { computeLangCaps, computeLangTargets, countLangUsed } from '../src/core/recommend/languageQuota.ts'
import type { FinalQueueItem } from '../src/core/recommend/diversity.ts'
import type { LangBucket } from '../src/core/recommend/language.ts'

const seedRandom = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

// 每条候选都要避开歌手/歌单/专辑间隔约束，否则测到的是 antiRepeat 不是语种
// 权重必须落在 0.6 倍以内：applyQualityGate（config.ts qualityGateRatio=0.6）
// 会先把同通道里低于最高分×0.6 的候选整个剔出抽样，权重差太多时对照组根本没人可选。
const mkItem = (index: number, lang: LangBucket | undefined, weight = 1): FinalQueueItem => ({
  key: `k${index}`,
  channels: ['A'],
  primaryArtist: `artist-${index}`,
  artistKeys: [`artist-${index}`],
  albumKey: `album-${index}`,
  sourcePlaylistId: `pl-${index}`,
  weight,
  lang,
})

const items = (list: Array<Selected>) => list.map(entry => entry.item)
type Selected = { item: FinalQueueItem }

const langCapsFor = (weights: Record<string, number>, recentLangs: Array<LangBucket | undefined>) =>
  computeLangCaps(computeLangTargets(weights), countLangUsed(recentLangs))

test('已声明语种的上限卡住本轮选择，未声明语种不受限', () => {
  // 三组候选：zh 权重 3（本应被优先选中）、en/ja 权重 2（仍过 0.6 质量闸门）。
  // ja 必须存在：只有 zh+en 时，连播硬规则让 3 首 zh 最多再配 3 首 en，凑不满 8 首，
  // 阶梯会被迫走放开档多收 zh —— 那测到的是"放开档"而不是"上限"。
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) => mkItem(i, 'zh', 3)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(100 + i, 'en', 2)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(200 + i, 'ja', 2)),
  ]
  const plan = planChannelQuotas(8, [], { A: 30, B: 0, C: 0, D: 0 })
  const zhCount = (list: Array<{ item: FinalQueueItem }>) => list.filter(entry => entry.item.lang == 'zh').length
  const capped = selectFinalQueue(candidates, {
    target: 8,
    channelPlan: plan,
    rng: seedRandom(7),
    langCaps: langCapsFor({ zh: 10 }, []),
  })
  assert.equal(capped.items.length, 8)
  assert.ok(zhCount(capped.items) <= 3, `zh should stay within target 2 + tolerance 1, got ${zhCount(capped.items)}`)
  // 对照组：同一份候选、同一个种子，不传 caps 时 zh 必须更多，否则上面的上界是空断言。
  // 两次都要重新 seedRandom（rng 有内部状态）。把两个数字都写进报告，不要为了过而换种子。
  const control = selectFinalQueue(candidates, { target: 8, channelPlan: plan, rng: seedRandom(7) })
  assert.ok(zhCount(control.items) > zhCount(capped.items), `cap should reduce zh: control=${zhCount(control.items)} capped=${zhCount(capped.items)}`)
})

test('同语言连播硬规则与配额无关：enforced=false 也拦住第三首中文', () => {
  // zh 权重 3，本应被优先选中；第一首不是 zh 才是连播硬规则在起作用。
  // 不能断言第一首"等于 en"：en 与 ja 权重相同，具体落谁头上取决于种子，而规则只保证"不是 zh"。
  const candidates = [
    ...Array.from({ length: 5 }, (_, i) => mkItem(i, 'zh', 3)),
    ...Array.from({ length: 10 }, (_, i) => mkItem(100 + i, 'en', 2)),
    ...Array.from({ length: 5 }, (_, i) => mkItem(200 + i, 'ja', 2)),
  ]
  const recent = [mkItem(300, 'zh'), mkItem(301, 'zh')]
  const plan = planChannelQuotas(3, [], { A: 20, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 3,
    recent,
    channelPlan: plan,
    rng: seedRandom(3),
  })
  assert.equal(result.items.length, 3)
  assert.notEqual(result.items[0].item.lang, 'zh', 'first pick must break the zh run even with no quota')
  const seq = [...recent, ...items(result.items)]
  for (let i = 2; i < seq.length; i++) {
    if (seq[i].lang == 'unknown' || seq[i].lang == undefined) continue
    assert.ok(!(seq[i].lang == seq[i - 1].lang && seq[i].lang == seq[i - 2].lang), `three in a row of ${seq[i].lang}`)
  }
})

test('纯音乐在窗口里另设上限，不占语言名额', () => {
  // instr 权重 3：不设上限时它会被优先选，2 首的上界才只可能来自规则。
  // 另配 en 一组（权重 2）：instr 卡到 2 首之后，只剩 zh 会被连播规则再次卡死（凑不满 10 首）。
  const candidates = [
    ...Array.from({ length: 6 }, (_, i) => mkItem(i, 'instr', 3)),
    ...Array.from({ length: 20 }, (_, i) => mkItem(100 + i, 'zh', 2)),
    ...Array.from({ length: 20 }, (_, i) => mkItem(300 + i, 'en', 2)),
  ]
  const plan = planChannelQuotas(10, [], { A: 46, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, { target: 10, channelPlan: plan, rng: seedRandom(5) })
  assert.equal(result.items.length, 10)
  assert.ok(result.items.filter(entry => entry.item.lang == 'instr').length <= 2)

  // 另一半断言：纯音乐不能吃语言名额。zh 只给 1 个名额，2 首 instr 各占一格的话
  // 第 3 首 zh 就得靠放开档出歌（reasons 里会出现 lang_quota_relaxed）——那是错的。
  const mixed = [
    ...Array.from({ length: 4 }, (_, i) => mkItem(20 + i, 'instr', 3)),
    ...Array.from({ length: 4 }, (_, i) => mkItem(120 + i, 'zh', 2)),
  ]
  const smallPlan = planChannelQuotas(3, [], { A: 8, B: 0, C: 0, D: 0 })
  const mixedResult = selectFinalQueue(mixed, {
    target: 3,
    channelPlan: smallPlan,
    rng: seedRandom(5),
    langCaps: { enforced: true, caps: { zh: 1 } },
  })
  assert.equal(mixedResult.items.length, 3)
  assert.equal(mixedResult.items.filter(entry => entry.item.lang == 'instr').length, 2)
  assert.equal(mixedResult.reasons.includes('lang_quota_relaxed'), false,
    `instrumentals must not eat the language headroom, got ${mixedResult.reasons.join(',')}`)
})

test('池里只有超配额语种时靠放开档出歌，并留下 lang_quota_relaxed 线索', () => {
  // 必须配 2 首 unknown：它不受配额也不参与连播计数，先占掉前两格，
  // 第三格只剩超配额的 zh —— 全靠 zh 的话队列只能凑到 2 首（连播硬规则恒守），
  // 那样测出来的是"凑不满"而不是"靠放开档凑满"。
  const candidates = [
    ...Array.from({ length: 2 }, (_, i) => mkItem(200 + i, 'unknown')),
    ...Array.from({ length: 6 }, (_, i) => mkItem(i, 'zh')),
  ]
  const plan = planChannelQuotas(3, [], { A: 8, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 3,
    channelPlan: plan,
    rng: seedRandom(1),
    langCaps: { enforced: true, caps: { zh: 0 } },
  })
  assert.equal(result.items.length, 3, 'quota relaxation must still fill the queue')
  assert.ok(result.reasons.includes('lang_quota_relaxed'), `expected lang_quota_relaxed, got ${result.reasons.join(',')}`)
})

test('用掉最后一个合法名额不算放开配额：线索必须能分清两者', () => {
  // 阶梯升级的原因必须和语言无关：recent 两首与候选同歌手，0~3 档全被 artistGap 卡住，
  // 候选带着 1 个合法名额在第 4 档被收下。若埋点读的是"扣完之后"的额度，
  // 这条合法消耗会和真正的超额破例给出同一串 reasons。
  const asChorus = (index: number, lang: LangBucket | undefined) => ({
    ...mkItem(index, lang),
    primaryArtist: 'shared-artist',
    artistKeys: ['shared-artist'],
  })
  const recent = [asChorus(900, 'zh'), asChorus(901, 'en')]
  const plan = planChannelQuotas(1, [], { A: 20, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue([asChorus(1, 'zh')], {
    target: 1,
    recent,
    channelPlan: plan,
    rng: seedRandom(11),
    langCaps: { enforced: true, caps: { zh: 1 } },
  })
  assert.equal(result.maxRelaxLevel, 4, 'escalation must come from the artist gap, not the quota')
  assert.equal(result.items.length, 1, 'the last legal unit of the quota must still be pickable')
  assert.equal(result.reasons.includes('lang_quota_relaxed'), false,
    `legal consumption must not look like a bypass, got ${result.reasons.join(',')}`)
})

test('判不出语言的歌直接放行，不触发放开档', () => {
  const candidates = [
    ...Array.from({ length: 4 }, (_, i) => mkItem(i, 'unknown')),
    ...Array.from({ length: 4 }, (_, i) => mkItem(100 + i, undefined)),
  ]
  const plan = planChannelQuotas(4, [], { A: 8, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, {
    target: 4,
    channelPlan: plan,
    rng: seedRandom(9),
    langCaps: { enforced: true, caps: { zh: 0 } },
  })
  assert.equal(result.items.length, 4)
  assert.equal(result.reasons.includes('lang_quota_relaxed'), false)
  assert.equal(result.maxRelaxLevel, 0)
})
