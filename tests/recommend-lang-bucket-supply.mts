import test from 'node:test'
import assert from 'node:assert/strict'

import { LANG_BUCKET_TAGS, normalizeLangTagId, planLangBucketFetch, pickWeightedTag, prioritizeL1LangSources } from '../src/core/recommend/tabSections.ts'
import { computeBucketDetailReserve, computeLangTargets, countPoolLang } from '../src/core/recommend/languageQuota.ts'
import type { ThemePreference } from '../src/core/recommend/types.ts'

const theme = (name: string, positiveWeight: number, negativeWeight = 0): [string, ThemePreference] => [
  name,
  { themeId: name, positiveWeight, negativeWeight, lastDecayTime: 1000, lastUsedTime: 1000 },
]

test('五源都登记了语种桶标签，kw 的目录 id 带 digest 后缀要能归一到纯数字', () => {
  assert.deepEqual({ ...LANG_BUCKET_TAGS.kg }, { zh: '84', yue: '19', en: '20', ja: '21', ko: '23', other: '24' })
  assert.deepEqual({ ...LANG_BUCKET_TAGS.tx }, { zh: '1', yue: '146', en: '3', ja: '5', ko: '4', other: '6' })
  assert.deepEqual({ ...LANG_BUCKET_TAGS.kw }, { zh: '37', yue: '13', en: '35', ja: '1091', ko: '1093', other: '12' })
  // wy 的分类 id 就是分类名本身；它没有单独的"小语种"桶
  assert.deepEqual({ ...LANG_BUCKET_TAGS.wy }, { zh: '华语', yue: '粤语', en: '欧美', ja: '日语', ko: '韩语' })
  assert.deepEqual({ ...LANG_BUCKET_TAGS.mg }, {
    zh: '1000001762', yue: '1000001763', en: '1000001766', ja: '1000001767', ko: '1000001599', other: '1003449724',
  })
  // kw getTag 返回 `37-10000` 形态，但 getTagPlayList 只认纯数字
  assert.equal(normalizeLangTagId('kw', '37-10000'), '37')
  assert.equal(normalizeLangTagId('kw', '37'), '37')
  assert.equal(normalizeLangTagId('wy', '华语'), '华语')
  assert.equal(normalizeLangTagId('mg', '1000001762'), '1000001762')
})

test('unknown 占比超过阈值时把有逐曲语种字段的源提到最前，否则保持原序', () => {
  const randomOrder: LX.OnlineSource[] = ['wy', 'tx', 'mg', 'kg', 'kw']
  assert.deepEqual(prioritizeL1LangSources(randomOrder, 0.1, 0.3), randomOrder)
  // 两个 L1 源之间的相对顺序也不能乱：仍按调用方给的随机序，避免永远同一个源先打
  assert.deepEqual(prioritizeL1LangSources(randomOrder, 0.5, 0.3), ['tx', 'kg', 'wy', 'mg', 'kw'])
  // 阈值是严格大于：正好 30% 时不重排
  assert.deepEqual(prioritizeL1LangSources(randomOrder, 0.3, 0.3), randomOrder)
})

test('按池内比例折算目标数，只规划真正缺货的桶并按缺口降序', () => {
  // 20 首窗口里 en 目标 5 首，池按 400/20=20 倍放大 → 期望 100 首，现只有 10
  const targets = computeLangTargets({ zh: 10, western: 25 })
  const plan = planLangBucketFetch({
    source: 'kg',
    targets,
    poolCounts: { zh: 300, en: 10 },
    poolSize: 400,
    windowSize: 20,
    maxBuckets: 2,
  })
  assert.deepEqual(plan.map(entry => entry.bucket), ['en'])
  assert.equal(plan[0].tagId, '20')
  assert.equal(plan[0].deficit, 90)
})

test('两个桶都缺货时只留缺口大的那个（maxBuckets=1）', () => {
  const plan = planLangBucketFetch({
    source: 'tx',
    targets: computeLangTargets({ zh: 10, western: 10, ja: 10 }),
    poolCounts: { zh: 10, en: 40, ja: 5 },
    poolSize: 200,
    windowSize: 20,
    maxBuckets: 1,
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].bucket, 'ja')
  assert.equal(plan[0].tagId, '5')
})

