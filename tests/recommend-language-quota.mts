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

test('0% 是明确不要：目标 0 首、照常 enforced，且不吃余数名额', () => {
  assert.deepEqual(computeLangTargets({ zh: 0 }, 20), { targets: { zh: 0 }, free: 20, enforced: true })
  const mixed = computeLangTargets({ zh: 0, western: 100 }, 20)
  assert.equal(mixed.targets.zh, 0, '0% 桶要出现在 targets 里')
  assert.equal(mixed.targets.en, 20, '窗口名额全给滑过的那个桶，0% 桶一个都不分')
  assert.equal(mixed.free, 0)
  assert.equal(mixed.enforced, true)
})

test('0% 桶的上限不给容差，非零目标才留四舍五入的余地', () => {
  const zero = computeLangCaps({ enforced: true, targets: { zh: 0 }, free: 20 }, {})
  assert.equal(zero.caps.zh, 0, '0% 是明确不要，加容差等于替用户改口')
  assert.equal(langWithinCap('zh', zero.caps), false)
  // 对照组：目标 1 首时容差照旧 +1，证明只有零配额不吃容差
  const one = computeLangCaps({ enforced: true, targets: { zh: 1 }, free: 19 }, {})
  assert.equal(one.caps.zh, 2)
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
  // 只有第一条能区分"尾部连续段"和"全窗口计数"：全窗口会数到 2 个 zh 而误拦
  assert.equal(consecutiveLangAllowed(['zh', 'en', 'en', 'en', 'zh'], 'zh'), true)
  // 第二条是反面补位：尾部真攒够 2 连照样拦
  assert.equal(consecutiveLangAllowed(['en', 'en', 'en', 'zh', 'zh'], 'zh'), false)
})

test('名额不能整除时余数照最大余数法补齐，一个名额都不丢', () => {
  // 20 首按 34/33/33 分：各得 floor 6，共 18；剩 2 首按余数补给 zh(.8) 与 en(.6)
  // 这条是 allocateByPercents 里 `for (let i = allocated; i < total; i++)` 唯一的实跑证据
  const result = computeLangTargets({ zh: 34, western: 33, ja: 33 })
  assert.deepEqual(result.targets, { zh: 7, en: 7, ja: 6 })
  assert.equal(result.free, 0)
})

test('纯音乐每窗口最多 2 首，且只数最近 20 首', () => {
  assert.equal(instrumentalAllowed(['instr', 'instr', 'zh']), false)
  assert.equal(instrumentalAllowed(['instr', 'zh']), true)
  const long = ['instr' as const, 'instr' as const, ...Array.from({ length: 25 }, () => 'zh' as const)]
  assert.equal(instrumentalAllowed(long), true)
})

test('窗口 0 或负数按空窗口算，不能退化成看全历史', () => {
  // arr.slice(-0) === arr.slice(0)：不夹紧的话 Task 5/6 传一个算出来的剩余窗口就会把全历史当本轮用量
  assert.deepEqual(countLangUsed(['zh', 'zh', 'en'], 0), {})
  assert.deepEqual(countLangUsed(['zh', 'zh', 'en'], -5), {})
  assert.equal(instrumentalAllowed(['instr', 'instr'], 0), true)
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

test('停在 50% 的桶不冒充配额声明：读路径自己认这条契约', () => {
  // sanitizeWeights 现在丢 50，但 Task 8/9 写进盘上的 {zh: 50} 还在（v9 迁移原样搬运，不重新 sanitize）。
  // 读侧不挡住它，一条存量中性值就会凭空占掉半窗名额。
  assert.deepEqual(computeLangTargets({ zh: 50 }, 20), { targets: {}, free: 20, enforced: false })
  const mixed = computeLangTargets({ zh: 50, western: 100 }, 20)
  assert.equal('zh' in mixed.targets, false, '50% 的桶不进 targets，名额全归真正滑过的那一侧')
  assert.equal(mixed.targets.en, 20)
  assert.equal(mixed.free, 0)
})
