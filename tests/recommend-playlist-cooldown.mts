import test from 'node:test'
import assert from 'node:assert/strict'

import { createPlaylistPreference, updatePlaylistPreference } from '../src/core/recommend/feedback.ts'

const HOUR = 3600000
const DAY = 24 * HOUR

const mkPref = (id = 'pl-1', extra = {}) => ({ ...createPlaylistPreference(id, 1000), ...extra })

test('first instant skip puts the playlist into a 12h soft cooldown', () => {
  const next = updatePlaylistPreference(
    mkPref(),
    { id: 'pl-1', positiveDelta: 0, negativeDelta: 1.5, instantSkip: true, negativeTrackKey: 't1' },
    2000,
  )
  assert.equal(next.negativeWeight, 1.5)
  assert.equal(next.instantSkipCount, 1)
  assert.equal(next.cooldownFactor, 0.1)
  assert.equal(next.cooldownUntil, 2000 + 12 * HOUR)
})

test('second instant skip bans the playlist for 30 days', () => {
  const once = updatePlaylistPreference(
    mkPref(),
    { id: 'pl-1', positiveDelta: 0, negativeDelta: 1.5, instantSkip: true, negativeTrackKey: 't1' },
    2000,
  )
  const twice = updatePlaylistPreference(
    once,
    { id: 'pl-1', positiveDelta: 0, negativeDelta: 1.5, instantSkip: true, negativeTrackKey: 't2' },
    3000,
  )
  assert.equal(twice.instantSkipCount, 2)
  assert.equal(twice.cooldownUntil, 3000 + 30 * DAY)
  assert.equal(twice.cooldownFactor, 0.1)
})

test('a heavy negative ledger escalates the first instant skip straight to a ban', () => {
  const heavy = mkPref('pl-1', { negativeWeight: 2 })
  const next = updatePlaylistPreference(
    heavy,
    { id: 'pl-1', positiveDelta: 0, negativeDelta: 1.5, instantSkip: true, negativeTrackKey: 't1' },
    2000,
  )
  assert.equal(next.cooldownUntil, 2000 + 30 * DAY)
})

test('any positive feedback clears cooldown, factor and instant-skip count', () => {
  const cooled = updatePlaylistPreference(
    mkPref(),
    { id: 'pl-1', positiveDelta: 0, negativeDelta: 1.5, instantSkip: true, negativeTrackKey: 't1' },
    2000,
  )
  const healed = updatePlaylistPreference(cooled, { id: 'pl-1', positiveDelta: 0.6, negativeDelta: 0 }, 5000)
  assert.equal(healed.cooldownUntil, undefined)
  assert.equal(healed.cooldownFactor, undefined)
  assert.equal(healed.instantSkipCount, 0)
  assert.equal(healed.consecutiveNegativeCount, 0)
  assert.equal(healed.positiveWeight, 0.6)
})

test('legacy three-distinct-track cooldown still applies to non-instant negatives', () => {
  let pref = mkPref()
  for (const track of ['t1', 't2', 't3']) {
    pref = updatePlaylistPreference(
      pref,
      { id: 'pl-1', positiveDelta: 0, negativeDelta: 0.5, negativeTrackKey: track },
      2000,
    )
  }
  assert.equal(pref.distinctNegativeTracks, 3)
  assert.equal(pref.cooldownUntil, 2000 + 30 * 60000)
  assert.equal(pref.cooldownFactor, undefined)
  assert.equal(pref.instantSkipCount, undefined)
})