test('问卷没滑语言 / 池已够货 时都不规划', () => {
  const empty = computeLangTargets({})
  assert.deepEqual(planLangBucketFetch({ source: 'kg', targets: empty, poolCounts: {}, poolSize: 400, windowSize: 20, maxBuckets: 1 }), [])
  assert.deepEqual(planLangBucketFetch({
    source: 'kg',
    targets: computeLangTargets({ zh: 10 }),
    poolCounts: { zh: 400 },
    poolSize: 400,
    windowSize: 20,
    maxBuckets: 1,
  }), [])
})

test('实时目录里没有该标签 id 时跳过，不发注定为空的请求', () => {
  const plan = planLangBucketFetch({
    source: 'kg',
    targets: computeLangTargets({ western: 40, zh: 40 }),
    poolCounts: {},
    poolSize: 200,
    windowSize: 20,
    maxBuckets: 2,
    knownTagIds: new Set(['84']),
  })
  assert.deepEqual(plan.map(entry => entry.bucket), ['zh'])
})

test('池内桶计数与配额共用同一套数：unknown 不冒充任何桶', () => {
  const counts = countPoolLang([{ lang: 'zh' }, { langHint: 'en' }, {}, { lang: 'unknown' }])
  assert.deepEqual(counts, { zh: 1, en: 1, unknown: 2 })
})

test('unknown 占比越高，桶召回抢走的详情位越多，但永远给常规摘要留至少一格', () => {
  assert.equal(computeBucketDetailReserve({ detailBudget: 4, unknownShare: 0.1, escalateAt: 0.3, base: 1, escalateTo: 2 }), 1)
  assert.equal(computeBucketDetailReserve({ detailBudget: 4, unknownShare: 0.5, escalateAt: 0.3, base: 1, escalateTo: 2 }), 2)
  assert.equal(computeBucketDetailReserve({ detailBudget: 1, unknownShare: 0.9, escalateAt: 0.3, base: 1, escalateTo: 2 }), 0)
})

test('加权分类轮换在高权重档里抽样，被学成负偏好的分类永不登场', () => {
  // 华语(6) 与 欧美(2) 都是正偏好。只给一个正偏好分类的话，"永远取最高分"的错实现
  // 也能全绿——rng 走到区间尾部必须落到次高的那个分类，抽样才算被测到。
  const tags = [{ id: '1', name: '华语' }, { id: '2', name: '欧美' }, { id: '3', name: '飙升' }]
  const themes = Object.fromEntries([theme('华语', 6), theme('欧美', 2), theme('飙升', -3)])
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0 })?.id, '1')
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0.5 })?.id, '1')
  assert.equal(pickWeightedTag(tags, themes, { now: 1000, temperature: 1, rng: () => 0.99 })?.id, '2')
  // 负偏好分类放在目录首位也不能登场（旧写法靠 rotation % 4 让它定期出场）
  const burnedFirst = [{ id: '3', name: '飙升' }, { id: '1', name: '华语' }, { id: '2', name: '欧美' }]
  for (const roll of [0, 0.5, 0.99]) {
    assert.notEqual(pickWeightedTag(burnedFirst, themes, { now: 1000, temperature: 1, rng: () => roll })?.id, '3')
  }
  // 重度用户的净权是累加量、没有上界。不减最大净权直接 exp(900) 会溢出成 Infinity，
  // 减法全变 NaN、永远走不到 roll <= 0，最后静默返回权重最低的那个分类——正好是该压下去的那个。
  const heavy = Object.fromEntries([theme('华语', 900), theme('欧美', 2), theme('飙升', -3)])
  for (const roll of [0, 0.5, 0.99]) {
    const picked = pickWeightedTag(tags, heavy, { now: 1000, temperature: 1, rng: () => roll })
    assert.ok(picked, '溢出防护失效时这里会拿到 undefined')
    assert.equal(picked?.id, '1', `roll ${roll} 应落在高权重分类，实拿 ${picked?.id}`)
  }
})

test('没有正偏好分类时退回按轮次游走，冷启动不空转', () => {
  const tags = [{ id: '1', name: '华语' }, { id: '2', name: '欧美' }, { id: '3', name: '飙升' }]
  assert.equal(pickWeightedTag(tags, {}, { rotation: 0 })?.id, '1')
  assert.equal(pickWeightedTag(tags, {}, { rotation: 1 })?.id, '2')
  assert.equal(pickWeightedTag(tags, {}, { rotation: 4 })?.id, '2')
  assert.equal(pickWeightedTag([], {}, { rotation: 0 }), null)
})
