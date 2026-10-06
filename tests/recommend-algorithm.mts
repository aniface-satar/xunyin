import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTrackKey, canonicalTrackKey, getArtistKeys, getPrimaryArtist, isSameRecording } from '../src/core/recommend/trackKey.ts'
import { buildLibraryIndexData } from '../src/core/recommend/libraryIndex.ts'
import { getExclusionReason } from '../src/core/recommend/filter.ts'
import { recommendationConfig } from '../src/core/recommend/config.ts'
import { planChannelQuotas } from '../src/core/recommend/channels.ts'
import { selectFinalQueue } from '../src/core/recommend/diversity.ts'
import { computeCandidateCoOccurrence, computeFeedbackQuality, computePlaylistScore, computePlaylistSimilarity, groupSimilarPlaylists, buildTrackPlaylistIndex } from '../src/core/recommend/similarity.ts'
import { settleExplicitFeedback, settlePlayRecord, computeEffectiveCoverage, mergeIntervals, shouldSuppressImplicitSettlement, shouldApplyImplicitSettlement, applyThemeFeedback, themeNetWeight, themeAffinityFactor } from '../src/core/recommend/feedback.ts'
import { createPlaybackTracker, finishPlaybackTracker, notePlaybackSeek, observePlaybackSample } from '../src/core/recommend/listening.ts'
import { buildRadioProfile, selectProfileSeeds, buildPlaylistKeywords } from '../src/core/recommend/profile.ts'
import { createRadioQueue } from '../src/core/recommend/queue.ts'
import { migrateRecommendationState, createDefaultState } from '../src/core/recommend/stateSchema.ts'
import { computeBackoffMs, runWithRetry, withTimeout } from '../src/core/recommend/requestPolicy.ts'
import { mergePoolCandidates, createPoolCandidate, buildFinalQueueItems, filterPoolCandidates, planRefreshBudget } from '../src/core/recommend/candidatePool.ts'
import { upsertObservedPlaylist, computeWeakThemeScore } from '../src/core/recommend/playlistIndex.ts'
import { computeSessionHealth, buildSessionPenalties, sessionPenaltyScore, sessionPenaltyFactor, shouldDeferQueuedItem, mapNegativeRateToFactor } from '../src/core/recommend/sessionHealth.ts'
import { tokenizeTrackName } from '../src/core/recommend/tokenize.ts'
import { applyNameTokenFeedback, nameTokenFactor, getLearnedStyleTokens } from '../src/core/recommend/tokenFeedback.ts'
import { applyArtistStatsFeedback, artistPriorFactor } from '../src/core/recommend/artistPrior.ts'
import { pickChartBoard } from '../src/core/recommend/profile.ts'
import { getTimeSlot, computeTimeSlotAffinity } from '../src/core/recommend/timeSlot.ts'
import { computeLogMelFrames, buildPatches, cosine } from '../src/core/recommend/melSpectrogram.ts'
import { quantizeEmbedding, dequantizeEmbedding, getTasteCentroid, computePlaylistAudioAffinity, audioModelId, bytesToBase64, base64ToBytes } from '../src/core/recommend/audioEmbedding.ts'
import { updateChannelBandit, thompsonMultiplier } from '../src/core/recommend/bandit.ts'
import { buildSessionCoOccurrence } from '../src/core/recommend/similarity.ts'
import type { FinalQueueItem } from '../src/core/recommend/diversity.ts'
import type { ObservedPlaylist, PoolCandidate } from '../src/core/recommend/types.ts'
import { selectDeferredTrackKeys } from '../src/core/recommend/queueDeferral.ts'

const mkMusic = (id: string, name: string, singer: string, source = 'kw', interval = '03:00') => ({
  id,
  name,
  singer,
  source,
  interval,
  meta: { songId: id, albumName: `${name}-album`, qualitys: [], _qualitys: {} },
}) as any

const seedRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// 引擎按单首候选判重（getExclusionReason），测试保留批量写法便于断言
const filterExcluded = (tracks, context) => {
  const accepted = []
  const rejected = []
  for (const track of tracks) {
    const reason = getExclusionReason(track, context)
    if (reason) rejected.push({ track, reason })
    else accepted.push(track)
  }
  return { accepted, rejected }
}

test('full library index excludes favorites and all user playlists across sources', () => {
  const index = buildLibraryIndexData([
    { id: 'love', isLove: true, tracks: [mkMusic('kw_1', '晴天', '周杰伦', 'kw')] },
    { id: 'user-a', tracks: [mkMusic('wy_2', '七里香', '周杰伦', 'wy')] },
  ])
  const context = {
    libraryKeys: index.keys,
    dislikedTrackKeys: new Set<string>(),
    queuedTrackKeys: new Set<string>(),
    sessionTrackKeys: new Set<string>(),
    recentRadioTrackKeys: new Set<string>(),
    blocked: { names: new Set<string>(), musicNames: new Set<string>(), singerNames: new Set<string>() },
  }
  const sameRecordingOtherSource = mkMusic('tx_9', '晴天', '周杰伦', 'tx')
  const liveVersion = mkMusic('tx_10', '晴天 (Live)', '周杰伦', 'tx')
  const result = filterExcluded([sameRecordingOtherSource, liveVersion], context)
  assert.equal(result.accepted.length, 1)
  assert.equal(result.accepted[0].id, 'tx_10')
  assert.equal(result.rejected[0].reason, 'library')
  assert.equal(isSameRecording(sameRecordingOtherSource, mkMusic('kw_1', '晴天', '周杰伦')), true)
})

test('library index records the network playlists an imported track came from', () => {
  const song = mkMusic('kw_1', '晴天', '周杰伦', 'kw')
  const index = buildLibraryIndexData([
    { id: 'love', isLove: true, tracks: [song] },
    { id: 'user-a', source: 'kw', sourceListId: '111', tracks: [song] },
    { id: 'user-b', source: 'wy', sourceListId: '222', tracks: [mkMusic('kw_1', '晴天', '周杰伦', 'kw')] },
    { id: 'user-c', source: 'kw', sourceListId: '111', tracks: [mkMusic('kw_2', '枫', '周杰伦', 'kw')] },
  ])
  assert.deepEqual(index.entries.get(buildTrackKey(song))?.origins, ['kw::111', 'wy::222'])
  assert.deepEqual(index.entries.get(buildTrackKey(mkMusic('kw_2', '枫', '周杰伦', 'kw')))?.origins, ['kw::111'])
  assert.equal(index.entries.get(buildTrackKey(mkMusic('kw_3', '不在库里', '周杰伦', 'kw')))?.origins, undefined)
})

test('explicit dislike, manual blocks, queue and session are respected', () => {
  const context = {
    libraryKeys: new Set<string>(),
    dislikedTrackKeys: new Set([canonicalTrackKey('bad', 'A')]),
    queuedTrackKeys: new Set([canonicalTrackKey('queued', 'B')]),
    sessionTrackKeys: new Set([canonicalTrackKey('played', 'C')]),
    recentRadioTrackKeys: new Set([canonicalTrackKey('recent', 'D')]),
    blocked: {
      names: new Set<string>(),
      musicNames: new Set<string>(['blocked song']),
      singerNames: new Set<string>(['bad artist']),
    },
  }
  const cases: Array<[ReturnType<typeof mkMusic>, string | undefined]> = [
    [mkMusic('1', 'bad', 'A'), 'disliked'],
    [mkMusic('2', 'queued', 'B'), 'queued'],
    [mkMusic('3', 'played', 'C'), 'session_played'],
    [mkMusic('4', 'recent', 'D'), 'recent_radio_7d'],
    [mkMusic('5', 'Blocked Song', 'E'), 'blocked_song'],
    [mkMusic('6', 'ok', 'Bad Artist'), 'blocked_artist'],
    [mkMusic('7', 'fresh', 'F'), undefined],
  ]
  for (const [track, reason] of cases) {
    const result = filterExcluded([track], context)
    if (reason) {
      assert.equal(result.accepted.length, 0, `${track.name} should be rejected`)
      assert.equal(result.rejected[0].reason, reason)
    } else {
      assert.equal(result.accepted.length, 1)
    }
  }
})

test('artist splitting keeps AC/DC together and handles chorus participants', () => {
  assert.deepEqual(getArtistKeys('AC/DC'), ['ac/dc'])
  assert.deepEqual(getArtistKeys('周杰伦、费玉清'), ['周杰伦', '费玉清'])
  assert.deepEqual(getArtistKeys('Simon & Garfunkel'), ['simon & garfunkel'])
  assert.equal(getPrimaryArtist(mkMusic('1', 'x', '周杰伦/费玉清')), '周杰伦')
})

test('canonical key keeps Live/Remix versions distinct and same name across sources merged', () => {
  assert.equal(buildTrackKey(mkMusic('kw_1', '晴天', '周杰伦')), buildTrackKey(mkMusic('wy_1', '晴天', '周杰伦', 'wy')))
  assert.notEqual(buildTrackKey(mkMusic('kw_2', '晴天 (Live)', '周杰伦')), buildTrackKey(mkMusic('kw_3', '晴天 Remix', '周杰伦')))
  assert.notEqual(buildTrackKey(mkMusic('kw_4', '晴天 伴奏', '周杰伦')), buildTrackKey(mkMusic('kw_5', '晴天', '周杰伦')))
})

const mkFinalItem = (
  key: string,
  artist: string,
  channel: 'A' | 'B' | 'C' | 'D',
  extra: Partial<FinalQueueItem> = {},
): FinalQueueItem => ({
  key,
  channels: [channel],
  channelWeights: { [channel]: 1 },
  primaryArtist: artist,
  artistKeys: [artist.toLowerCase()],
  albumKey: `album:${key}`,
  sourcePlaylistId: `playlist:${key}`,
  groupIds: [],
  exposureCount: 0,
  weight: 1,
  ...extra,
})

test('channel quota defaults to 9/5/4/2 per 20 and redistributes missing channels', () => {
  const full = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 })
  assert.deepEqual(full.quotas, { A: 9, B: 5, C: 4, D: 2 })
  assert.equal(full.total, 20)

  const cold = planChannelQuotas(20, [], { A: 100, B: 0, C: 100, D: 100 }, { coldStart: true })
  assert.equal(cold.quotas.B, 0)
  assert.equal(cold.total, 20)
  assert.equal(cold.quotas.A + cold.quotas.C + cold.quotas.D, 20)
  assert.equal(cold.reasons.B, 'cold_start')

  const scarce = planChannelQuotas(10, [], { A: 1, B: 0, C: 1, D: 1 }, { coldStart: true })
  assert.ok(scarce.total <= 3)
  assert.equal(scarce.quotas.A <= 1, true)
})

test('explore mode moves the window quota to low-exposure and chart channels', () => {
  const radio = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 })
  const explore = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { mode: 'explore' })
  assert.deepEqual(explore.quotas, { A: 3, B: 1, C: 9, D: 7 })
  assert.equal(explore.total, 20)
  assert.ok(explore.quotas.C + explore.quotas.D > radio.quotas.C + radio.quotas.D)
})

test('cold start spends the whole window on charts and low-exposure playlists', () => {
  const plan = planChannelQuotas(20, [], { A: 0, B: 0, C: 100, D: 100 }, { coldStart: true })
  assert.equal(plan.total, 20)
  assert.equal(plan.quotas.C + plan.quotas.D, 20)
  assert.ok(plan.quotas.C >= plan.quotas.D, `C should lead the cold start, got ${JSON.stringify(plan.quotas)}`)
})

test('final selection matches configured channel ratios when candidates are sufficient', () => {
  const candidates: FinalQueueItem[] = []
  for (const channel of ['A', 'B', 'C', 'D'] as const) {
    for (let i = 0; i < 30; i++) {
      candidates.push(mkFinalItem(`${channel}${i}`, `artist-${channel}-${i}`, channel, {
        sourcePlaylistId: `pl-${channel}-${i}`,
      }))
    }
  }
  const plan = planChannelQuotas(20, [], { A: 30, B: 30, C: 30, D: 30 })
  const result = selectFinalQueue(candidates, { target: 20, channelPlan: plan, rng: seedRandom(7) })
  assert.equal(result.items.length, 20)
  assert.deepEqual(result.pickedByChannel, { A: 9, B: 5, C: 4, D: 2 })
})

