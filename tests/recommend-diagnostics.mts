import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQualityDiagnostics, formatQualityDiagnostics } from '../src/core/recommend/diagnostics.ts'
import type { ChannelId } from '../src/core/recommend/types.ts'
import type { LangBucket } from '../src/core/recommend/language.ts'

const pick = (channel: ChannelId, lang?: LangBucket, exposureCount = 0) => ({ channel, lang, exposureCount })

test('通道兑现按目标计数，目标为 0 的通道只计数不除以 0', () => {
  const summary = buildQualityDiagnostics({
    requested: 20,
    channelPlan: { A: 7, B: 5, C: 4, D: 2, E: 2 },
    selected: [
      ...Array.from({ length: 6 }, () => pick('A')),
      ...Array.from({ length: 5 }, () => pick('B')),
      ...Array.from({ length: 4 }, () => pick('C')),
      ...Array.from({ length: 2 }, () => pick('D')),
      pick('E'),
    ],
    reasons: [],
    maxRelaxLevel: 0,
    pool: { total: 120, byLang: { zh: 90, unknown: 30 } },
    negativeRate: null,
  })
  assert.equal(summary.selected, 18)
  assert.equal(summary.fillRate, 0.9)
  assert.deepEqual(summary.channels.A, { target: 7, picked: 6, rate: 6 / 7 })
  assert.deepEqual(summary.channels.B, { target: 5, picked: 5, rate: 1 })
  assert.deepEqual(summary.channels.E, { target: 2, picked: 1, rate: 0.5 })
  assert.equal(summary.channelShortfall, 2)
  assert.equal(summary.channelOverflow, 0)
  assert.equal(summary.pool.unknownShare, 0.25)
})

test('超额出歌与零目标通道：缺口和溢出分开记，rate 不产生 NaN', () => {
  const summary = buildQualityDiagnostics({
    requested: 5,
    channelPlan: { A: 0, C: 5 },
    selected: [pick('C'), pick('C'), pick('C'), pick('C'), pick('A')],
    reasons: ['fallback_channel'],
    maxRelaxLevel: 4,
    pool: { total: 10 },
    negativeRate: null,
  })
  assert.deepEqual(summary.channels.A, { target: 0, picked: 1, rate: null })
  assert.deepEqual(summary.channels.C, { target: 5, picked: 4, rate: 0.8 })
  assert.equal(summary.channelShortfall, 1)
  assert.equal(summary.channelOverflow, 1)
  assert.equal(summary.relaxation.fallbackChannel, true)
})

test('语种兑现只看已声明桶，判不出语言的占比单独统计', () => {
  const summary = buildQualityDiagnostics({
    requested: 10,
    channelPlan: { A: 10 },
    selected: [
      ...Array.from({ length: 5 }, () => pick('A', 'zh')),
      ...Array.from({ length: 2 }, () => pick('A', 'en')),
      pick('A', 'unknown'),
      pick('A'),
      pick('A', 'ja'),
    ],
    langCaps: { enforced: true, caps: { zh: 6, en: 2 } },
    langUnmet: ['ko'],
    reasons: [],
    maxRelaxLevel: 0,
    pool: { total: 0 },
    negativeRate: null,
  })
  assert.equal(summary.langEnforced, true)
  assert.deepEqual(summary.langs.zh, { cap: 6, picked: 5, met: true })
  assert.deepEqual(summary.langs.en, { cap: 2, picked: 2, met: true })
  assert.equal(summary.langs.ja, undefined, '未声明的语种不进兑现表')
  assert.deepEqual(summary.langUnmet, ['ko'], '池里一首都没有的声明桶要单独列出')
  assert.equal(summary.unknownShare, 0.2, 'unknown 与 undefined 都算判不出')
  assert.equal(summary.pool.unknownShare, null, '空池没有占比可言')

  // 配额被放开档突破时，同一个桶要显示 met=false，而不是把超额藏起来
  const over = buildQualityDiagnostics({
    requested: 3,
    channelPlan: { A: 3 },
    selected: [pick('A', 'zh'), pick('A', 'zh'), pick('A', 'zh')],
    langCaps: { enforced: true, caps: { zh: 2 } },
    reasons: ['lang_quota_relaxed'],
    maxRelaxLevel: 4,
    pool: { total: 3 },
    negativeRate: null,
  })
  assert.deepEqual(over.langs.zh, { cap: 2, picked: 3, met: false })
})

