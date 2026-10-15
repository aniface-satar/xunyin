import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPreloadPlan,
  audioMaxBytes,
  RESOLVE_AHEAD_SECONDS,
  MIN_DURATION_SECONDS,
  AUDIO_DELAY_SECONDS,
  AUDIO_HEAD_BYTES,
  type PreloadPlanInput,
  type PreloadStep,
} from '../src/core/player/preloadPlan.ts'

// cacheBytes 给 1GB（默认 player.cacheSize='1024' 换算出来的字节数），远大于 8MB 前缀；只有钉门限的那两个用例动它
const FLAGS = { preloadNextMusic: true, dynamicBg: true, audioTier: 'head' as const, cacheBytes: 1024 * 1024 * 1024 }
const NO_DONE: Record<PreloadStep, boolean> = { pic: false, lyric: false, palette: false, coverBytes: false, audio: false }

/** 默认输入：播到 50s / 共 60s（剩 10s，落在 60s 门限内），下一首已解析、还没有封面 URL、解析刚完成。 */
const input = (over: Partial<PreloadPlanInput> = {}): PreloadPlanInput => ({
  progress: { nowPlayTime: 50, maxPlayTime: 60 },
  flags: FLAGS,
  resolveTried: true,
  hasTarget: true,
  targetIsOnline: true,
  hasPicUrl: false,
  resolvedAge: 0,
  done: { ...NO_DONE },
  ...over,
})

test('剩余 >60s 时不解析目标，也不发任何步骤', () => {
  const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 10, maxPlayTime: 200 }, resolveTried: false, hasTarget: false }))
  assert.equal(plan.resolveTarget, false)
  assert.deepEqual(plan.steps, [])
})

test('剩余 <=60s 且本曲没问过：只让解析目标，这一步不发任何步骤', () => {
  const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 30, maxPlayTime: 90 }, resolveTried: false, hasTarget: false }))
  assert.equal(plan.resolveTarget, true)
  assert.deepEqual(plan.steps, [])
})

test('目标问过就不再问第二次（无论成功还是返回 null）', () => {
  assert.equal(buildPreloadPlan(input({ resolveTried: false, hasTarget: false })).resolveTarget, true)
  assert.equal(buildPreloadPlan(input({ resolveTried: true, hasTarget: false })).resolveTarget, false)
  assert.equal(buildPreloadPlan(input({ resolveTried: true, hasTarget: true })).resolveTarget, false)
})

test('时长 <=10s（含 0，电台/未知长度流）整条不启动：60s 门限对它是恒真，必须靠这个下界挡掉', () => {
  for (const maxPlayTime of [0, 5, MIN_DURATION_SECONDS]) {
    const plan = buildPreloadPlan(input({ progress: { nowPlayTime: 0, maxPlayTime }, resolveTried: false, hasTarget: false }))
    assert.equal(plan.resolveTarget, false, `maxPlayTime=${maxPlayTime}`)
  }
  assert.equal(buildPreloadPlan(input({ progress: { nowPlayTime: 0, maxPlayTime: 11 }, resolveTried: false, hasTarget: false })).resolveTarget, true)
})

test('spec §4.2 的"≤10s 兜底"被 60s 门限包含：同一张表里剩 8s 与剩 40s 的判据相同', () => {
  assert.equal(RESOLVE_AHEAD_SECONDS > MIN_DURATION_SECONDS, true)
  const nearEnd = buildPreloadPlan(input({ progress: { nowPlayTime: 52, maxPlayTime: 60 } }))
  const midEnd = buildPreloadPlan(input({ progress: { nowPlayTime: 20, maxPlayTime: 60 } }))
  assert.deepEqual(nearEnd.steps, ['pic', 'lyric'])
  assert.deepEqual(midEnd.steps, nearEnd.steps)
})

test('目标一定就立刻发 pic 与 lyric，两者互不牵连', () => {
  assert.deepEqual(buildPreloadPlan(input()).steps, ['pic', 'lyric'])
})

