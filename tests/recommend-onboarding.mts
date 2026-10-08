import test from 'node:test'
import assert from 'node:assert/strict'

import { ONBOARDING_OPTIONS, sanitizeWeights, computeSeedWeights, applySeedWeights, revokeSeedWeights, computePreferenceKeywords, mergePreferenceKeywords } from '../src/core/recommend/onboarding.ts'
import { createDefaultState, migrateRecommendationState } from '../src/core/recommend/stateSchema.ts'
import { pickPlaylistTag } from '../src/core/recommend/tabSections.ts'

test('ONBOARDING_OPTIONS ids are unique', () => {
  const ids = ONBOARDING_OPTIONS.map(option => option.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('sanitizeWeights drops invalid ids, clamps and rounds to tens, removes zeros', () => {
  const out = sanitizeWeights({ zh: 50, bogus: 80, pop: 105, rock: -20, folk: 35, jazz: 0 })
  assert.deepEqual(out, { zh: 50, pop: 100, folk: 40 })
})

test('computeSeedWeights keys are normalized aliases and values scale with percent', () => {
  const seeds = computeSeedWeights({ western: 100, jazz: 50 })
  assert.equal(seeds['欧美'], 4)
  assert.equal(seeds['英文'], 4)
  assert.equal(seeds['爵士'], 2)
  assert.equal(seeds['r&b'], undefined)
})

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
  assert.equal(state.version, 8)
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
  assert.deepEqual(migrated.onboarding, { completed: false, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } })
})

test('a version 8 stored onboarding survives migration untouched', () => {
  const migrated = migrateRecommendationState({
    version: 8,
    onboarding: { completed: true, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } },
  })
  assert.deepEqual(migrated.onboarding, { completed: true, weights: { zh: 70 }, seededThemeWeights: { 华语: 2.8 } })
})