test('final selection enforces artist gap and per-artist caps when alternatives exist', () => {
  const candidates: FinalQueueItem[] = []
  for (let i = 0; i < 24; i++) candidates.push(mkFinalItem(`same-${i}`, 'Dominant', 'A', { sourcePlaylistId: `same-pl-${i}` }))
  for (let i = 0; i < 24; i++) candidates.push(mkFinalItem(`other-${i}`, `Other-${i}`, 'A', { sourcePlaylistId: `other-pl-${i}` }))
  const plan = planChannelQuotas(20, [], { A: 48, B: 0, C: 0, D: 0 })
  const result = selectFinalQueue(candidates, { target: 20, channelPlan: plan, rng: seedRandom(3) })
  const dominant = result.items.filter(entry => entry.item.primaryArtist == 'Dominant').length
  assert.ok(dominant <= 3, `dominant artist should be capped, got ${dominant}`)
  const history = result.items.map(entry => entry.item)
  for (let i = 0; i < history.length; i++) {
    if (!history[i].artistKeys.includes('dominant')) continue
    const window = history.slice(Math.max(0, i - 7), i)
    assert.ok(!window.some(item => item.artistKeys.includes('dominant')), 'artist must not appear in the last 8 tracks')
  }
})

test('selection relaxes constraints when only one artist is available instead of faking diversity', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => mkFinalItem(`only-${i}`, 'Only Artist', 'A', { sourcePlaylistId: `only-pl-${i}` }))
  const plan = planChannelQuotas(5, [], { A: 10, B: 0, C: 0, D: 0 }, { coldStart: true })
  const result = selectFinalQueue(candidates, { target: 5, channelPlan: plan, rng: seedRandom(1) })
  assert.equal(result.items.length, 5)
  assert.ok(result.reasons.some(reason => reason.startsWith('relax_level_')), `expected relaxation reason, got ${result.reasons.join(',')}`)
})

test('same playlist never fills the recent window without relaxation evidence', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => mkFinalItem(`pl-${i}`, `artist-${i}`, 'A', {
    sourcePlaylistId: 'one-playlist',
  }))
  const plan = planChannelQuotas(10, [], { A: 20, B: 0, C: 0, D: 0 }, { coldStart: true })
  const result = selectFinalQueue(candidates, { target: 10, channelPlan: plan, rng: seedRandom(2) })
  const fromPlaylist = result.items.filter(entry => entry.item.sourcePlaylistId == 'one-playlist').length
  assert.ok(fromPlaylist <= recommendationConfig.antiRepeat.relaxSamePlaylistInLast20, `one playlist should be capped, got ${fromPlaylist}`)
})

test('an explicit like downweights nothing and cannot turn into a playlist loop', () => {
  const previous = { timestamp: 1, trackReward: 0, playlistPositive: 0, playlistNegative: 0 }
  const like = settleExplicitFeedback({ type: 'like', trackKey: 'k', timestamp: 2, sourcePlaylistId: 'p1' }, previous)
  assert.equal(like.playlist?.positiveDelta, recommendationConfig.playlistFeedback.like)
  const again = settleExplicitFeedback({ type: 'like', trackKey: 'k', timestamp: 3, sourcePlaylistId: 'p1' }, like.ledgerEntry)
  assert.equal(again.playlist?.positiveDelta ?? 0, 0, 'duplicate like must not stack')
  assert.equal(again.track?.scoreDelta ?? 0, 0)
})

test('one dislike does not ban the playlist or artist', () => {
  const result = settleExplicitFeedback({ type: 'dislike', trackKey: 'bad-song', timestamp: 1, sourcePlaylistId: 'p1' })
  assert.equal(result.excludeTrackKey, 'bad-song')
  assert.equal(result.playlist?.negativeDelta, recommendationConfig.playlistFeedback.dislike)
  assert.ok((result.playlist?.positiveDelta ?? 0) <= 0)
  assert.equal(result.playlist == null ? false : !('ban' in result.playlist), true)
})

const mkRecord = (overrides: Record<string, unknown> = {}) => ({
  playId: 'play-1',
  trackKey: 'track-1',
  sourcePlaylistId: 'p1',
  startedAt: 0,
  endedAt: 100000,
  intervals: [{ from: 0, to: 180000 }],
  listenedMs: 180000,
  wallClockMs: 180000,
  durationMs: 200000,
  coverage: 0.9,
  endReason: 'natural_end' as const,
  settled: false,
  ...overrides,
})

test('coverage merges intervals, ignores repeats and detects seek-to-end', () => {
  assert.deepEqual(mergeIntervals([{ from: 0, to: 1000 }, { from: 500, to: 1500 }, { from: 3000, to: 4000 }]), [
    { from: 0, to: 1500 },
    { from: 3000, to: 4000 },
  ])
  const seeked = computeEffectiveCoverage(mkRecord({ intervals: [{ from: 0, to: 5000 }], listenedMs: 5000, seekedToEnd: true }) as any)
  assert.ok(seeked < 0.1, `seeked-to-end coverage should stay low, got ${seeked}`)
  const natural = computeEffectiveCoverage(mkRecord({ intervals: [], listenedMs: 0, seekedToEnd: false }) as any)
  assert.equal(natural, 1, 'natural end without seek should reconcile screen-off listening')
})

test('full natural listen applies positive feedback, early skip applies limited negative feedback', () => {
  const complete = settlePlayRecord(mkRecord() as any)
  assert.equal(complete.track?.completeCountDelta, 1)
  assert.equal(complete.playlist?.positiveDelta, recommendationConfig.playlistFeedback.listenOver80)
  assert.equal(complete.ledgerEntry.completion, true)

  const early = settlePlayRecord(mkRecord({
    intervals: [{ from: 0, to: 5000 }],
    listenedMs: 5000,
    wallClockMs: 5000,
    endReason: 'user_next',
  }) as any)
  assert.equal(early.playlist?.negativeDelta, recommendationConfig.playlistFeedback.earlySkip)
  assert.equal(early.track?.earlySkipCountDelta, 1)

  const partial = settlePlayRecord(mkRecord({
    intervals: [{ from: 0, to: 45000 }],
    listenedMs: 45000,
    endReason: 'user_next',
  }) as any)
  assert.equal(partial.playlist, undefined)
  assert.equal(partial.track, undefined)
  assert.ok(partial.reasons.includes('partial_skip_neutral'))
})

test('a short share of a long song counts as early skip even past the 10s floor', () => {
  const result = settlePlayRecord(mkRecord({
    intervals: [{ from: 0, to: 25000 }],
    listenedMs: 25000,
    wallClockMs: 25000,
    endReason: 'user_next',
  }) as any)
  assert.equal(result.track?.earlySkipCountDelta, 1)
  assert.equal(result.ledgerEntry.trackReward, -Math.abs(recommendationConfig.behavior.earlySkip))
  assert.equal(result.playlist?.negativeDelta, recommendationConfig.playlistFeedback.earlySkip)
})

test('play errors, buffering/pauses and unknown short duration are neutral negative', () => {
  for (const reason of ['play_error', 'load_error', 'app_destroy'] as const) {
    const result = settlePlayRecord(mkRecord({ endReason: reason, intervals: [] }) as any)
    assert.equal(result.track, undefined)
    assert.equal(result.playlist, undefined)
  }
  const short = settlePlayRecord(mkRecord({ durationMs: 20000, intervals: [{ from: 0, to: 3000 }], listenedMs: 3000, endReason: 'user_next' }) as any)
  assert.equal(short.track, undefined)
  assert.equal(short.playlist, undefined)
  assert.ok(short.reasons.includes('skip_low_confidence_duration'))
})

test('seek to end is not treated as a complete listen', () => {
  const result = settlePlayRecord(mkRecord({
    intervals: [{ from: 0, to: 2000 }, { from: 195000, to: 198000 }],
    listenedMs: 5000,
    seekedToEnd: true,
  }) as any)
  assert.equal(result.track, undefined)
  assert.ok(result.reasons.includes('seek_to_end_not_complete'))
})

test('explicit like after natural completion complements instead of double counting', () => {
  const complete = settlePlayRecord(mkRecord() as any)
  const like = settleExplicitFeedback({ type: 'like', trackKey: 'track-1', timestamp: 2, sourcePlaylistId: 'p1' }, complete.ledgerEntry)
  assert.equal(like.track?.scoreDelta, Math.max(0, recommendationConfig.behavior.like - complete.ledgerEntry.trackReward))
  assert.equal(like.playlist?.positiveDelta, Math.max(0, recommendationConfig.playlistFeedback.like - complete.ledgerEntry.playlistPositive))
  const duplicateEnd = settlePlayRecord(mkRecord() as any)
  assert.equal(duplicateEnd.ledgerEntry.trackReward, complete.ledgerEntry.trackReward, 'pure settlement is deterministic; runtime ledger should dedupe')
})

test('explicit add-to-playlist suppresses later implicit completion settlement', () => {
  const added = settleExplicitFeedback({ type: 'add_to_playlist', trackKey: 'k', timestamp: 1, sourcePlaylistId: 'p1' })
  assert.equal(added.ledgerEntry.explicitAdd, true)
  assert.equal(shouldSuppressImplicitSettlement(added.ledgerEntry), true)
  const complete = settlePlayRecord(mkRecord({ trackKey: 'k' }) as any)
  assert.equal(shouldSuppressImplicitSettlement(complete.ledgerEntry), true)
})

test('unlike withdraws positive signal but never becomes dislike', () => {
  const like = settleExplicitFeedback({ type: 'like', trackKey: 'k', timestamp: 1, sourcePlaylistId: 'p1' })
  const unlike = settleExplicitFeedback({ type: 'unlike', trackKey: 'k', timestamp: 2, sourcePlaylistId: 'p1' }, like.ledgerEntry)
  assert.ok((unlike.track?.scoreDelta ?? 0) < 0)
  assert.ok((unlike.playlist?.negativeDelta ?? 0) <= 0)
  assert.equal(unlike.ledgerEntry.explicitNegative, undefined)
})

test('playback tracker excludes pause, buffering and seeked ranges, and dedupes repeated intervals', () => {
  const tracker = createPlaybackTracker({ playId: 'p', trackKey: 'k', durationMs: 120000 })
  observePlaybackSample(tracker, { positionMs: 0, playing: true, now: 0, playbackRate: 1 })
  observePlaybackSample(tracker, { positionMs: 1000, playing: true, now: 1000, playbackRate: 1 })
  observePlaybackSample(tracker, { positionMs: 1000, playing: false, now: 5000, playbackRate: 1 }) // pause: no progress
  observePlaybackSample(tracker, { positionMs: 60000, playing: true, now: 6000, playbackRate: 1 }) // seek: skipped range not counted
  observePlaybackSample(tracker, { positionMs: 61000, playing: true, now: 7000, playbackRate: 1 })
  observePlaybackSample(tracker, { positionMs: 0, playing: true, now: 8000, playbackRate: 1 }) // repeat
  observePlaybackSample(tracker, { positionMs: 1000, playing: true, now: 9000, playbackRate: 1 })
  const record = finishPlaybackTracker(tracker, { endReason: 'user_next', now: 10000, positionMs: 1000 })
  assert.equal(record.listenedMs, 2000, 'only continuous 0-1000 and 60000-61000 count once')
  assert.equal(record.coverage, 2000 / 120000)
  assert.ok(record.wallClockMs < 5000, 'pause/buffer wall time is not counted as listening wall time')
})

test('playback tracker handles 2x rate and natural end reconciliation', () => {
  const tracker = createPlaybackTracker({ playId: 'p2', trackKey: 'k2', durationMs: 100000 })
  observePlaybackSample(tracker, { positionMs: 0, playing: true, now: 0, playbackRate: 2 })
  observePlaybackSample(tracker, { positionMs: 2000, playing: true, now: 1000, playbackRate: 2 })
  const speedRecord = finishPlaybackTracker(tracker, { endReason: 'user_next', now: 1100, positionMs: 2200, playbackRate: 2 })
  assert.equal(speedRecord.listenedMs, 2200)

  const background = createPlaybackTracker({ playId: 'p3', trackKey: 'k3', durationMs: 180000 })
  observePlaybackSample(background, { positionMs: 0, playing: true, now: 0 })
  const backgroundRecord = finishPlaybackTracker(background, { endReason: 'natural_end', now: 180000, positionMs: 180000 })
  assert.equal(backgroundRecord.seekedToEnd, false)
  assert.equal(computeEffectiveCoverage(backgroundRecord), 1)
})