test('dynamicBg=false 只跳取色那一步，其余照发', () => {
  const withoutPalette = buildPreloadPlan(input({ hasPicUrl: true, flags: { ...FLAGS, dynamicBg: false } }))
  assert.equal(withoutPalette.steps.includes('palette'), false)
  assert.deepEqual(withoutPalette.steps, ['pic', 'lyric', 'coverBytes'])
})

test('palette 与 coverBytes 都要等 pic 的结果（hasPicUrl）才发', () => {
  assert.deepEqual(buildPreloadPlan(input()).steps, ['pic', 'lyric'])
  assert.deepEqual(buildPreloadPlan(input({ hasPicUrl: true })).steps, ['pic', 'lyric', 'palette', 'coverBytes'])
})

test('本地/下载曲不发 coverBytes，也不发 audio', () => {
  const offline = buildPreloadPlan(input({ targetIsOnline: false, hasPicUrl: true, resolvedAge: 10 }))
  assert.equal(offline.steps.includes('coverBytes'), false)
  assert.equal(offline.steps.includes('audio'), false)
  assert.deepEqual(offline.steps, ['pic', 'lyric', 'palette'])
})

test('audio 要等解析完成后满 3s 才发（给连点下一首留反悔窗口）', () => {
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: AUDIO_DELAY_SECONDS - 1 })).steps.includes('audio'), false)
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: AUDIO_DELAY_SECONDS })).steps.includes('audio'), true)
})

test('audio 三种关闭情形：档位 off / 缓存 0 / 非在线曲，各自只少 audio 一步', () => {
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, audioTier: 'off' } })).steps.includes('audio'), false)
  assert.equal(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, cacheBytes: 0 } })).steps.includes('audio'), false)
  const off = buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, cacheBytes: 0 } }))
  assert.deepEqual(off.steps, ['pic', 'lyric', 'palette', 'coverBytes'])
})

test('缓存装不下 8MB 前缀（6MB）：只少 audio 一步，其余照发；head 与 full 共用这道门限', () => {
  const smallCache = { ...FLAGS, cacheBytes: 6 * 1024 * 1024 }
  const head = buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: smallCache }))
  assert.equal(head.steps.includes('audio'), false)
  assert.deepEqual(head.steps, ['pic', 'lyric', 'palette', 'coverBytes'])
  // full 档（audioMaxBytes 为 0 → 原生按 LENGTH_UNSET 下整首）没有上限兜底，被挤掉的只能是正在播那首，
  // 所以它受的是同一个下限，而不是"反正能装多少算多少"
  const full = buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...smallCache, audioTier: 'full' } }))
  assert.equal(full.steps.includes('audio'), false)
  assert.deepEqual(full.steps, ['pic', 'lyric', 'palette', 'coverBytes'])
})

test('缓存恰好等于 AUDIO_HEAD_BYTES 时 audio 这一步要发（门限含等号，别让 8MB 缓存白置）', () => {
  const exact = buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, flags: { ...FLAGS, cacheBytes: AUDIO_HEAD_BYTES } }))
  assert.deepEqual(exact.steps, ['pic', 'lyric', 'palette', 'coverBytes', 'audio'])
})

test('preloadNextMusic=false 时五步全不发、也不解析', () => {
  const plan = buildPreloadPlan(input({ flags: { ...FLAGS, preloadNextMusic: false }, hasPicUrl: true, resolvedAge: 10, resolveTried: false }))
  assert.equal(plan.resolveTarget, false)
  assert.deepEqual(plan.steps, [])
})

test('已经发起过的步骤不再重复发起（每步每曲只发一次）', () => {
  const done = { ...NO_DONE, pic: true, lyric: true }
  assert.deepEqual(buildPreloadPlan(input({ done })).steps, [])
  assert.deepEqual(buildPreloadPlan(input({ hasPicUrl: true, resolvedAge: 5, done: { ...NO_DONE, pic: true, lyric: true, palette: true } })).steps, ['coverBytes', 'audio'])
})

test('音频档位换算：head 给 8MB 上限，full 给 0（由原生换成 C.LENGTH_UNSET），off 不会被调用', () => {
  assert.equal(audioMaxBytes('head'), AUDIO_HEAD_BYTES)
  assert.equal(audioMaxBytes('full'), 0)
})