test('不设配额时不编造语种兑现表', () => {
  const summary = buildQualityDiagnostics({
    requested: 2,
    channelPlan: { A: 2 },
    selected: [pick('A', 'zh'), pick('A', 'en')],
    langCaps: { enforced: false, caps: {} },
    reasons: [],
    maxRelaxLevel: 0,
    pool: { total: 2, byLang: { zh: 1, en: 1 } },
    negativeRate: null,
  })
  assert.equal(summary.langEnforced, false)
  assert.deepEqual(summary.langs, {})
})

test('新鲜度按从未播放过的占比算，跳过率直接透传会话负反馈', () => {
  const summary = buildQualityDiagnostics({
    requested: 4,
    channelPlan: { A: 4 },
    selected: [pick('A', 'zh', 0), pick('A', 'zh', 2), pick('A', 'en', 0), pick('A', 'en', 1)],
    reasons: [],
    maxRelaxLevel: 0,
    pool: { total: 40 },
    negativeRate: 0.25,
  })
  assert.equal(summary.noveltyRate, 0.5)
  assert.equal(summary.skipRate, 0.25)
})

test('放宽原因按次计数，截断与放开档分别留痕', () => {
  const summary = buildQualityDiagnostics({
    requested: 20,
    channelPlan: { A: 7, B: 5, C: 4, D: 2, E: 2 },
    selected: [pick('A', 'zh')],
    reasons: [
      'fallback_channel',
      'fallback_channel',
      'lang_quota_relaxed',
      'lang_consecutive_relaxed',
      'no_candidate_after_relaxation',
    ],
    maxRelaxLevel: 4,
    pool: { total: 3, byLang: { zh: 3 } },
    negativeRate: null,
  })
  assert.equal(summary.relaxation.fallbackChannel, true)
  assert.equal(summary.relaxation.quotaRelaxed, true)
  assert.equal(summary.relaxation.consecutiveRelaxed, true)
  assert.equal(summary.relaxation.starvation, true)
  assert.equal(summary.relaxation.maxLevel, 4)
  assert.deepEqual(summary.relaxation.reasons, {
    fallback_channel: 2,
    lang_quota_relaxed: 1,
    lang_consecutive_relaxed: 1,
    no_candidate_after_relaxation: 1,
  })
})

test('空选择不产生 NaN：比例缺样本时报 null', () => {
  const summary = buildQualityDiagnostics({
    requested: 10,
    channelPlan: { A: 10 },
    selected: [],
    reasons: ['no_candidate_after_relaxation'],
    maxRelaxLevel: 4,
    pool: { total: 3 },
    negativeRate: null,
  })
  assert.equal(summary.fillRate, 0)
  assert.equal(summary.unknownShare, null)
  assert.equal(summary.noveltyRate, null)
  assert.equal(summary.skipRate, null)
  assert.equal(summary.relaxation.starvation, true)
})

test('日志行把关键比例压成一行人话，便于在设置-日志里直接读', () => {
  const summary = buildQualityDiagnostics({
    requested: 20,
    channelPlan: { A: 7, B: 5, C: 4, D: 2, E: 2 },
    selected: [
      ...Array.from({ length: 6 }, () => pick('A', 'zh', 0)),
      ...Array.from({ length: 5 }, () => pick('B', 'en', 1)),
      ...Array.from({ length: 4 }, () => pick('C', 'ja', 0)),
      ...Array.from({ length: 2 }, () => pick('D', 'zh', 2)),
      pick('E', 'en', 0),
    ],
    langCaps: { enforced: true, caps: { zh: 6, en: 5 } },
    reasons: ['lang_quota_relaxed', 'fallback_channel'],
    maxRelaxLevel: 4,
    pool: { total: 120, byLang: { zh: 90, unknown: 30 } },
    negativeRate: 0.18,
  })
  assert.equal(
    formatQualityDiagnostics(summary),
    'fill=18/20 channels=A6/7 B5/5 C4/4 D2/2 E1/2 short=2 over=0 langs=zh8/6 en6/5 unmet=none unknown=0% novelty=61% skip=18% relax=quota+fallback level=4 pool=120/unknown=25%',
  )
})