test('notePlaybackSeek marks seek-to-end but records the target position safely', () => {
  const tracker = createPlaybackTracker({ playId: 'p4', trackKey: 'k4', durationMs: 100000 })
  observePlaybackSample(tracker, { positionMs: 0, playing: true, now: 0 })
  notePlaybackSeek(tracker, 95000, 1000)
  assert.equal(tracker.seekedToEnd, true)
  assert.equal(tracker.lastPositionMs, 95000)
})

const mkPref = (overrides: Record<string, unknown> = {}) => ({
  trackKey: 'k',
  score: 0,
  playCount: 0,
  completeCount: 0,
  skipCount: 0,
  earlySkipCount: 0,
  likeCount: 0,
  dislikeCount: 0,
  repeatCount: 0,
  addToPlaylistCount: 0,
  averageListenRatio: 0,
  exposureCount: 0,
  lastPlayTime: 0,
  ...overrides,
}) as any

const emptySession = () => ({
  recentTracks: [],
  recentChannels: [],
}) as any

test('profile extracts at most 30 seeds with at most 3 per artist and keeps different playlists', () => {
  const loveTracks = Array.from({ length: 100 }, (_, i) => mkMusic(`love${i}`, `love-song-${i}`, `Big Artist ${i % 10}`))
  const playlistTracks = Array.from({ length: 6 }, (_, i) => mkMusic(`pl${i}`, `pl-song-${i}`, `Small Artist ${i}`))
  const profile = buildRadioProfile({
    loveTracks,
    playlists: [{ id: 'small', name: 'small', tracks: playlistTracks }],
    trackPrefs: {},
    session: emptySession(),
    now: 1,
  })
  // 方向限额生效：love 大方向被截到 maxSeedsPerDirection，小歌单全额保留
  assert.equal(profile.seeds.length, recommendationConfig.profile.maxSeedsPerDirection + playlistTracks.length)
  const loveSeedCount = profile.seeds.filter(seed => seed.directionId == 'love').length
  assert.equal(loveSeedCount, recommendationConfig.profile.maxSeedsPerDirection)
  const bigArtistSeeds = profile.seeds.filter(seed => seed.primaryArtist.startsWith('Big Artist'))
  const bigArtistCounts: Record<string, number> = {}
  for (const seed of bigArtistSeeds) bigArtistCounts[seed.primaryArtist] = (bigArtistCounts[seed.primaryArtist] ?? 0) + 1
  for (const count of Object.values(bigArtistCounts)) assert.ok(count <= recommendationConfig.profile.maxSeedsPerArtist, `big artist seeds ${count}`)
  const smallArtistSeeds = profile.seeds.filter(seed => seed.primaryArtist.startsWith('Small Artist')).length
  assert.ok(smallArtistSeeds >= 3, `small playlist should not be drowned, got ${smallArtistSeeds}`)
})

test('profile ordering follows active like > add-to-playlist > passive completion and mixes session 70/30', () => {
  const now = 1000000
  const liked = mkMusic('liked', 'liked song', 'Artist A')
  const added = mkMusic('added', 'added song', 'Artist B')
  const passive = mkMusic('passive', 'passive song', 'Artist C')
  const profile = buildRadioProfile({
    loveTracks: [],
    playlists: [],
    trackPrefs: {
      [buildTrackKey(liked)]: mkPref({ trackKey: buildTrackKey(liked), likeCount: 1, lastPositiveTime: now - 1000 }),
      [buildTrackKey(added)]: mkPref({ trackKey: buildTrackKey(added), addToPlaylistCount: 1, lastPlayTime: now - 1000 }),
      [buildTrackKey(passive)]: mkPref({ trackKey: buildTrackKey(passive), completeCount: 1, lastPlayTime: now - 1000 }),
    },
    history: [
      { musicInfo: liked, playTime: now },
      { musicInfo: added, playTime: now },
      { musicInfo: passive, playTime: now },
    ],
    session: { ...emptySession(), recentTracks: [{ trackKey: buildTrackKey(liked), timestamp: now, liked: true, listenRatio: 1 }] },
    now,
  })
  const likedSeed = profile.seeds.find(seed => seed.trackKey == buildTrackKey(liked))
  const addedSeed = profile.seeds.find(seed => seed.trackKey == buildTrackKey(added))
  const passiveSeed = profile.seeds.find(seed => seed.trackKey == buildTrackKey(passive))
  assert.ok(likedSeed && addedSeed && passiveSeed)
  assert.ok(likedSeed!.score > addedSeed!.score)
  assert.ok(addedSeed!.score > passiveSeed!.score)
  assert.ok(Math.abs(likedSeed!.score - (0.7 * likedSeed!.longTermScore + 0.3 * likedSeed!.sessionScore)) < 1e-9)
})

test('a session play warms up the whole local playlist it came from', () => {
  const now = 1000000
  const warm = mkMusic('warm', 'warm song', 'Artist W')
  const warmSibling = mkMusic('warm2', 'warm song two', 'Artist W2')
  const cold = mkMusic('cold', 'cold song', 'Artist C')
  const pref = (musicInfo) => mkPref({
    trackKey: buildTrackKey(musicInfo),
    playCount: 1,
    lastPlayTime: now - 1000,
  })
  const profile = buildRadioProfile({
    loveTracks: [],
    playlists: [
      { id: 'warm-list', name: 'warm list', tracks: [warm, warmSibling] },
      { id: 'cold-list', name: 'cold list', tracks: [cold] },
    ],
    trackPrefs: {
      [buildTrackKey(warm)]: pref(warm),
      [buildTrackKey(warmSibling)]: pref(warmSibling),
      [buildTrackKey(cold)]: pref(cold),
    },
    session: { ...emptySession(), recentTracks: [{ trackKey: buildTrackKey(warm), timestamp: now, listenRatio: 1 }] },
    now,
  })
  const played = profile.seeds.find(seed => seed.trackKey == buildTrackKey(warm))
  const sibling = profile.seeds.find(seed => seed.trackKey == buildTrackKey(warmSibling))
  const outsider = profile.seeds.find(seed => seed.trackKey == buildTrackKey(cold))
  assert.ok(played && sibling && outsider)
  assert.ok(sibling!.sessionScore > outsider!.sessionScore + 0.05,
    `direction should warm sibling (${sibling!.sessionScore}) above other list (${outsider!.sessionScore})`)
})

test('profile directions follow the love > playlist > recent-listen evidence priors', () => {
  const now = 20 * 86400000
  const loved = mkMusic('l', 'loved song', 'Artist L')
  const listed = mkMusic('p', 'list song', 'Artist P')
  const heard = mkMusic('h', 'heard song', 'Artist H')
  const input = heardLastPlayTime => buildRadioProfile({
    loveTracks: [loved],
    playlists: [{ id: 'mine', name: 'mine', tracks: [listed] }],
    trackPrefs: {
      [buildTrackKey(loved)]: mkPref({ trackKey: buildTrackKey(loved), likeCount: 1 }),
      [buildTrackKey(listed)]: mkPref({ trackKey: buildTrackKey(listed), likeCount: 1 }),
      [buildTrackKey(heard)]: mkPref({ trackKey: buildTrackKey(heard), likeCount: 1, lastPlayTime: heardLastPlayTime }),
    },
    history: [{ musicInfo: heard, playTime: heardLastPlayTime }],
    session: emptySession(),
    now,
  })
  const weightOf = (profile, kind) => profile.directions.find(direction => direction.kind == kind)!.weight
  const fresh = input(now)
  const love = weightOf(fresh, 'love')
  assert.ok(Math.abs(weightOf(fresh, 'playlist') / love - 0.8) < 1e-9)
  assert.ok(Math.abs(weightOf(fresh, 'track') / love - 0.6) < 1e-9)
  const stale = input(now - 14 * 86400000)
  assert.ok(Math.abs(weightOf(stale, 'track') / weightOf(stale, 'love') - 0.3) < 1e-9,
    'a recent-listen direction one half-life old should carry half the prior')
})

test('bulk importing a large playlist does not become thousands of likes', () => {
  const big = Array.from({ length: 3000 }, (_, i) => mkMusic(`b${i}`, `song-${i}`, `Artist ${i % 20}`))
  const profile = buildRadioProfile({
    loveTracks: big,
    playlists: [],
    trackPrefs: {},
    session: emptySession(),
    now: 1,
  })
  // 单一 love 方向受方向限额约束：seed 有界，批量导入不再撑满全局上限
  assert.equal(profile.seeds.length, recommendationConfig.profile.maxSeedsPerDirection)
  const counts: Record<string, number> = {}
  for (const seed of profile.seeds) counts[seed.primaryArtist] = (counts[seed.primaryArtist] ?? 0) + 1
  for (const count of Object.values(counts)) assert.ok(count <= recommendationConfig.profile.maxSeedsPerArtist)
})

test('discovery keywords lead with strong artists, then playlist names by weight', () => {
  const profile = {
    directions: [
      { directionId: 'love', kind: 'love', name: 'love', tracks: [], weight: 0.5 },
      { directionId: 'playlist:sad', kind: 'playlist', name: '伤心城市', tracks: [], weight: 0.2 },
      { directionId: 'playlist:edm', kind: 'playlist', name: 'Vicetone精选', tracks: [], weight: 0.3 },
    ],
    seeds: [{
      trackKey: 'kw|t|a',
      musicInfo: mkMusic('s1', 'random seed song', 'Nobody Famous'),
      primaryArtist: 'nobody famous',
      artistKeys: ['nobody famous'],
      score: 1, longTermScore: 1, sessionScore: 0.5, directionId: 'love',
      fromLike: true, fromAddToPlaylist: false, fromPassiveComplete: false,
    }],
    seedKeys: new Set(['kw|t|a']),
    topArtists: [
      { artist: 'vicetone', weight: 0.47 },
      { artist: 'weak artist', weight: 0.01 },
    ],
    updatedAt: 1,
  } as any
  const keywords = buildPlaylistKeywords(profile, 8)
  assert.equal(keywords[0], 'vicetone', 'the dominant profile artist must lead discovery')
  assert.ok(!keywords.includes('我喜欢'), 'no literal label keywords that match nothing')
  assert.ok(!keywords.includes('weak artist'), 'artists below the strong ratio must not crowd the pool')
  assert.ok(keywords.indexOf('vicetone精选') < keywords.indexOf('伤心城市'), 'playlist names follow direction weight')
})

test('playlist observation tracks coverage, weak themes and confirmed seed overlap', () => {
  const observed = upsertObservedPlaylist(undefined, {
    id: 'p1',
    source: 'kw',
    name: '夜晚爵士',
    desc: 'jazz night',
    tracks: ['a', 'b', 'c'],
    totalTracks: 30,
    pagesFetched: 1,
    seedTrackKeys: ['a'],
    seedOverlap: 2,
    weakThemeScore: computeWeakThemeScore({ name: '夜晚爵士', desc: 'jazz night' }, ['爵士']),
  }, 100)
  assert.equal(observed.confirmed, true)
  assert.equal(observed.coverage, 0.1)
  assert.ok(observed.confidence > 0 && observed.confidence <= 0.1)
  assert.ok(observed.weakThemeScore > 0)
})

