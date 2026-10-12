import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OPTION_TO_BUCKET,
  computeLangTargets,
  countLangUsed,
  computeLangCaps,
  langWithinCap,
  consecutiveLangAllowed,
  instrumentalAllowed,
  countPoolLang,
} from '../src/core/recommend/languageQuota.ts'

test('选项 id 映射到语种桶', () => {
  assert.deepEqual({ ...OPTION_TO_BUCKET }, {
    zh: 'zh', cantonese: 'yue', western: 'en', ja: 'ja', ko: 'ko', other: 'other',
  })
})

test('百分比是绝对占比：中文 10% 在 20 首窗口里是 2 首，其余是自由名额', () => {
  const result = computeLangTargets({ zh: 10 })
  assert.deepEqual(result.targets, { zh: 2 })
  assert.equal(result.free, 18)
  assert.equal(result.enforced, true)
})

test('问卷全空时不设配额', () => {
  assert.deepEqual(computeLangTargets({}), { targets: {}, free: 20, enforced: false })
  assert.deepEqual(computeLangTargets({ pop: 80 }), { targets: {}, free: 20, enforced: false })
})

test('声明合计超过 100 时按比例缩进窗口，用最大余数法不丢名额', () => {
  const result = computeLangTargets({ zh: 60, western: 30, ja: 30 })
  assert.deepEqual(result.targets, { zh: 10, en: 5, ja: 5 })
  assert.equal(result.free, 0)
})

test('窗口大小可注入，目标数按占比缩放', () => {
  assert.deepEqual(computeLangTargets({ zh: 10 }, 10).targets, { zh: 1 })
  assert.deepEqual(computeLangTargets({ zh: 10 }, 10).free, 9)
})

test('已用量把上限压到剩余缺口，并带 1 首容差', () => {
  const targets = computeLangTargets({ zh: 10 })
  const used = countLangUsed(['zh', 'zh', 'en', 'unknown', undefined])
  assert.deepEqual(used, { zh: 2, en: 1 })
  assert.deepEqual(computeLangCaps(targets, used).caps, { zh: 1 })
})

test('已用量超过目标时上限收紧到容差，不会给负数', () => {
  const targets = computeLangTargets({ zh: 10 })
  assert.deepEqual(computeLangCaps(targets, { zh: 5 }).caps, { zh: 1 })
})

test('未声明的桶不进 caps，enforced 为 false 时 caps 是空对象', () => {
  const targets = computeLangTargets({ zh: 10 })
  const caps = computeLangCaps(targets, {})
  assert.equal('yue' in caps.caps, false)
  assert.equal(caps.enforced, true)
  assert.deepEqual(computeLangCaps(computeLangTargets({}), {}), { enforced: false, caps: {} })
})

test('unknown 与判不出的歌永不受配额限制', () => {
  assert.equal(langWithinCap('unknown', { zh: 0 }), true)
  assert.equal(langWithinCap(undefined, { zh: 0 }), true)
  assert.equal(langWithinCap('yue', { zh: 0 }), true)
  assert.equal(langWithinCap('zh', { zh: 0 }), false)
  assert.equal(langWithinCap('zh', { zh: 3 }), true)
})

test('同语言连播硬规则只看尾部连续段，不看全窗口', () => {
  assert.equal(consecutiveLangAllowed(['zh', 'zh'], 'zh'), false)
  assert.equal(consecutiveLangAllowed(['zh'], 'zh'), true)
  assert.equal(consecutiveLangAllowed(['zh', 'en', 'zh', 'zh'], 'zh'), false)
  assert.equal(consecutiveLangAllowed(['en', 'en'], 'zh'), true)
  assert.equal(consecutiveLangAllowed(['unknown', 'unknown'], 'unknown'), true)
  assert.equal(consecutiveLangAllowed(['unknown', 'unknown'], 'zh'), true)
})

test('纯音乐每窗口最多 2 首，且只数最近 20 首', () => {
  assert.equal(instrumentalAllowed(['instr', 'instr', 'zh']), false)
  assert.equal(instrumentalAllowed(['instr', 'zh']), true)
  const long = ['instr' as const, 'instr' as const, ...Array.from({ length: 25 }, () => 'zh' as const)]
  assert.equal(instrumentalAllowed(long), true)
})

test('池内按桶计数：lang 优先，判不出退 langHint，再不行算 unknown', () => {
  const counts = countPoolLang([
    { lang: 'zh', langHint: 'en' },
    { lang: 'en' },
    { langHint: 'ja' },
    {},
  ])
  assert.deepEqual(counts, { zh: 1, en: 1, ja: 1, unknown: 1 })
})
