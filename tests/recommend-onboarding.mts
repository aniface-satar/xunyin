import test from 'node:test'
import assert from 'node:assert/strict'

import { ONBOARDING_OPTIONS, sanitizeWeights, computeSeedWeights, applySeedWeights, revokeSeedWeights, computePreferenceKeywords, mergePreferenceKeywords } from '../src/core/recommend/onboarding.ts'
import { createDefaultState, migrateRecommendationState } from '../src/core/recommend/stateSchema.ts'
import { pickPlaylistTag } from '../src/core/recommend/tabSections.ts'
import type { ThemePreference } from '../src/core/recommend/types.ts'

test('ONBOARDING_OPTIONS ids are unique', () => {
  const ids = ONBOARDING_OPTIONS.map(option => option.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('sanitizeWeights keeps 0% as a declaration and drops the neutral 50%', () => {
  const out = sanitizeWeights({ zh: 50, bogus: 80, pop: 105, rock: -20, folk: 35, jazz: 0 })
  // 0 是"明确不要"，键必须在；滑在中性点 50 才是"没表态"，键必须不在
  assert.equal(out.jazz, 0, '0% 要留着')
  assert.equal('jazz' in out, true)
  assert.equal('zh' in out, false, '停在 50% 等于没滑过')
  assert.equal('bogus' in out, false, '非法 id 照旧丢掉')
  assert.equal(out.pop, 100, '105 钳到 100')
  assert.equal(out.folk, 40, '35 取整到 10 的倍数')
  assert.equal(out.rock, 0, '-20 钳到 0，并因此作为 0% 声明保留')
  assert.deepEqual(out, { pop: 100, rock: 0, folk: 40, jazz: 0 })
})

test('0% 与没滑过是两件事：0% 播最强负分量，停在 50% 什么都不播', () => {
  const zero = computeSeedWeights({ zh: 0 })
  const ten = computeSeedWeights({ zh: 10 })
  for (const key of ['华语', '国语', '中文', '内地']) {
    assert.equal(zero[key], -2, `0% 要给 ${key} 落上最强负分量`)
    assert.ok(zero[key] < 0, `${key} 必须是负分量`)
    assert.ok(Math.abs(zero[key]) > Math.abs(ten[key]), `${key} 上 0% 要比 10% 更狠`)
  }
  assert.deepEqual(computeSeedWeights({}), {})
  assert.deepEqual(computeSeedWeights({ zh: 50 }), {}, '中性点 50% 不是声明，一条都不播')
})

test('computeSeedWeights uses 50% as the neutral point: above seeds positive, below seeds negative', () => {
  const seeds = computeSeedWeights({ western: 100, jazz: 50, rnb: 10 })
  assert.equal(seeds['欧美'], 4)
  assert.equal(seeds['英文'], 4)
  assert.equal(seeds['爵士'], undefined)
  assert.equal(seeds['r&b'], -1.6)
  assert.equal(seeds['节奏布鲁斯'], -1.6)
  // 补齐数值表的中间两档：负支只取正支一半幅度（80 → +2.4、20 → -1.2），漏钉这档就看不出比例写反
  const mid = computeSeedWeights({ jazz: 80, rnb: 20 })
  assert.equal(mid['爵士'], 2.4)
  assert.equal(mid['r&b'], -1.2)
})

// electronic:100 → +4、dj:20 → -1.2，都别名到 dj 键：同键取绝对值更大的一侧，结果仍是 +4
test('computeSeedWeights takes the max when two options share an alias key', () => {
  const seeds = computeSeedWeights({ electronic: 100, dj: 20 })
  assert.equal(seeds.dj, 4)
})

test('applySeedWeights adds onto existing positive and keeps negative', () => {
  const themes = { 欧美: { themeId: '欧美', positiveWeight: 1, negativeWeight: 2, lastDecayTime: 0, lastUsedTime: 0 } }
  applySeedWeights(themes, { 欧美: 4, 民谣: 2 }, 1000)
  assert.equal(themes['欧美'].positiveWeight, 5)
  assert.equal(themes['欧美'].negativeWeight, 2)
  assert.equal(themes['民谣'].positiveWeight, 2)
  assert.equal(themes['民谣'].themeId, '民谣')
})

test('revokeSeedWeights subtracts only the seeded component and drops cleared entries', () => {
  const themes = {
    欧美: { themeId: '欧美', positiveWeight: 6, negativeWeight: 0, lastDecayTime: 0, lastUsedTime: 0 },
    英文: { themeId: '英文', positiveWeight: 1, negativeWeight: 0, lastDecayTime: 0, lastUsedTime: 0 },
    西洋: { themeId: '西洋', positiveWeight: 4, negativeWeight: 3, lastDecayTime: 0, lastUsedTime: 0 },
  }
  revokeSeedWeights(themes, { 欧美: 4, 英文: 4, 西洋: 4 })
  assert.equal(themes['欧美'].positiveWeight, 2)
  assert.equal(themes['英文'], undefined)
  assert.equal(themes['西洋'].positiveWeight, 0)
  assert.equal(themes['西洋'].negativeWeight, 3)
  revokeSeedWeights(themes, { 英文: 4 })
})

test('computePreferenceKeywords keeps >=20 percent options sorted by weight desc', () => {
  assert.deepEqual(computePreferenceKeywords({ ko: 20, zh: 80, pop: 80, rock: 10 }), ['华语', '流行', '韩语'])
  assert.deepEqual(computePreferenceKeywords({}), [])
})

test('mergePreferenceKeywords puts preference words first without duplicates', () => {
  assert.deepEqual(mergePreferenceKeywords(['周杰伦', '华语'], ['华语', '说唱']), ['华语', '说唱', '周杰伦'])
})

test('pickPlaylistTag prefers a seeded category in the learning rotation', () => {
  const tags = [
    { id: '1', name: '华语' },
    { id: '2', name: '欧美' },
    { id: '3', name: '古风' },
  ]
  const themes = {}
  applySeedWeights(themes, computeSeedWeights({ western: 100 }), 1000)
  for (const rotation of [0, 1, 2]) {
    assert.equal(pickPlaylistTag(tags, themes, [], rotation, 1000)?.name, '欧美')
  }
})

test('default state carries an unfinished onboarding', () => {
  const state = createDefaultState()
  assert.equal(state.version, 9)
  assert.deepEqual(state.onboarding, { completed: false, weights: {}, seededThemeWeights: {} })
})

test('migrating a v6 state with learning history still shows onboarding', () => {
  const migrated = migrateRecommendationState({ tracks: { kw__1: { trackKey: 'kw__1' } } })
  assert.equal(migrated.onboarding.completed, false)
  assert.deepEqual(migrated.onboarding.weights, {})
})

test('migrating an empty legacy state keeps onboarding pending', () => {
  const migrated = migrateRecommendationState({ themeWeights: {} })
  assert.equal(migrated.onboarding.completed, false)
})

test('a v7 submitted onboarding is re-shown with its answers carried over', () => {
  const migrated = migrateRecommendationState({
    version: 7,
    onboarding: { completed: true, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } },
  })
  assert.deepEqual(migrated.onboarding, {
    completed: false,
    weights: { zh: 70 },
    seededThemeWeights: { 华语: 1.6, 国语: 1.6, 中文: 1.6, 内地: 1.6 },
  })
  // completed 被重置成"要重填"，但播种照常写入：他下次提交问卷时 index.ts 精确退掉的正是这一笔
  assert.equal(migrated.themeWeights['华语'].positiveWeight, 1.6)
  assert.equal(Object.keys(migrated.themeWeights).length, 4, '四个别名各播一条，没播第二次也没漏一条')
})

test('a version 8 onboarding is reseeded with the neutral-point formula', () => {
  const migrated = migrateRecommendationState({
    version: 8,
    themeWeights: {
      华语: { themeId: '华语', positiveWeight: 0.4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
    },
    onboarding: { completed: true, weights: { zh: 10 }, seededThemeWeights: { 华语: 0.4 } },
  })
  // 老分量 +0.4 精确退掉，再按新公式播成 -1.6：10% 从此是负偏好
  // 播种按选项的**全部别名**逐键写入（zh 有 4 个别名），所以这里必须列满四键——少写一键就是断言错，不是实现错
  assert.deepEqual(migrated.onboarding.seededThemeWeights, { 华语: -1.6, 国语: -1.6, 中文: -1.6, 内地: -1.6 })
  assert.equal(migrated.themeWeights['华语'].positiveWeight, 0)
  assert.equal(migrated.themeWeights['华语'].negativeWeight, 1.6)
  assert.equal(Object.keys(migrated.themeWeights).length, 4, '四个别名各占一条，用户没点过的 国语/中文/内地 也会被播上')
  assert.equal(migrated.onboarding.completed, true)
  assert.equal(migrated.version, 9)
})

test('applySeedWeights routes a negative seed to negativeWeight only', () => {
  // 必须显式标注：`const themes = {}` 会被推成 `{}`，之后每次 themes['华语'] 都吃一条 TS7053，
  // 这条用例的五个索引读取会把全项目 tsc 基线从 137 顶到 142。写法同 tests/recommend-lang-bucket-supply.mts:6
  const themes: Record<string, ThemePreference> = {}
  applySeedWeights(themes, { 华语: -1.6, 欧美: 4 }, 1000)
  assert.equal(themes['华语'].positiveWeight, 0)
  assert.equal(themes['华语'].negativeWeight, 1.6)
  assert.equal(themes['欧美'].positiveWeight, 4)
  assert.equal(themes['欧美'].negativeWeight, 0)
  applySeedWeights(themes, { 民谣: 0 }, 1000)
  assert.equal(themes['民谣'], undefined, 'a neutral seed must not create an entry')
})

test('revokeSeedWeights undoes a negative seed and keeps the user own net weight', () => {
  const themes = {
    华语: { themeId: '华语', positiveWeight: 0, negativeWeight: 2.6, lastDecayTime: 1000, lastUsedTime: 1000 },
    欧美: { themeId: '欧美', positiveWeight: 0, negativeWeight: 1.6, lastDecayTime: 1000, lastUsedTime: 1000 },
    爵士: { themeId: '爵士', positiveWeight: 1, negativeWeight: 0.6, lastDecayTime: 1000, lastUsedTime: 1000 },
  }
  revokeSeedWeights(themes, { 华语: -1.6, 欧美: -1.6, 爵士: -4 })
  assert.equal(themes['华语'].negativeWeight, 1, '用户自己点出来的负权要留着')
  assert.equal(themes['欧美'], undefined, '两侧都归 0 就删条目')
  // 分量比记录值大（老数据被衰减过）时只钳到 0，绝不把 negativeWeight 写成负数
  assert.equal(themes['爵士'].negativeWeight, 0)
  assert.equal(themes['爵士'].positiveWeight, 1)
})

test('replaying a v9 state does not touch its seeds again', () => {
  const stored = {
    version: 9,
    themeWeights: { 华语: { themeId: '华语', positiveWeight: 0, negativeWeight: 1.6, lastDecayTime: 1000, lastUsedTime: 1000 } },
    onboarding: { completed: true, weights: { zh: 10 }, seededThemeWeights: { 华语: -1.6 } },
  }
  const migrated = migrateRecommendationState(stored)
  assert.deepEqual(migrated.onboarding, stored.onboarding)
  assert.equal(migrated.themeWeights['华语'].negativeWeight, 1.6)
})

test('running the v8 migration twice lands on the same place', () => {
  const legacy = {
    version: 8,
    themeWeights: {
      华语: { themeId: '华语', positiveWeight: 0.4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
      欧美: { themeId: '欧美', positiveWeight: 4, negativeWeight: 0, lastDecayTime: 1000, lastUsedTime: 1000 },
    },
    onboarding: {
      completed: true,
      weights: { zh: 10, western: 100 },
      seededThemeWeights: { 华语: 0.4, 欧美: 4, 英文: 4, 英语: 4, 西洋: 4 },
    },
  }
  const once = migrateRecommendationState(legacy)
  // 先钉死第一趟的真实落点：只比 once/twice 的话，两趟一起写错也照样绿
  assert.deepEqual(once.onboarding.seededThemeWeights, {
    华语: -1.6, 国语: -1.6, 中文: -1.6, 内地: -1.6,
    欧美: 4, 英文: 4, 英语: 4, 西洋: 4,
  })
  assert.equal(Object.keys(once.themeWeights).length, 8, '四个别名各一条，没多出残留条目')
  // 键数抓不到"没退干净"：老 +4 若退不掉，欧美 会是 8 而不是 4，键数照旧
  assert.equal(once.themeWeights['欧美'].positiveWeight, 4, '老分量退干净了，新分量一条不多一条不少')
  const twice = migrateRecommendationState(once)
  assert.deepEqual(twice.onboarding, once.onboarding)
  assert.deepEqual(twice.themeWeights, once.themeWeights)
})

test('停在 50% 的选项不贡献关键词池条目（存量脏 50 不算偏好）', () => {
  // sanitizeWeights 写侧丢 50，但 v9 迁移把 Task 8/9 存量的 {zh: 50} 原样搬过来；
  // 关键词池只管 >=20 的门槛，不挡就会让"没意见"的语言进选榜定向，和新配额契约自相矛盾
  assert.deepEqual(computePreferenceKeywords({ zh: 50 }), [])
  assert.deepEqual(computePreferenceKeywords({ zh: 50, ko: 80 }), ['韩语'])
})

test('版本问卷下线后的存量：no_* 勾选与 token 负初值在读档时擦掉', () => {
  // v10/v11 的版本问卷已整体回退，但设备上还留着那版写进状态的三样东西；
  // 不擦干净就是"代码回到两问版、分数没回"，推荐会比上一版更窄。
  const stored: any = {
    version: 11,
    onboarding: {
      completed: true,
      weights: { zh: 80, no_dj: 100, no_remix: 100, remix: 70 },
      seededThemeWeights: { 华语: 2.4 },
      seededTokenWeights: { dj: -3, remix: -3 },
    },
    tokenWeights: {
      dj: { themeId: 'dj', positiveWeight: 0, negativeWeight: 3, lastDecayTime: 1, lastUsedTime: 1 },
      remix: { themeId: 'remix', positiveWeight: 0, negativeWeight: 3, lastDecayTime: 1, lastUsedTime: 1 },
      华语: { themeId: '华语', positiveWeight: 1, negativeWeight: 0, lastDecayTime: 1, lastUsedTime: 1 },
    },
  }
  const migrated = migrateRecommendationState(stored)
  assert.deepEqual(migrated.onboarding.weights, { zh: 80, dj: 70 }, 'no_* 清掉，拆出去的 remix 并回 dj')
  assert.equal('seededTokenWeights' in migrated.onboarding, false, '中间态字段不再落盘')
  assert.equal(migrated.tokenWeights.dj, undefined, '负初值退干净后不留空条目')
  assert.equal(migrated.tokenWeights.remix, undefined)
  assert.equal(migrated.tokenWeights['华语'].positiveWeight, 1, '真实学习净权不受影响')
  assert.equal(migrated.version, createDefaultState().version)
  const replayed = migrateRecommendationState(migrated)
  assert.deepEqual(replayed.onboarding, migrated.onboarding, '再读一次不改动')
  assert.deepEqual(replayed.tokenWeights, migrated.tokenWeights)
})