test('co-occurrence is normalized by observed playlist size and dampens popular tracks', () => {
  const small = upsertObservedPlaylist(undefined, {
    id: 'small', source: 'kw', tracks: Array.from({ length: 10 }, (_, i) => `t${i}`),
    totalTracks: 10, pagesFetched: 1, seedTrackKeys: ['seed'], seedOverlap: 1,
  }, 1)
  const large = upsertObservedPlaylist(undefined, {
    id: 'large', source: 'kw', tracks: Array.from({ length: 1000 }, (_, i) => `big${i}`),
    totalTracks: 1000, pagesFetched: 1, seedTrackKeys: ['seed'], seedOverlap: 1,
  }, 1)
  const indexSmall = buildTrackPlaylistIndex([small])
  const indexLarge = buildTrackPlaylistIndex([large])
  const smallScore = computeCandidateCoOccurrence('t1', { seedTrackKeys: new Set(['seed']), observedPlaylists: [small], index: indexSmall })
  const largeScore = computeCandidateCoOccurrence('big1', { seedTrackKeys: new Set(['seed']), observedPlaylists: [large], index: indexLarge })
  assert.ok(smallScore > largeScore, `small playlist must not be dominated by huge sampled playlist (${smallScore} <= ${largeScore})`)

  const many = Array.from({ length: 10 }, (_, i) => upsertObservedPlaylist(undefined, {
    id: `m${i}`, source: 'kw', tracks: ['hot', `x${i}`], totalTracks: 2, pagesFetched: 1,
    seedTrackKeys: ['seed'], seedOverlap: 1,
  }, 1))
  const indexMany = buildTrackPlaylistIndex(many)
  const hotScore = computeCandidateCoOccurrence('hot', { seedTrackKeys: new Set(['seed']), observedPlaylists: many, index: indexMany })
  const oneScore = computeCandidateCoOccurrence('x0', { seedTrackKeys: new Set(['seed']), observedPlaylists: [many[0]], index: buildTrackPlaylistIndex([many[0]]) })
  assert.ok(hotScore <= oneScore * recommendationConfig.similarity.maxMultiPlaylistBoost + 1e-9)
})

test('playlist score follows configured 0.5/0.3/0.2 formula and feedback quality starts at 0.5', () => {
  assert.equal(computeFeedbackQuality(0, 0), 0.5)
  assert.ok(computeFeedbackQuality(2, 0) > computeFeedbackQuality(0, 1))
  const score = computePlaylistScore(0.5, 0, 0, 0)
  assert.ok(Math.abs(score.parts.feedback - 0.5) < 1e-9)
  assert.ok(Math.abs(score.score - (0.5 * 0.5 + 0.3 * 0.5 + 0.2 * 1)) < 1e-9)
})

test('similar playlists are grouped by overlap with confidence weighting', () => {
  const tracks = ['a', 'b', 'c', 'd']
  const p1 = upsertObservedPlaylist(undefined, { id: 'g1', source: 'kw', tracks, totalTracks: 4, pagesFetched: 1, seedTrackKeys: ['a'], seedOverlap: 1 }, 1)
  const p2 = upsertObservedPlaylist(undefined, { id: 'g2', source: 'kw', tracks: ['a', 'b', 'c', 'e'], totalTracks: 4, pagesFetched: 1, seedTrackKeys: ['b'], seedOverlap: 1 }, 1)
  const p3 = upsertObservedPlaylist(undefined, { id: 'g3', source: 'kw', tracks: ['x', 'y', 'z', 'w'], totalTracks: 4, pagesFetched: 1 }, 1)
  assert.ok(computePlaylistSimilarity(p1.fetchedTracks, p2.fetchedTracks) >= 0.5)
  const groups = groupSimilarPlaylists([p1, p2, p3])
  assert.equal(groups.g1, groups.g2)
  assert.notEqual(groups.g1, groups.g3)
})

const mkPoolCandidate = (key: string, channel: 'A' | 'B' | 'C' | 'D', extra: Partial<PoolCandidate> = {}): PoolCandidate => createPoolCandidate({
  musicInfo: mkMusic(key, `song-${key}`, `artist-${key}`, 'kw'),
  channel,
  sourceId: `${channel}-source`,
  channels: [channel],
  playlistIds: [`pl-${key}`],
  affinity: 0.6,
  coOccurrence: 0.4,
  exploration: 0.5,
  ...extra,
})

test('candidate merge dedupes by identity and merges channels without unbounded stacking', () => {
  const first = mkPoolCandidate('dup', 'A')
  const second = mkPoolCandidate('dup', 'B', { affinity: 0.9, playlistIds: ['pl-b'] })
  const merged = mergePoolCandidates([first], [second], 100)
  assert.equal(merged.length, 1)
  assert.deepEqual([...merged[0].channels].sort(), ['A', 'B'])
  assert.equal(merged[0].affinity, 0.9)
  assert.equal(merged[0].localFrequency, 2)
  assert.ok(merged[0].playlistIds.includes('pl-dup') && merged[0].playlistIds.includes('pl-b'))
})

test('pool cap keeps bounded external candidates', () => {
  const candidates = Array.from({ length: 20 }, (_, i) => mkPoolCandidate(`cap-${i}`, 'A'))
  const merged = mergePoolCandidates([], candidates, 10)
  assert.equal(merged.length, 10)
})

test('local queue is version guarded and never inserts the same track twice', () => {
  const queue = createRadioQueue()
  const version = queue.getVersion()
  const item = (id: string) => ({
    musicInfo: mkMusic(id, `name-${id}`, `singer-${id}`, 'kw'),
    source: 'related' as const,
    channel: 'A' as const,
    batchId: 1,
  })
  assert.equal(queue.enqueue([item('a'), item('a'), item('b')], version), true)
  assert.equal(queue.size(), 2)
  queue.invalidate()
  assert.equal(queue.enqueue([item('c')], version), false, 'stale version must be discarded')
  assert.equal(queue.size(), 0)
  assert.equal(queue.enqueue([item('c')], queue.getVersion()), true)
  assert.equal(queue.size(), 1)
})

test('request retry policy respects retry count, backoff and timeout', async () => {
  const policy = { timeoutMs: 50, retryCount: 2, backoffBaseMs: 10, backoffMaxMs: 40 }
  assert.equal(computeBackoffMs(0, policy, () => 0), 10)
  assert.equal(computeBackoffMs(10, policy, () => 0), 40)
  let calls = 0
  const value = await runWithRetry(async() => {
    calls += 1
    if (calls < 3) throw new Error('network fail')
    return 'ok'
  }, { policy, sleep: async() => {}, random: () => 0 })
  assert.equal(value, 'ok')
  assert.equal(calls, 3)

  await assert.rejects(
    () => withTimeout(new Promise(() => {}), 10),
    /request_timeout/,
  )
})

test('offline/no-network degradation uses cached external candidates and never falls back to library', async () => {
  const cached = [mkPoolCandidate('cached-1', 'A'), mkPoolCandidate('cached-2', 'C')]
  const plan = planChannelQuotas(2, [], { A: 1, B: 0, C: 1, D: 0 }, { coldStart: true })
  const finalItems = buildFinalQueueItems(cached, { exposureCounts: {} })
  const result = selectFinalQueue(finalItems, { target: 2, channelPlan: plan, rng: seedRandom(5) })
  assert.equal(result.items.length, 2)
  const keys = result.items.map(entry => entry.item.key).sort()
  assert.deepEqual(keys, [buildTrackKey(mkMusic('cached-1', 'song-cached-1', 'artist-cached-1')), buildTrackKey(mkMusic('cached-2', 'song-cached-2', 'artist-cached-2'))].sort())
})

test('playlist fallback records reasons without fabricating candidates', () => {
  const plan = planChannelQuotas(10, [], { A: 0, B: 0, C: 0, D: 0 }, { coldStart: true })
  assert.equal(plan.total, 0)
  assert.equal(plan.reasons.A, 'no_candidate')
  assert.equal(plan.reasons.B, 'cold_start')
  assert.equal(plan.reasons.C, 'no_candidate')
  assert.equal(plan.reasons.D, 'no_candidate')
  const result = selectFinalQueue([], { target: 10, channelPlan: plan, rng: seedRandom(1) })
  assert.equal(result.items.length, 0)
  assert.ok(result.reasons.includes('no_candidate_after_relaxation'))
})

test('playlist score sampling and exposure preference is exposed through final item weights', () => {
  const fresh = mkPoolCandidate('fresh', 'C', { exploration: 1, exposureCount: 0 })
  const exposed = mkPoolCandidate('exposed', 'C', { exploration: 1, exposureCount: 5 })
  const items = buildFinalQueueItems([fresh, exposed], { exposureCounts: { [fresh.trackKey]: 0, [exposed.trackKey]: 5 } })
  const freshItem = items.find(item => item.key == fresh.trackKey)!
  const exposedItem = items.find(item => item.key == exposed.trackKey)!
  assert.ok((freshItem.channelWeights?.C ?? 0) > (exposedItem.channelWeights?.C ?? 0))
})

test('legacy v1 state migrates without losing learning data and restart defaults are safe', () => {
  const migrated = migrateRecommendationState({
    version: 1,
    tracks: { old: { trackKey: 'old', score: 3, playCount: 2, completeCount: 1 } },
    playlists: { p1: { playlistId: 'p1', positiveCount: 3, negativeCount: 1, exposureCount: 5, lastUsedTime: 1 } },
    dislikedTracks: { bad: 123 },
    recentlyPlayed: [{ trackKey: 'old', timestamp: 1 }],
  } as any)
  assert.equal(migrated.version, 6)
  assert.equal(migrated.tracks.old.score, 3)
  assert.equal(migrated.playlists.p1.positiveWeight, 3)
  assert.equal(migrated.playlists.p1.negativeWeight, 1)
  assert.equal(migrated.dislikedTracks.bad, 123)
  assert.deepEqual(migrated.session.recentChannels, [])
  assert.deepEqual(migrated.radioHistory, [])
  assert.deepEqual(migrated.observedPlaylists, {})
  assert.deepEqual(migrated.candidateCache, [])
  const stalePool = migrateRecommendationState({
    version: 2,
    tracks: { keep: { trackKey: 'keep', score: 1 } },
    candidateCache: [{ trackKey: 'stale' }],
    candidateCacheFetchedAt: 999,
  } as any)
  assert.deepEqual(stalePool.candidateCache, [])
  assert.equal(stalePool.candidateCacheFetchedAt, 0)
  assert.ok(stalePool.tracks.keep, 'dropping the stale pool must keep the learning data')
  const defaults = createDefaultState()
  assert.equal(defaults.version, 6)
  assert.ok(Array.isArray(defaults.radioHistory))
  assert.deepEqual(defaults.tokenWeights, {})
  assert.deepEqual(defaults.channelBandit, {})
  assert.deepEqual(defaults.artistStats, {})
  assert.deepEqual(defaults.audioEmbeddings, {})
  assert.deepEqual(defaults.audioAnalysis, { dayKey: '', dayCount: 0, lastRunAt: 0 })
})
test('duplicate end events for one play settle implicit rewards only once', () => {
  const record = {
    playId: 'play-1',
    trackKey: 't1',
    startedAt: 1000,
    endedAt: 60000,
    intervals: [{ from: 0, to: 5000 }],
    listenedMs: 5000,
    wallClockMs: 5000,
    durationMs: 180000,
    coverage: 5000 / 180000,
    endReason: 'user_next',
  } as any
  const first = settlePlayRecord(record)
  assert.equal(first.ledgerEntry.implicitSettled, true)
  assert.equal(first.ledgerEntry.playlistNegative, recommendationConfig.playlistFeedback.earlySkip)
  assert.equal(shouldApplyImplicitSettlement(first.ledgerEntry), false)
  assert.equal(shouldApplyImplicitSettlement(undefined), true)
  assert.equal(shouldApplyImplicitSettlement({ timestamp: 1, trackReward: 0, playlistPositive: 0, playlistNegative: 0 }), true)
  const likeLedger = settleExplicitFeedback({ playId: 'play-2', trackKey: 't2', type: 'like', timestamp: 5 }).ledgerEntry
  assert.equal(shouldApplyImplicitSettlement(likeLedger), false)
})

test('shortage relaxation loosens soft playlist limits before widening artist gaps', () => {
  const mk = (key: string, artist: string, playlistId?: string): FinalQueueItem => ({
    key,
    channels: ['A'],
    primaryArtist: artist,
    artistKeys: [artist],
    albumKey: `al-${key}`,
    sourcePlaylistId: playlistId,
    weight: 1,
  })
  const recent = [mk('h1', 'H1', 'P'), mk('h2', 'H2', 'P')]
  const candidates = [mk('artist-violator', 'H1', 'Q'), mk('playlist-violator', 'H3', 'P')]
  const plan = { quotas: { A: 2, B: 0, C: 0, D: 0 }, total: 2, reasons: {} } as any
  const result = selectFinalQueue(candidates, { target: 2, recent, channelPlan: plan, rng: () => 0 })
  assert.equal(result.items[0].item.key, 'playlist-violator')
  assert.ok(result.reasons.includes('relax_level_1'))
})

test('favorites mixed into the candidate pool are excluded before final selection', () => {
  const discovery = Array.from({ length: 40 }, (_, i) => mkMusic(`d${i}`, `disc-${i}`, `Singer ${i}`))
  const favorites = Array.from({ length: 10 }, (_, i) => mkMusic(`f${i}`, `fav-${i}`, `Singer f${i}`))
  const pool = [...discovery, ...favorites].map(track => createPoolCandidate({
    musicInfo: track,
    channel: 'A',
    sourceId: 'kw::p1',
  }))
  const libraryKeys = new Set(favorites.map(track => buildTrackKey(track)))
  const ctx = {
    libraryKeys,
    dislikedTrackKeys: new Set<string>(),
    queuedTrackKeys: new Set<string>(),
    sessionTrackKeys: new Set<string>(),
    recentRadioTrackKeys: new Set<string>(),
    blocked: { names: new Set<string>(), musicNames: new Set<string>(), singerNames: new Set<string>() },
  }
  const filtered = filterPoolCandidates(pool, ctx)
  assert.equal(filtered.length, 40)
  const finalItems = buildFinalQueueItems(filtered, { now: 100 })
  assert.equal(finalItems.length, 40)
  const plan = { quotas: { A: 20, B: 0, C: 0, D: 0 }, total: 20, reasons: {} } as any
  const selection = selectFinalQueue(finalItems, { target: 20, channelPlan: plan, rng: seedRandom(11) })
  assert.equal(selection.items.length, 20)
  for (const picked of selection.items) assert.equal(libraryKeys.has(picked.item.key), false)
})

test('alternate versions of a recent work are soft down-weighted but still selectable', () => {
  const mk = (key: string, artist: string, workKey: string): FinalQueueItem => ({
    key,
    channels: ['A'],
    primaryArtist: artist,
    artistKeys: [artist],
    albumKey: `al-${key}`,
    workKey,
    weight: 1,
  })
  const history = [
    mk('orig', 'X', 'work:song__x'),
    ...Array.from({ length: 9 }, (_, i) => mk(`f${i}`, `F${i}`, `work:f${i}__f${i}`)),
  ]
  const candidates = [mk('live', 'X', 'work:song__x'), mk('other', 'Y', 'work:other__y')]
  const plan = { quotas: { A: 1, B: 0, C: 0, D: 0 }, total: 1, reasons: {} } as any
  const rng = seedRandom(7)
  let variantPicked = 0
  for (let i = 0; i < 200; i++) {
    const result = selectFinalQueue(candidates, { target: 1, recent: history, channelPlan: plan, rng })
    if (result.items[0]?.item.key == 'live') variantPicked += 1
  }
  assert.ok(variantPicked > 0, 'variant stays selectable (soft, not hard exclusion)')
  assert.ok(variantPicked < 80, `variant should be down-weighted below unpenalized share, got ${variantPicked}/200`)
})

test('refresh budget splits discovery and detail reads so neither starves', () => {
  const cfg = recommendationConfig
  const plan = planRefreshBudget(cfg.request.maxRequestsPerRefresh, cfg.candidatePool.detailFetchesPerRefresh)
  assert.equal(plan.detailBudget, cfg.candidatePool.detailFetchesPerRefresh)
  // 发现阶段要容纳 4 次种子搜索 + 标签/歌单页 2 次 + 榜单 2 次，否则冷启动的 C/D 通道拿不到候选
  assert.ok(plan.discoveryBudget >= 8, `discovery budget too small: ${plan.discoveryBudget}`)
  assert.equal(plan.detailBudget + plan.discoveryBudget, cfg.request.maxRequestsPerRefresh)
  assert.deepEqual(planRefreshBudget(4, 4), { detailBudget: 2, discoveryBudget: 2 })
  assert.deepEqual(planRefreshBudget(1, 4), { detailBudget: 1, discoveryBudget: 0 })
})

test('theme feedback amplifies dislikes stronger than likes', () => {
  const cfg = recommendationConfig.themeFeedback
  assert.ok(cfg.negativeFactor > cfg.positiveFactor, 'dislike must outweigh like')
  const themes: Record<string, any> = {}
  const now = 1_000_000
  applyThemeFeedback(themes, '电子', 1, 0, now)
  assert.equal(themes['电子'].positiveWeight, cfg.positiveFactor)
  assert.equal(themeNetWeight(themes, '电子', now), cfg.positiveFactor)
  applyThemeFeedback(themes, '电子', 0, 1, now + 30_000)
  // 30 秒 < 1 分钟衰减阈值：上一步的权重应原样保留
  assert.equal(themes['电子'].positiveWeight, cfg.positiveFactor)
  assert.equal(themes['电子'].negativeWeight, cfg.negativeFactor)
  assert.ok(themeNetWeight(themes, '电子', now + 30_000) < 0, 'one dislike must flip category net negative')
  assert.equal(themeNetWeight(themes, undefined, now), 0)
  assert.equal(themeNetWeight(themes, '未知分类', now), 0)
})

test('theme weights decay with half-life', () => {
  const themes: Record<string, any> = {}
  const now = 1_700_000_000_000
  const halfLife = recommendationConfig.themeFeedback.halfLifeDays * 86_400_000
  applyThemeFeedback(themes, '民谣', 2, 0, now)
  const afterOneHalfLife = themeNetWeight(themes, '民谣', now + halfLife)
  assert.ok(Math.abs(afterOneHalfLife - recommendationConfig.themeFeedback.positiveFactor * 2 / 2) < 1e-6, `expected halved weight, got ${afterOneHalfLife}`)
  const decayed = themeNetWeight(themes, '民谣', now + halfLife * 2)
  assert.ok(Math.abs(decayed - recommendationConfig.themeFeedback.positiveFactor * 2 / 4) < 1e-6)
})

test('theme affinity factor boosts liked and crushes disliked categories', () => {
  const cfg = recommendationConfig.themeFeedback
  assert.equal(themeAffinityFactor(0), 1)
  assert.ok(Math.abs(themeAffinityFactor(cfg.saturation) - (1 + cfg.affinityBias)) < 1e-9)
  // 超出饱和值不再放大
  assert.ok(Math.abs(themeAffinityFactor(cfg.saturation * 10) - (1 + cfg.affinityBias)) < 1e-9)
  const negative = themeAffinityFactor(-cfg.saturation)
  assert.ok(Math.abs(negative - Math.max(0.1, 1 - cfg.affinityBias * 1.5)) < 1e-9)
  assert.ok(themeAffinityFactor(-cfg.saturation * 10) >= 0.1, 'factor never goes below floor')
  assert.ok(themeAffinityFactor(-cfg.saturation) < 1 && themeAffinityFactor(cfg.saturation) > 1)
})

const mkSessionTrack = (overrides: Record<string, unknown> = {}) => ({
  trackKey: 't',
  timestamp: 1,
  ...overrides,
}) as any

test('session health detects negative streaks and shrinks exploration quota', () => {
  const cfg = recommendationConfig.sessionHealth
  const dislikes = new Set<string>()
  // recentTracks[0] 是最新的一首：早切(负) -> 听完(正) -> 早切(负) -> 早切(负)
  const session = {
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, channel: 'C', sourcePlaylistId: 'p1', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.95, channel: 'A', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'c', listenRatio: 0.05, channel: 'C', sourcePlaylistId: 'p1', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'd', listenRatio: 0.15, channel: 'D', sourcePlaylistId: 'p2', artistKeys: ['x'] }),
    ],
  }
  const health = computeSessionHealth(session, dislikes)
  assert.equal(health.negativeStreak, 1)
  assert.ok(Math.abs(health.negativeRate - 3 / 4) < 1e-9)
  assert.ok(health.explorationNegativeRate != null && health.explorationNegativeRate > cfg.explorationThrottleEnd)
  assert.ok(health.explorationFactor <= cfg.explorationFactorFloor + 1e-9, 'exploration rate at cap must shrink to floor')
  assert.equal(health.safeMode, false)

  const streaky = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, channel: 'C', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, channel: 'A', artistKeys: ['y'] }),
    ],
  }, dislikes)
  assert.equal(streaky.negativeStreak, 2)
  assert.equal(streaky.safeMode, true)

  const likedFirst = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', liked: true, channel: 'C', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.95, channel: 'A', artistKeys: ['y'] }),
    ],
  }, dislikes)
  assert.equal(likedFirst.negativeStreak, 0)
  assert.equal(likedFirst.explorationFactor, 1)
})

test('explicit dislike in session counts as settled negative feedback', () => {
  const dislikes = new Set(['disliked-1'])
  const health = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'disliked-1', channel: 'D', artistKeys: ['z'] }),
      mkSessionTrack({ trackKey: 'ok', listenRatio: 0.9, channel: 'A', artistKeys: ['w'] }),
    ],
  }, dislikes)
  assert.equal(health.negativeStreak, 1)
  assert.equal(health.negativeRate, 0.5)
})

test('exploration samples below the minimum fall back to overall negative rate', () => {
  const cfg = recommendationConfig.sessionHealth
  const health = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, channel: 'C', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.95, channel: 'A', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'c', listenRatio: 0.9, channel: 'A', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'd', listenRatio: 0.85, channel: 'B', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'e', listenRatio: 0.9, channel: 'A', artistKeys: ['y'] }),
    ],
  }, new Set())
  assert.equal(health.explorationNegativeRate, null, 'only one exploration sample must not drive the factor')
  // 总体 1/5 低于收缩起点，探索额度不收缩
  assert.ok(health.negativeRate < cfg.explorationThrottleStart)
  assert.equal(health.explorationFactor, 1)
})

test('negative rate maps linearly onto the exploration factor with a floor', () => {
  const cfg = recommendationConfig.sessionHealth
  assert.equal(mapNegativeRateToFactor(0), 1)
  assert.equal(mapNegativeRateToFactor(cfg.explorationThrottleStart), 1)
  assert.equal(mapNegativeRateToFactor(cfg.explorationThrottleEnd), cfg.explorationFactorFloor)
  assert.equal(mapNegativeRateToFactor(1), cfg.explorationFactorFloor)
  const mid = mapNegativeRateToFactor((cfg.explorationThrottleStart + cfg.explorationThrottleEnd) / 2)
  assert.ok(mid > cfg.explorationFactorFloor && mid < 1)
})

test('channel quotas shrink C/D and hand the room back to A/B under negative feedback', () => {
  const full = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { explorationFactor: 1 })
  assert.deepEqual(full.quotas, { A: 9, B: 5, C: 4, D: 2 }, 'factor=1 keeps the default 9/5/4/2')
  const shrunk = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { explorationFactor: 0.25 })
  assert.ok(shrunk.quotas.C + shrunk.quotas.D <= 3, `C/D should shrink, got ${JSON.stringify(shrunk.quotas)}`)
  assert.ok(shrunk.quotas.A + shrunk.quotas.B >= 16, `A/B should absorb the quota, got ${JSON.stringify(shrunk.quotas)}`)
  assert.equal(shrunk.total, 20)
})

test('session penalties accumulate with recency decay and cap at the ceiling', () => {
  const cfg = recommendationConfig.sessionHealth
  const session = {
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['x'], sourcePlaylistId: 'p1' }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, artistKeys: ['x'], sourcePlaylistId: 'p2' }),
      mkSessionTrack({ trackKey: 'c', listenRatio: 0.95, artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'd', listenRatio: 0.1, artistKeys: ['w'], sourcePlaylistId: 'p1' }),
    ],
  }
  const penalties = buildSessionPenalties(session, new Set())
  assert.ok(Math.abs(penalties.artistPenalty['x'] - (1 + cfg.penaltyRecencyDecay)) < 1e-9, `recency decay: ${penalties.artistPenalty['x']}`)
  assert.ok(Math.abs(penalties.artistPenalty['w'] - Math.pow(cfg.penaltyRecencyDecay, 3)) < 1e-9)
  assert.ok(Math.abs(penalties.playlistPenalty['p1'] - (1 + Math.pow(cfg.penaltyRecencyDecay, 3))) < 1e-9)
  assert.equal(penalties.artistPenalty['y'], undefined, 'positive listens never penalize')

  const many = { recentTracks: Array.from({ length: 8 }, (_, i) => mkSessionTrack({ trackKey: `n${i}`, listenRatio: 0.1, artistKeys: ['hot'] })) }
  const capped = buildSessionPenalties(many, new Set())
  assert.equal(capped.artistPenalty['hot'], cfg.penaltyCap)
})

test('penalized candidates score lower and exploration gate ranks affinity in radio mode only', () => {
  const sessionHealthCfg = recommendationConfig.sessionHealth
  const penalties = buildSessionPenalties({
    recentTracks: [mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['skipped-artist'], sourcePlaylistId: 'skipped-pl' })],
  }, new Set())
  assert.ok(sessionPenaltyScore(['skipped-artist'], ['skipped-pl'], penalties) > sessionHealthCfg.artistPenaltyWeight)
  assert.equal(sessionPenaltyScore(['clean-artist'], ['clean-pl'], penalties), 0)
  assert.ok(sessionPenaltyFactor(sessionPenaltyScore(['skipped-artist'], [], penalties)) < 1)
  assert.equal(sessionPenaltyFactor(0), 1)

  const mk = (key: string, affinity: number, artist: string, playlistId: string) => createPoolCandidate({
    musicInfo: mkMusic(key, `song-${key}`, artist, 'kw'),
    channel: 'C',
    sourceId: 'src',
    channels: ['C'],
    playlistIds: [playlistId],
    exploration: 1,
    affinity,
  })
  const penalized = mk('pen', 0.9, 'skipped-artist', 'skipped-pl')
  const clean = mk('clean', 0.9, 'clean-artist', 'clean-pl')
  const radioItems = buildFinalQueueItems([penalized, clean], { mode: 'radio', sessionPenalties: penalties })
  const radioPen = radioItems.find(item => item.key == penalized.trackKey)!.channelWeights!.C!
  const radioClean = radioItems.find(item => item.key == clean.trackKey)!.channelWeights!.C!
  assert.ok(radioPen < radioClean, `session penalties must lower the weight (${radioPen} >= ${radioClean})`)

  const blind = mk('blind', 0, 'blind-artist', 'blind-pl')
  const known = mk('known', 0.9, 'known-artist', 'known-pl')
  const radioGate = buildFinalQueueItems([blind, known], { mode: 'radio' })
  assert.ok(
    (radioGate.find(item => item.key == known.trackKey)!.channelWeights!.C!) > (radioGate.find(item => item.key == blind.trackKey)!.channelWeights!.C!),
    'radio mode affinity gate prefers profile-adjacent candidates',
  )
  const exploreGate = buildFinalQueueItems([blind, known], { mode: 'explore' })
  assert.ok(
    Math.abs((exploreGate.find(item => item.key == known.trackKey)!.channelWeights!.C!) - (exploreGate.find(item => item.key == blind.trackKey)!.channelWeights!.C!)) < 1e-9,
    'explore mode keeps pure novelty ranking',
  )
})

test('defer threshold needs repeated negative evidence, one skip only downweights', () => {
  const cfg = recommendationConfig.sessionHealth
  const single = buildSessionPenalties({
    recentTracks: [mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['x'], sourcePlaylistId: 'p1' })],
  }, new Set())
  assert.equal(shouldDeferQueuedItem(['x'], 'p1', single), false, 'one skip stays below the defer threshold')
  const repeated = buildSessionPenalties({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['x'], sourcePlaylistId: 'p1' }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, artistKeys: ['x'] }),
    ],
  }, new Set())
  assert.ok(repeated.artistPenalty['x'] >= cfg.deferPenaltyThreshold)
  assert.equal(shouldDeferQueuedItem(['x'], undefined, repeated), true)
  assert.equal(shouldDeferQueuedItem(['y'], 'p9', repeated), false)
  assert.equal(shouldDeferQueuedItem(['x'], undefined, undefined), false)
})

test('exploration gap keeps unfamiliar tracks from running back to back', () => {
  const mk = (key: string, channel: 'A' | 'C'): FinalQueueItem => ({
    key,
    channels: [channel],
    channelWeights: { [channel]: 1 },
    primaryArtist: `artist-${key}`,
    artistKeys: [`artist-${key}`],
    albumKey: `album:${key}`,
    groupIds: [],
    exposureCount: 0,
    weight: 1,
  })
  const candidates = [
    ...Array.from({ length: 15 }, (_, i) => mk(`a${i}`, 'A')),
    ...Array.from({ length: 5 }, (_, i) => mk(`c${i}`, 'C')),
  ]
  const plan = { quotas: { A: 15, B: 0, C: 5, D: 0 }, total: 20, reasons: {} } as any
  const result = selectFinalQueue(candidates, { target: 20, channelPlan: plan, rng: seedRandom(9), explorationGap: 1 })
  assert.equal(result.items.length, 20)
  const channels = result.items.map(entry => entry.item.channels[0])
  for (let i = 1; i < channels.length; i++) {
    const pair = [channels[i - 1], channels[i]]
    assert.ok(!pair.every(ch => ch == 'C'), `two exploration tracks must not be adjacent: ${channels.join('')}`)
  }
  assert.ok(!result.reasons.includes('exploration_gap_relaxed'), 'no relaxation needed when A has room')

  // 只剩探索通道时放宽间隔而不是饿死配额
  const onlyExploration = selectFinalQueue(
    Array.from({ length: 5 }, (_, i) => mk(`c${i}`, 'C')),
    { target: 5, channelPlan: { quotas: { A: 0, B: 0, C: 5, D: 0 }, total: 5, reasons: {} } as any, rng: seedRandom(4), explorationGap: 1 },
  )
  assert.equal(onlyExploration.items.length, 5)
  assert.ok(onlyExploration.reasons.includes('exploration_gap_relaxed'))
})

test('tokenizer splits version markers and style words, drops single chars and stopwords', () => {
  const dj = tokenizeTrackName('泡沫DJ版')
  assert.ok(dj.includes('dj'), `DJ marker should survive: ${JSON.stringify(dj)}`)
  assert.ok(dj.includes('泡沫'), `song body should survive: ${JSON.stringify(dj)}`)

  const live = tokenizeTrackName('晴天 (Live) 翻唱')
  assert.ok(live.includes('live'))
  assert.ok(live.includes('翻唱'))

  const style = tokenizeTrackName('夜晚爵士钢琴曲 伴奏')
  assert.ok(style.includes('爵士'), `style word should be segmented: ${JSON.stringify(style)}`)
  assert.ok(style.includes('钢琴曲'))
  assert.ok(style.includes('伴奏'))

  // 单字与纯数字被过滤，输出小写、去重
  const filtered = tokenizeTrackName('爱 2020 Remaster')
  assert.ok(!filtered.some(token => /^\d+$/.test(token)))
  assert.ok(filtered.every(token => token == token.toLowerCase() && token.length >= 2))
  assert.deepEqual(tokenizeTrackName(''), [])
  assert.deepEqual(tokenizeTrackName(undefined), [])
})

test('name token feedback downweights repeatedly skipped markers and boosts liked styles', () => {
  const now = 1_700_000_000_000
  const tokens: Record<string, any> = {}
  // 连续三次"DJ版"早切 → DJ token 显著降权
  for (let i = 0; i < 3; i++) {
    applyNameTokenFeedback(tokens, ['dj'], 0, 0.5, now + i * 1000)
  }
  const djFactor = nameTokenFactor(tokens, '泡沫DJ版', now)
  assert.ok(djFactor < 0.8, `repeated skips must bite, got ${djFactor}`)
  assert.ok(djFactor >= 0.5, 'factor must respect the floor')
  // 未学习的歌名不受影响
  assert.equal(nameTokenFactor(tokens, '普通情歌', now), 1)
  assert.equal(nameTokenFactor(undefined, '泡沫DJ版', now), 1)

  // 完播加分：爵士风格词升温
  for (let i = 0; i < 4; i++) {
    applyNameTokenFeedback(tokens, ['爵士'], 0.25, 0, now + i * 1000)
  }
  const jazzFactor = nameTokenFactor(tokens, '夜晚爵士钢琴曲', now)
  assert.ok(jazzFactor > 1, `completes must boost, got ${jazzFactor}`)
  assert.ok(jazzFactor <= 1.25, 'factor must respect the ceiling')
  // 半衰期衰减：一个半衰期后 DJ 的负权重减半，惩罚变轻
  const halfLifeMs = recommendationConfig.nameToken.halfLifeDays * 86400000
  const decayedFactor = nameTokenFactor(tokens, '泡沫DJ版', now + halfLifeMs)
  assert.ok(decayedFactor > djFactor, `decay must soften the penalty (${decayedFactor} <= ${djFactor})`)
})

test('channel bandit samples the posterior and modulates quotas within bounds', () => {
  const now = 1_700_000_000_000
  const bandit: Record<string, any> = {}
  // A 通道连续完播、D 通道连续早切
  for (let i = 0; i < 10; i++) {
    updateChannelBandit(bandit as any, 'A', 'positive', now + i * 1000)
    updateChannelBandit(bandit as any, 'D', 'negative', now + i * 1000)
  }
  assert.equal((bandit.A as any).alpha, 11)
  assert.equal((bandit.D as any).beta, 11)
  // 样本不足的通道保持中性
  const fresh: Record<string, any> = {}
  updateChannelBandit(fresh as any, 'C', 'positive', now)
  assert.equal(thompsonMultiplier(fresh as any, 'C', now, () => 0.5), 1)

  // 固定 rng：p 采样集中在后验均值附近，A 明显高于 D，且都被钳位
  const multipliers = ['A', 'B', 'C', 'D'].map(channel => thompsonMultiplier(bandit as any, channel as any, now, () => 0.4))
  assert.ok(multipliers[0] > multipliers[3], `A must out-sample D: ${multipliers.join(',')}`)
  for (const m of multipliers) {
    assert.ok(m >= recommendationConfig.bandit.minBoost && m <= recommendationConfig.bandit.maxBoost)
  }
  // 固定 rng 下 Gamma 比值偏向多计数的一侧：A（正反馈多）应高于中性，D 低于中性
  const medianA = thompsonMultiplier(bandit as any, 'A', now, () => 0.5)
  const medianD = thompsonMultiplier(bandit as any, 'D', now, () => 0.5)
  assert.ok(medianA > 1, `positive-heavy arm must sample above neutral, got ${medianA}`)
  assert.ok(medianD < 1, `negative-heavy arm must sample below neutral, got ${medianD}`)

  // 配额随 bandit 再分布：A 扩张、D 收缩，总量不变（now 必须对齐测试时间戳，否则计数衰减回先验）
  const strong = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { bandit: bandit as any, rng: () => 0.4, now })
  const neutral = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { rng: () => 0.4, now })
  assert.ok(strong.quotas.A > neutral.quotas.A, `A should grow: ${JSON.stringify(strong.quotas)} vs ${JSON.stringify(neutral.quotas)}`)
  assert.ok(strong.quotas.D < neutral.quotas.D, `D should shrink`)
  assert.equal(strong.total, 20)
})

test('SAR session co-occurrence rewards tracks that shared listening sessions with seeds', () => {
  const now = 1_700_000_000_000
  const minute = 60_000
  // 会话 1（新鲜）：种子 S 完播 + 同场 X 完播 + 早切的 Y（不应吸收信号）
  // 会话 2（一个半衰期之前）：X 与种子 S2 同场
  // 孤立会话：Z 单独听完，无种子在场
  const record = (trackKey: string, startedAt: number, coverage: number, endReason = 'natural_end') => ({
    playId: `${trackKey}-${startedAt}`,
    trackKey,
    startedAt,
    endedAt: startedAt + 180_000,
    intervals: [],
    listenedMs: coverage * 180_000,
    wallClockMs: 180_000,
    coverage,
    endReason,
    settled: true,
  })
  const halfLifeMs = recommendationConfig.sessionCoOccurrence.halfLifeDays * 86400000
  const history = [
    record('seed1', now - 5 * minute, 0.9),
    record('x', now - 4 * minute, 0.9),
    record('y', now - 3 * minute, 0.1, 'user_next'),
    record('seed2', now - halfLifeMs - 5 * minute, 0.95),
    record('x', now - halfLifeMs - 4 * minute, 0.9),
    record('z', now - halfLifeMs * 2, 0.9),
  ]
  const scores = buildSessionCoOccurrence(history as any, new Set(['seed1', 'seed2']))
  assert.ok((scores.get('x') ?? 0) > 0, 'x shared sessions with two seeds, must score')
  assert.ok((scores.get('y') ?? 0) === 0, 'early-skipped track must not absorb co-occurrence')
  assert.ok((scores.get('z') ?? 0) === 0, 'no seed in session, no score')
  assert.ok(scores.get('x')! <= 1)
  // 无种子 → 空图
  assert.equal(buildSessionCoOccurrence(history as any, new Set()).size, 0)
})

test('long-term artist prior decays slowly and bites on repeat offenders', () => {
  const now = 1_700_000_000_000
  const stats: Record<string, any> = {}
  // 总被切的歌手：2 次早切 + 1 次显式不喜欢 → 显著降权（负权重 3，未衰减时触底钳位）
  for (let i = 0; i < 2; i++) applyArtistStatsFeedback(stats as any, ['bad-artist'], 0, 0.5, now + i * 1000)
  applyArtistStatsFeedback(stats as any, ['bad-artist'], 0, 2, now + 5000)
  const badFactor = artistPriorFactor(stats as any, ['bad-artist'], now)
  assert.ok(badFactor < 0.75, `repeat-offender artist must be downweighted, got ${badFactor}`)
  assert.ok(badFactor >= 0.55, 'factor must respect the floor')
  // 常听完的歌手小幅加分
  for (let i = 0; i < 4; i++) applyArtistStatsFeedback(stats as any, ['good-artist'], 0.5, 0, now + i * 1000)
  const goodFactor = artistPriorFactor(stats as any, ['good-artist'], now)
  assert.ok(goodFactor > 1 && goodFactor <= 1.15, `reliable artist must gain a small boost, got ${goodFactor}`)
  // 无命中为 1；权重封顶
  assert.equal(artistPriorFactor(stats as any, ['unknown'], now), 1)
  assert.equal(artistPriorFactor(undefined, ['bad-artist'], now), 1)
  for (let i = 0; i < 30; i++) applyArtistStatsFeedback(stats as any, ['capped'], 0, 2, now + i * 1000)
  assert.equal(stats['capped'].negativeWeight, recommendationConfig.artistPrior.maxWeight)
  // 45 天半衰期：坏歌手的惩罚随时间松动
  const halfLifeMs = recommendationConfig.artistPrior.halfLifeDays * 86400000
  assert.ok(artistPriorFactor(stats as any, ['bad-artist'], now + halfLifeMs) > badFactor,
    'decay must soften the prior over time')
})

test('positive streak unlocks exploration expansion above 1', () => {
  const health = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.95, channel: 'A', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.9, channel: 'A', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'c', listenRatio: 0.95, channel: 'A', artistKeys: ['z'] }),
    ],
  }, new Set())
  assert.equal(health.positiveStreak, 3)
  assert.ok(health.explorationFactor > 1, `streak must expand exploration, got ${health.explorationFactor}`)
  assert.ok(health.explorationFactor <= recommendationConfig.sessionHealth.positiveExplorationBoost + 1e-9)
  // 安全模式优先：负反馈连击时不扩张
  const mixed = computeSessionHealth({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, channel: 'C', artistKeys: ['x'] }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, channel: 'A', artistKeys: ['y'] }),
      mkSessionTrack({ trackKey: 'c', listenRatio: 0.95, channel: 'A', artistKeys: ['z'] }),
      mkSessionTrack({ trackKey: 'd', listenRatio: 0.9, channel: 'A', artistKeys: ['w'] }),
      mkSessionTrack({ trackKey: 'e', listenRatio: 0.9, channel: 'A', artistKeys: ['v'] }),
    ],
  }, new Set())
  assert.equal(mixed.safeMode, true)
  assert.ok(mixed.explorationFactor <= 1, `safe mode must suppress the boost, got ${mixed.explorationFactor}`)
  // 配额随 >1 的 factor 扩张 C/D
  const expanded = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 }, { explorationFactor: recommendationConfig.sessionHealth.positiveExplorationBoost })
  const neutral = planChannelQuotas(20, [], { A: 100, B: 100, C: 100, D: 100 })
  assert.ok(expanded.quotas.C + expanded.quotas.D > neutral.quotas.C + neutral.quotas.D,
    `positive streak should grow C/D quota: ${JSON.stringify(expanded.quotas)} vs ${JSON.stringify(neutral.quotas)}`)
  assert.equal(expanded.total, 20)
})

test('learned style tokens feed discovery keywords, negative markers never do', () => {
  const now = 1_700_000_000_000
  const tokens: Record<string, any> = {}
  applyNameTokenFeedback(tokens, ['爵士'], 0.25, 0, now)
  applyNameTokenFeedback(tokens, ['国风'], 0.5, 0, now)
  applyNameTokenFeedback(tokens, ['dj'], 0, 0.5, now)
  applyNameTokenFeedback(tokens, ['老歌'], 0.25, 0, now)
  const learned = getLearnedStyleTokens(tokens as any, 4, now)
  assert.deepEqual(learned, ['国风', '爵士', '老歌'], `positive-only, weight-ordered: ${JSON.stringify(learned)}`)
  assert.ok(!learned.includes('dj'), 'skipped markers must never become search keywords')
  // 关键词池：风格词追加在画像关键词之后，不挤占
  const profile = {
    directions: [],
    seeds: [],
    seedKeys: new Set(),
    topArtists: [{ artist: '主力歌手', weight: 1 }],
    updatedAt: 1,
  } as any
  const keywords = buildPlaylistKeywords(profile, 8, learned)
  assert.equal(keywords[0], '主力歌手')
  assert.ok(keywords.includes('国风') && keywords.indexOf('国风') > 0, 'learned tokens must be appended, not prepended')
})

test('chart board selection prefers keyword hits and rotates on ties', () => {
  const boards = [
    { id: '1', name: '飙升榜' },
    { id: '2', name: '国风热歌榜' },
    { id: '3', name: '电音榜' },
    { id: '4', name: '民谣精选榜' },
  ]
  // 画像关键词命中“国风”与“民谣”，得分并列最高 → 轮换
  const first = pickChartBoard(boards, ['国风', '民谣'], 0)
  const second = pickChartBoard(boards, ['国风', '民谣'], 1)
  assert.ok(first != null && second != null)
  assert.deepEqual([first.id, second.id].sort(), ['2', '4'], `tie between the two hits must rotate: ${first.name}/${second.name}`)
  // 两个命中榜都不该轮到无关榜
  assert.ok([first.id, second.id].every(id => id == '2' || id == '4'))
  // 无命中 → 纯轮换
  assert.equal(pickChartBoard(boards, ['爵士'], 0)!.id, '1')
  assert.equal(pickChartBoard(boards, ['爵士'], 1)!.id, '2')
  assert.equal(pickChartBoard(boards, [], 2)!.id, '3')
  assert.equal(pickChartBoard([], ['国风'], 0), undefined)
})

test('time slot affinity scores artists by the current slot only', () => {
  const base = new Date(2026, 0, 1, 14, 0).getTime() // 明确的本地下午 14:00
  const minute = 60 * 1000
  const record = (artist: string, startedAt: number, endReason: string, coverage: number) => ({
    trackKey: `${artist}-${startedAt}`,
    startedAt,
    endedAt: startedAt + 180_000,
    intervals: [],
    listenedMs: coverage * 180_000,
    wallClockMs: 180_000,
    coverage,
    endReason,
    settled: true,
    artistKeys: [artist],
  })
  const history = [
    // 白天：java-artist 完播 2 次 + 早切 1 次；rock-artist 早切 2 次
    record('java', base - 30 * minute, 'natural_end', 0.95),
    record('java', base - 20 * minute, 'natural_end', 0.9),
    record('java', base - 10 * minute, 'user_next', 0.1),
    record('rock', base - 25 * minute, 'user_next', 0.05),
    record('rock', base - 5 * minute, 'user_next', 0.2),
    // 深夜：java 完播——不应计入白天的桶
    record('java', base + 14 * 3600 * 1000, 'natural_end', 0.95),
  ]
  const affinity = computeTimeSlotAffinity(history as any, base)
  assert.equal(affinity.currentSlot, 'afternoon')
  assert.ok(affinity.sampleSize >= 4)
  const javaFactor = affinity.factorFor(['java'])
  const rockFactor = affinity.factorFor(['rock'])
  assert.ok(javaFactor > 1, `daytime-favored artist must gain, got ${javaFactor}`)
  assert.ok(rockFactor < 1, `daytime-skipped artist must lose, got ${rockFactor}`)
  assert.ok(javaFactor <= recommendationConfig.timeSlot.factorCeiling + 1e-9)
  // 未知歌手不干预
  assert.equal(affinity.factorFor(['unknown']), 1)
  // 样本不足 → 全部中性
  const thin = computeTimeSlotAffinity([history[0]] as any, base)
  assert.equal(thin.factorFor(['java']), 1)
  // 时段边界
  assert.equal(getTimeSlot(new Date(2026, 0, 1, 6, 0).getTime()), 'morning')
  assert.equal(getTimeSlot(new Date(2026, 0, 1, 14, 0).getTime()), 'afternoon')
  assert.equal(getTimeSlot(new Date(2026, 0, 1, 20, 0).getTime()), 'evening')
  assert.equal(getTimeSlot(new Date(2026, 0, 1, 2, 0).getTime()), 'night')
})

test('log-mel frames concentrate a sine tone in low mel bands and reject too-short input', () => {
  const sr = 16000
  const pcm = new Float32Array(sr)
  for (let i = 0; i < pcm.length; i++) pcm[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  const frames = computeLogMelFrames(pcm)
  assert.ok(frames.length >= 60, `1s of audio should yield ~61 frames, got ${frames.length}`)
  let lowMax = 0
  let highMax = 0
  for (let b = 0; b < 96; b++) {
    let peak = 0
    for (const frame of frames) peak = Math.max(peak, frame[b])
    if (b < 20) lowMax = Math.max(lowMax, peak)
    if (b > 80) highMax = Math.max(highMax, peak)
  }
  assert.ok(lowMax > highMax + 2, `440Hz energy must sit in low bands (low ${lowMax}, high ${highMax})`)
  assert.deepEqual(computeLogMelFrames(new Float32Array(100)), [], 'input shorter than one frame yields nothing')
})

test('mel patches keep the frame-major layout and pad short audio to one patch', () => {
  const frame = (value: number) => {
    const f = new Float32Array(96)
    f.fill(value)
    return f
  }
  const patches = buildPatches([frame(1), frame(2)])
  assert.equal(patches.length, 1)
  assert.equal(patches[0].length, 187 * 96)
  assert.equal(patches[0][0], 1)
  assert.equal(patches[0][96], 2, 'second frame occupies the next 96 slots')
  assert.equal(patches[0][patches[0].length - 1], 2, 'padding repeats the last frame')
  assert.deepEqual(buildPatches([]), [])
})

test('embedding quantization roundtrips cosine and base64 helpers stay exact', () => {
  const vector = new Float32Array([0.31, -0.72, 0.05, -0.14, 0.98, -0.4])
  const embedding = { ...quantizeEmbedding(vector), dim: vector.length, modelId: 'test', analyzedAt: 1 }
  const restored = dequantizeEmbedding(embedding)
  assert.ok(cosine(vector, restored) > 0.999, `quantization must preserve direction, got ${cosine(vector, restored)}`)
  // 相似向量与正交向量分得开
  const similar = { ...quantizeEmbedding(new Float32Array([0.3, -0.7, 0.06, -0.15, 0.97, -0.41])), dim: vector.length, modelId: 'test', analyzedAt: 1 }
  const orthogonal = { ...quantizeEmbedding(new Float32Array([1, 0, 0, 0, 0, 0])), dim: vector.length, modelId: 'test', analyzedAt: 1 }
  assert.ok(cosine(restored, dequantizeEmbedding(similar)) > cosine(restored, dequantizeEmbedding(orthogonal)))
  const round = base64ToBytes(bytesToBase64(new Uint8Array([0, 1, 127, 128, 200, 255])))
  assert.deepEqual(Array.from(round), [0, 1, 127, 128, 200, 255])
})

test('playlist audio affinity uses the taste centroid and respects the coverage floor', () => {
  const mk = (values: number[]) => ({ ...quantizeEmbedding(new Float32Array(values)), dim: values.length, modelId: 'test', analyzedAt: 1 })
  // 画像歌曲都指向 (1,0)；质心约 (0.9,0.44)
  const embeddings = {
    warm1: mk([1, 0]), warm2: mk([1, 0]), warm3: mk([0.5, 0.9]),
    cold1: mk([-1, 0]), cold2: mk([-1, 0]), cold3: mk([-1, 0]),
    stray: mk([0, 1]),
  }
  const playlists = {
    warm: { id: 'warm', fetchedTracks: ['warm1', 'warm2', 'warm3', 'unknown1'] },
    cold: { id: 'cold', fetchedTracks: ['cold1', 'cold2', 'cold3'] },
    sparse: { id: 'sparse', fetchedTracks: ['stray', 'unknown2', 'unknown3', 'unknown4'] },
    empty: { id: 'empty', fetchedTracks: [] },
  }
  // cold 三首是被切过的负样本：排除后质心由 warm 歌构成
  const affinity = computePlaylistAudioAffinity(embeddings, playlists as any, 0.3, new Set(['cold1', 'cold2', 'cold3']))
  assert.ok(affinity.warm > affinity.cold, `warm playlist must outrank cold: ${JSON.stringify(affinity)}`)
  assert.ok(affinity.warm > 0.5 && affinity.warm <= 1)
  assert.ok(affinity.cold < 0.5, `opposite-direction playlist must land low: ${affinity.cold}`)
  assert.equal(affinity.sparse, undefined, 'below the coverage floor a playlist gets no score')
  assert.equal(affinity.empty, undefined)
  assert.deepEqual(computePlaylistAudioAffinity({}, playlists as any), {}, 'no embeddings, no affinity')
  // 负反馈歌曲必须能被剔除出质心：不排除时 cold 会把质心拉向自己（这正是要排除的原因）
  const unfiltered = computePlaylistAudioAffinity(embeddings, playlists as any, 0.3, new Set())
  assert.ok(unfiltered.cold >= affinity.cold, `unfiltered centroid must tilt toward cold: ${unfiltered.cold}`)
  const excludeWarm = computePlaylistAudioAffinity(embeddings, playlists as any, 0.3, new Set(['warm1', 'warm2', 'warm3']))
  assert.ok(excludeWarm.cold > 0.5, `with positives excluded the centroid tilts to the cold side: ${excludeWarm.cold}`)
  const centroid = getTasteCentroid(embeddings, new Set())
  assert.ok(centroid != null && Math.abs(centroid[0] as number) > 0, 'centroid exists when embeddings exist')
  assert.equal(getTasteCentroid({}, new Set()), null)
  assert.equal(getTasteCentroid(embeddings, new Set(Object.keys(embeddings))), null, 'excluding everything leaves no centroid')
})

test('safe mode deferral covers handed-off tracks and respects the cap', () => {
  const penalties = buildSessionPenalties({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['skipped'], sourcePlaylistId: 'p1' }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, artistKeys: ['skipped'] }),
    ],
  }, new Set())
  const queueItem = { musicInfo: mkMusic('kw_q', 'queued', 'skipped', 'kw'), sourcePlaylistId: 'p1' }
  const handedOff = { musicInfo: mkMusic('kw_h', 'handed-off', 'skipped', 'kw'), sourcePlaylistId: 'p2' }
  const clean = { musicInfo: mkMusic('kw_c', 'clean', 'other', 'kw'), sourcePlaylistId: 'p3' }

  const engineOnly = selectDeferredTrackKeys([queueItem], penalties, {})
  assert.equal(engineOnly.length, 1, 'queue-only view must still defer the penalized track')

  const combined = selectDeferredTrackKeys([queueItem, handedOff, clean], penalties, {})
  assert.equal(combined.length, 2, 'handed-off tracks are visible to safe mode')
  assert.ok(combined.includes(buildTrackKey(queueItem.musicInfo)))
  assert.ok(combined.includes(buildTrackKey(handedOff.musicInfo)))
  assert.ok(!combined.includes(buildTrackKey(clean.musicInfo)))

  const capped = selectDeferredTrackKeys([queueItem, handedOff], penalties, { maxDeferrals: 1 })
  assert.equal(capped.length, 1)
  assert.equal(capped[0], buildTrackKey(queueItem.musicInfo), 'cap keeps the earliest offender')

  const excluded = selectDeferredTrackKeys([queueItem, handedOff], penalties, { excludeTrackKey: buildTrackKey(queueItem.musicInfo) })
  assert.deepEqual(excluded, [buildTrackKey(handedOff.musicInfo)], 'the just-finished track is never deferred again')

  assert.deepEqual(selectDeferredTrackKeys([queueItem], undefined, {}), [], 'no penalties means no deferral')
})

test('quality gate stops a flood of low-score candidates from outvoting the best one', () => {
  const cfg = recommendationConfig.softmax
  const mkItem = (key: string, weight: number): FinalQueueItem => ({
    key,
    channels: ['A'],
    channelWeights: { A: weight },
    primaryArtist: `artist-${key}`,
    artistKeys: [`artist-${key}`],
    albumKey: `album-${key}`,
    exposureCount: 0,
    weight,
  })
  const strong = mkItem('strong', 0.8)
  const weak = Array.from({ length: 10 }, (_, i) => mkItem(`weak-${i}`, 0.2))
  const plan = planChannelQuotas(1, [], { A: 11, B: 0, C: 0, D: 0 })

  let strongPicks = 0
  const runs = 400
  for (let seed = 1; seed <= runs; seed++) {
    const result = selectFinalQueue([strong, ...weak], { target: 1, channelPlan: plan, rng: seedRandom(seed) })
    if (result.items[0]?.item.key == 'strong') strongPicks += 1
  }
  const rate = strongPicks / runs
  assert.ok(rate > 0.9, `weak candidates below the gate must not win, strong rate=${rate}`)

  const allWeak = Array.from({ length: 5 }, (_, i) => mkItem(`w-${i}`, 0.2))
  const fallback = selectFinalQueue(allWeak, { target: 1, channelPlan: plan, rng: seedRandom(7) })
  assert.equal(fallback.items.length, 1, 'when nothing passes the gate the unfiltered pool is used')

  assert.ok(cfg.qualityGateRatio > 0 && cfg.qualityGateRatio <= 1, 'gate ratio stays inside (0, 1]')
})

test('playback failures and app destroy never count as taste feedback', () => {
  const mkRecord = (endReason: string, listenedMs: number, durationMs: number): any => ({
    playId: `p-${endReason}-${listenedMs}`,
    trackKey: 'kw_1',
    channel: 'A',
    sourcePlaylistId: 'pl-settle-test',
    startedAt: 1,
    endedAt: 2,
    intervals: [{ from: 0, to: listenedMs }],
    listenedMs,
    wallClockMs: listenedMs,
    durationMs,
    coverage: durationMs ? listenedMs / durationMs : 0,
    endReason,
    seekedToEnd: false,
  })
  const duration = 200000

  for (const endReason of ['play_error', 'load_error', 'app_destroy']) {
    const result = settlePlayRecord(mkRecord(endReason, 5000, duration))
    assert.equal(result.track, undefined, `${endReason} must not create a track effect`)
    assert.equal(result.playlist, undefined, `${endReason} must not create a playlist effect`)
    assert.equal(result.ledgerEntry.implicitSettled, true)
    assert.deepEqual(result.reasons, [`neutral_end:${endReason}`])
  }

  const earlySkip = settlePlayRecord(mkRecord('user_next', 5000, duration))
  assert.ok(earlySkip.ledgerEntry.earlySkip, 'a 5s skip is an early skip')
  assert.ok(earlySkip.track!.scoreDelta < 0)
  assert.ok(earlySkip.playlist!.negativeDelta > 0)

  const fullListen = settlePlayRecord(mkRecord('natural_end', 190000, duration))
  assert.ok(fullListen.ledgerEntry.completion, '95% coverage on natural end is a completion')
  assert.ok(fullListen.track!.scoreDelta > 0)

  const disliked = settleExplicitFeedback({ trackKey: 'kw_2', type: 'dislike', timestamp: 3 })
  assert.equal(disliked.excludeTrackKey, 'kw_2', 'explicit dislike keeps the permanent exclusion contract')
  assert.ok(disliked.track!.scoreDelta < earlySkip.track!.scoreDelta, 'explicit dislike must outweigh an early skip')
})

test('deferral view spans the engine queue and tracks already handed to the player', () => {
  const penalties = buildSessionPenalties({
    recentTracks: [
      mkSessionTrack({ trackKey: 'a', listenRatio: 0.1, artistKeys: ['skipped'], sourcePlaylistId: 'p1' }),
      mkSessionTrack({ trackKey: 'b', listenRatio: 0.2, artistKeys: ['skipped'] }),
    ],
  }, new Set())
  const queue = createRadioQueue()
  const version = queue.getVersion()
  const queueItem = {
    musicInfo: mkMusic('kw_q', 'queued', 'skipped', 'kw'),
    source: 'related' as const,
    channel: 'A' as const,
    sourcePlaylistId: 'p1',
    batchId: 1,
  }
  const handedOff = {
    musicInfo: mkMusic('kw_h', 'handed-off', 'skipped', 'kw'),
    source: 'related' as const,
    channel: 'A' as const,
    sourcePlaylistId: 'p2',
    batchId: 1,
  }
  queue.enqueue([queueItem, handedOff], version)
  // 模拟 radio.ts：两首都已移交给播放器，引擎队列因此为空
  const pendingProvider = () => queue.shift(2, version)
  const handedOffItems = pendingProvider()
  assert.equal(queue.snapshot().items.length, 0, 'handed-off tracks leave the engine queue')

  const deferred = selectDeferredTrackKeys(
    [...queue.snapshot().items, ...handedOffItems],
    penalties,
    {},
  )
  assert.equal(deferred.length, 2, 'safe mode must see the handed-off batch')

  const removed = queue.removeMany(new Set(deferred), queue.getVersion())
  assert.equal(removed, 0, 'nothing is left in the engine queue to remove')
  assert.equal(handedOffItems.filter(item => deferred.includes(buildTrackKey(item.musicInfo))).length, 2)
})

test('playlist audio affinity ignores vectors from another model generation', () => {
  const embeddings = {
    'kw_like-1': { ...quantizeEmbedding(new Float32Array([1, 0, 0])), dim: 3, modelId: 'gen-a', analyzedAt: 1 },
    'kw_like-2': { ...quantizeEmbedding(new Float32Array([0.9, 0.1, 0])), dim: 3, modelId: 'gen-a', analyzedAt: 1 },
    'kw_old-1': { ...quantizeEmbedding(new Float32Array([0, 0, 1])), dim: 3, modelId: 'gen-b', analyzedAt: 1 },
    'kw_old-2': { ...quantizeEmbedding(new Float32Array([0, 0, 1])), dim: 3, modelId: 'gen-b', analyzedAt: 1 },
  } as any
  const playlists = {
    'pl-mixed': { id: 'pl-mixed', fetchedTracks: ['kw_like-1', 'kw_like-2', 'kw_old-1', 'kw_old-2'] },
  } as any

  const affinity = computePlaylistAudioAffinity(embeddings, playlists, 0.3)
  assert.ok(affinity['pl-mixed'] > 0.8, `stale-model vectors must not drag the score down, got ${affinity['pl-mixed']}`)

  const onlyStale = computePlaylistAudioAffinity(
    embeddings,
    { 'pl-stale': { id: 'pl-stale', fetchedTracks: ['kw_old-1', 'kw_old-2'] } } as any,
    0.3,
  )
  assert.deepEqual(onlyStale, {}, 'a playlist with no current-generation samples gets no score')

  assert.notEqual(audioModelId('1x187x96', '1x50', 50), audioModelId('1x187x96', '1x188', 188))
  assert.equal(audioModelId('1x187x96', '1x50', 50), 'in1x187x96-out1x50-d50')
})
