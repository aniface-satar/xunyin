# 推荐质量升级阶段一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让连续负反馈真正影响实际待播歌曲，并在抽样前限制低分候选的数量优势。

**Architecture:** 阶段一只改动现有推荐引擎，不新增依赖、不改数据模型、不触碰音频推理。先把安全模式的撤队判定抽成纯函数并同时覆盖引擎队列与 `radio.ts` 的 `pending`，再在通道抽样前加入相对质量门槛，最后让 `radio.ts` 注册待播提供者，使引擎能看到已移交给播放器的曲目。

**Tech Stack:** TypeScript、`node:test`（现有 `npm test`）、ESLint、Metro bundle、Gradle（原生编译校验）。

**Spec:** `docs/superpowers/specs/2026-10-06-recommendation-quality-upgrade-design.md`（阶段一，§3.1、§3.4、§4.1、§6 阶段一、§7.1）

## Global Constraints

- 不新增 npm 依赖，不改 `package.json`。
- 不修改 `STATE_VERSION`，不迁移或清空已有画像、历史、候选缓存。
- 不改变 `RADIO_COMMIT_AHEAD = 2` 与 `PENDING_LOW_WATER = 4` 的现有取值；阶段一只修可见性与门槛，不调提交窗口。
- 不修改正在播放的歌曲，不删除用户手动加入 `tempPlayList` 的非电台曲目。
- 保持竖屏，不触碰 `AndroidManifest.xml` 与 `Navigation.setDefaultOptions`。
- 每个任务的 `git add` 只列本任务文件；工作区已有大量未提交改动，禁止使用 `git add -A`、`git add .` 或 `git commit -a`。
- `src/core/recommend/` 未被 git 跟踪；提交前用 `git status --short` 复核暂存内容只有本计划文件。
- 验证闸门：`npm test`、`npx eslint src/core/recommend`、`npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/phase1.bundle --assets-dest /tmp/phase1-assets`。不要用 `npx tsc --noEmit` 判断全绿（仓库存在历史类型噪声）。

---

### Task 1: 撤队判定纯函数

**Files:**
- Create: `src/core/recommend/queueDeferral.ts`
- Test: `tests/recommend-algorithm.mts`（在文件末尾追加）

**Interfaces:**
- Consumes: `buildTrackKey`、`getArtistKeys`（`./trackKey.ts`）、`shouldDeferQueuedItem` 与 `SessionPenalties`（`./sessionHealth.ts`）、`ChannelId`（`./types.ts`）。
- Produces:
  - `interface DeferrableItem { musicInfo: LX.Music.MusicInfo, sourcePlaylistId?: string }`
  - `selectDeferredTrackKeys(items: readonly DeferrableItem[], penalties: SessionPenalties | undefined, options: { maxDeferrals?: number, excludeTrackKey?: string }): string[]` — 按传入顺序返回需要撤下的 `trackKey`，数量不超过 `maxDeferrals`，`excludeTrackKey` 永不入选，结果为空数组表示无需撤队。

- [ ] **Step 1: 写失败测试**

在 `tests/recommend-algorithm.mts` 顶部 import 区（第 30 行 `import type { ObservedPlaylist, PoolCandidate } ...` 之后）加：

```ts
import { selectDeferredTrackKeys } from '../src/core/recommend/queueDeferral.ts'
```

在文件末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`Cannot find module '../src/core/recommend/queueDeferral.ts'`。

- [ ] **Step 3: 实现纯函数**

创建 `src/core/recommend/queueDeferral.ts`：

```ts
import { buildTrackKey, getArtistKeys } from './trackKey.ts'
import { shouldDeferQueuedItem, type SessionPenalties } from './sessionHealth.ts'
import { recommendationConfig } from './config.ts'

export interface DeferrableItem {
  musicInfo: LX.Music.MusicInfo
  sourcePlaylistId?: string
}

export interface DeferralOptions {
  maxDeferrals?: number
  excludeTrackKey?: string
}

/**
 * 安全模式撤队判定。引擎队列与已移交给播放器的待播曲目共用同一套阈值，
 * 判定只依赖歌手/来源歌单的会话惩罚，不修改任何状态。
 */
export const selectDeferredTrackKeys = (
  items: readonly DeferrableItem[],
  penalties: SessionPenalties | undefined,
  options: DeferralOptions = {},
): string[] => {
  if (!penalties) return []
  const max = Math.max(0, options.maxDeferrals ?? recommendationConfig.sessionHealth.maxDeferralsPerTrigger)
  const deferred: string[] = []
  for (const item of items) {
    if (deferred.length >= max) break
    const trackKey = buildTrackKey(item.musicInfo)
    if (trackKey == options.excludeTrackKey) continue
    if (!shouldDeferQueuedItem(getArtistKeys(item.musicInfo.singer), item.sourcePlaylistId, penalties)) continue
    if (!deferred.includes(trackKey)) deferred.push(trackKey)
  }
  return deferred
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test`
Expected: PASS，全部既有用例仍然通过（2026-10-06 实测基线：91 tests / 91 pass / 0 fail）。

- [ ] **Step 5: Lint**

Run: `npx eslint src/core/recommend/queueDeferral.ts`
Expected: 无输出、退出码 0。

- [ ] **Step 6: Commit**

```bash
git status --short
git add src/core/recommend/queueDeferral.ts tests/recommend-algorithm.mts
git commit -m "feat(recommend): extract safe-mode deferral into a pure selector"
```

---

### Task 2: 抽样前的相对质量门槛

**Files:**
- Modify: `src/core/recommend/config.ts`（`softmax` 块，第 227-235 行）
- Modify: `src/core/recommend/diversity.ts`（`selectFinalQueue`，第 220-240 行）
- Test: `tests/recommend-algorithm.mts`（文件末尾追加）

**Interfaces:**
- Consumes: `FinalQueueItem`、`softmaxSample`（同文件）、`recommendationConfig.softmax`。
- Produces: `recommendationConfig.softmax.qualityGateRatio`（number，默认 `0.6`）；`selectFinalQueue` 在每个通道抽样前只保留 `weight >= 该通道最高 weight × qualityGateRatio` 的候选，若过滤后为空则回退到未过滤集合，`FinalQueueSelectionResult` 结构不变。

**背景（来自 spec §3.4 的受控实验）：** 1 首 0.8 分对 10 首 0.2 分时，温度 0.6 只有 21.37% 的概率选中高分候选。门槛的作用是先缩小竞争集合，再在合格候选内保留随机性。

- [ ] **Step 1: 写失败测试**

在 `tests/recommend-algorithm.mts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`cfg.qualityGateRatio` 为 `undefined`（断言 `qualityGateRatio > 0` 失败）。

- [ ] **Step 3: 加配置项**

在 `src/core/recommend/config.ts` 的 `softmax` 块中，把：

```ts
  softmax: {
    temperature: 0.6,
    /** 安全模式（连续负反馈）下降低温度，更偏向高分候选。 */
    safeModeTemperature: 0.35,
    minWeight: 1e-4,
```

改为：

```ts
  softmax: {
    temperature: 0.6,
    /** 安全模式（连续负反馈）下降低温度，更偏向高分候选。 */
    safeModeTemperature: 0.35,
    /**
     * 抽样前的相对质量门槛：同通道内低于最高分 × 该比例的候选不参与抽样，
     * 防止大量低分候选靠数量压过少量高分候选；过滤后为空时回退到未过滤集合。
     */
    qualityGateRatio: 0.6,
    minWeight: 1e-4,
```

- [ ] **Step 4: 在通道抽样前应用门槛**

在 `src/core/recommend/diversity.ts` 中，把 `runChannelLadder`：

```ts
  const runChannelLadder = (channelList: ChannelId[]) => {
    for (let relaxLevel = 0; relaxLevel < relaxConfigs.length; relaxLevel++) {
      const relax = relaxConfigs[relaxLevel]
      for (const channel of channelList) {
        const pool = [...unused].filter(item => item.channels.includes(channel) && checkItemConstraints(item, history, relax))
        if (!pool.length) continue
        return { chosen: softmaxSample(pool, item => weightFor(item, channel), temperature, rng), channel, relaxLevel }
      }
    }
    return null
  }
```

改为：

```ts
  const applyQualityGate = (pool: T[], channel: ChannelId) => {
    const ratio = recommendationConfig.softmax.qualityGateRatio
    if (!(ratio > 0) || ratio >= 1) return pool
    let best = 0
    for (const item of pool) best = Math.max(best, weightFor(item, channel))
    if (best <= 0) return pool
    const gated = pool.filter(item => weightFor(item, channel) >= best * ratio)
    return gated.length ? gated : pool
  }

  const runChannelLadder = (channelList: ChannelId[]) => {
    for (let relaxLevel = 0; relaxLevel < relaxConfigs.length; relaxLevel++) {
      const relax = relaxConfigs[relaxLevel]
      for (const channel of channelList) {
        const eligible = [...unused].filter(item => item.channels.includes(channel) && checkItemConstraints(item, history, relax))
        if (!eligible.length) continue
        const pool = applyQualityGate(eligible, channel)
        return { chosen: softmaxSample(pool, item => weightFor(item, channel), temperature, rng), channel, relaxLevel }
      }
    }
    return null
  }
```

同一文件的兜底分支（`if (!ladder) { ... }` 内）保持原样：兜底本就在所有通道都无合格候选时触发，此时再加门槛只会饿死队列。

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS。重点确认既有的 `offline/no-network degradation`、`exploration gap`、`anti-repeat` 等用例没有被门槛饿死。

- [ ] **Step 6: Lint 与打包**

Run: `npx eslint src/core/recommend/diversity.ts src/core/recommend/config.ts`
Expected: 退出码 0。

Run: `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/phase1-task2.bundle --assets-dest /tmp/phase1-task2-assets`
Expected: 构建成功，退出码 0。

- [ ] **Step 7: Commit**

```bash
git add src/core/recommend/config.ts src/core/recommend/diversity.ts tests/recommend-algorithm.mts
git commit -m "feat(recommend): gate low-score candidates before softmax sampling"
```

---

### Task 3: 锁定结算分类语义（回归测试）

**Files:**
- Test: `tests/recommend-algorithm.mts`（文件末尾追加）

**Interfaces:**
- Consumes: `settlePlayRecord`、`settleExplicitFeedback`（`feedback.ts`，已在测试第 11 行导入）、`RadioPlayRecord`（`types.ts`）。
- Produces: 无新运行时代码。本任务把 spec §6 阶段一“区分普通跳过、明确不喜欢、播放失败和应用退出”固化为断言，后续调整阈值时能立刻发现语义回归。

**背景：** `settlePlayRecord` 已把 `play_error`/`load_error`/`app_destroy` 判为中性（`feedback.ts:129`），短收听判为早切（`:141`），高覆盖判为完整收听（`:157`）。这些分支决定负反馈是否污染口味画像，但当前测试没有逐条锁定。

- [ ] **Step 1: 写测试**

在 `tests/recommend-algorithm.mts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试**

Run: `npm test`
Expected: PASS（92 tests / 0 fail）。这是特征化测试：如果它失败，说明现有分类语义与 spec 假设不符，必须先停下来核对 `feedback.ts` 的实际分支，不要在测试里改断言迁就实现。

- [ ] **Step 3: Commit**

```bash
git add tests/recommend-algorithm.mts
git commit -m "test(recommend): pin settlement classes for skips, failures and app destroy"
```

---

### Task 4: 安全模式覆盖已移交的待播曲目

**Files:**
- Modify: `src/core/recommend/index.ts`（import 第 25 行；字段区第 53-56 行；`maybeEnterSafeMode` 第 738-772 行；`onTrackRemoved` 第 888-890 行）
- Modify: `src/core/recommend/radio.ts`（`registerListeners` 第 131-156 行；`startRadio` 第 158-195 行）
- Test: `tests/recommend-algorithm.mts`（文件末尾追加）

**Interfaces:**
- Consumes: `selectDeferredTrackKeys`（Task 1）、`createRadioQueue().removeMany(keys, token)`（`queue.ts:67`）、`computeSessionHealth`/`buildSessionPenalties`（`sessionHealth.ts`）。
- Produces:
  - `RecommendationEngine.registerPendingProvider(provider: (() => readonly RecommendQueueItem[]) | null): void` — `radio.ts` 注册后，引擎在安全模式判定时把 `provider()` 返回的曲目与内部队列一起检查；传 `null` 注销。
  - `RecommendationEngine.getDeferredView(): { engineQueue: number, handedOff: number }` — 只读诊断，返回上次安全模式判定时两个视图的曲目数。
  - `radio.ts` 在 `registerListeners` 中调用 `registerPendingProvider(() => pending)`、在 `stopRadio` 中调用 `registerPendingProvider(null)`。（`onTrackRemoved` 回调体无需改动：`removeCommittedFromPlayerQueue(trackKey)` 已在 `radio.ts:82-85` 无条件删除 `committedKeys`/`radioTrackKeys`，不存在残留 key 的状态泄漏。）

- [ ] **Step 1: 写失败测试**

在 `tests/recommend-algorithm.mts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npm test`
Expected: PASS。这条测试锁定的是 Task 1 纯函数在“移交后”场景下的语义；引擎接线在 Step 3-6 完成，接线正确性由 Step 7 的诊断断言与真机验证覆盖。

- [ ] **Step 3: 引擎记录待播提供者**

在 `src/core/recommend/index.ts` 第 25 行，把：

```ts
import { buildSessionPenalties, computeSessionHealth, shouldDeferQueuedItem, type SessionHealth } from './sessionHealth.ts'
```

改为：

```ts
import { buildSessionPenalties, computeSessionHealth, type SessionHealth } from './sessionHealth.ts'
import { selectDeferredTrackKeys } from './queueDeferral.ts'
```

在第 53-56 行字段区，把：

```ts
  private lastSafeModeAt = 0
  private lastIdleCrawlAt = 0
  private readonly trackRemovalListeners: Array<(trackKey: string) => void> = []
```

改为：

```ts
  private lastSafeModeAt = 0
  private lastIdleCrawlAt = 0
  private pendingProvider: (() => readonly RecommendQueueItem[]) | null = null
  private lastDeferredView = { engineQueue: 0, handedOff: 0 }
  private readonly trackRemovalListeners: Array<(trackKey: string) => void> = []
```

- [ ] **Step 4: 安全模式同时检查两个视图**

把 `maybeEnterSafeMode`（第 738-772 行）整体替换为：

```ts
  private maybeEnterSafeMode(excludedTrackKey?: string) {
    if (!this.stateReady) return
    const state = getState()
    const health = computeSessionHealth(state.session, new Set(Object.keys(state.dislikedTracks)))
    if (!health.safeMode) return
    const now = Date.now()
    if (now - this.lastSafeModeAt < cfg.sessionHealth.safeModeCooldownMs) return
    const penalties = buildSessionPenalties(state.session, new Set(Object.keys(state.dislikedTracks)))
    const token = this.queue.getVersion()
    const queued = this.queue.snapshot().items
    const handedOff = this.pendingProvider?.() ?? []
    this.lastDeferredView = { engineQueue: queued.length, handedOff: handedOff.length }
    const deferred = selectDeferredTrackKeys([...queued, ...handedOff], penalties, {
      maxDeferrals: cfg.sessionHealth.maxDeferralsPerTrigger,
      excludeTrackKey,
    })
    if (deferred.length) {
      const deferredKeys = new Set(deferred)
      this.queue.removeMany(deferredKeys, token)
      for (const trackKey of deferredKeys) this.served.delete(trackKey)
      this.lastSafeModeAt = now
      for (const trackKey of deferred) {
        for (const listener of this.trackRemovalListeners) {
          try { listener(trackKey) } catch { /** 忽略单个监听器抛出的异常 */ }
        }
      }
    }
    recallLog('safeMode', {
      streak: health.negativeStreak,
      rate: health.negativeRate,
      explorationFactor: health.explorationFactor,
      deferred: deferred.length,
      view: this.lastDeferredView,
    })
    void this.triggerRefresh('safe_mode_supplement', 4).catch(() => {})
  }
```

注意：原实现无论是否撤到曲目都会写 `lastSafeModeAt`，导致一次空撤队后 60 秒内无法再熔断；新实现只在真的撤下曲目时刷新冷却时间。

- [ ] **Step 5: 暴露注册与诊断接口**

把 `onTrackRemoved`（第 888-890 行）替换为：

```ts
  onTrackRemoved(listener: (trackKey: string) => void) {
    this.trackRemovalListeners.push(listener)
  }

  /** radio.ts 注册后，安全模式可以看到已移交给播放器的待播曲目。 */
  registerPendingProvider(provider: (() => readonly RecommendQueueItem[]) | null) {
    this.pendingProvider = provider
  }

  getDeferredView() {
    return { ...this.lastDeferredView }
  }
```

在 `startSession`（第 896-906 行）中，`this.lastSafeModeAt = 0` 之后加一行：

```ts
    this.lastDeferredView = { engineQueue: 0, handedOff: 0 }
```

- [ ] **Step 6: radio.ts 注册待播提供者**

在 `src/core/recommend/radio.ts` 的 `registerListeners` 中，把：

```ts
  recommendationEngine.onTrackRemoved(trackKey => {
    pending = pending.filter(item => keyOf(item) != trackKey)
    removeCommittedFromPlayerQueue(trackKey)
  })
```

改为（只在监听器注册前加一行 `registerPendingProvider`；回调体保持不变——`removeCommittedFromPlayerQueue(trackKey)` 已在 `radio.ts:82-85` 无条件删除 `committedKeys`/`radioTrackKeys`，无需重复清理）：

```ts
  recommendationEngine.registerPendingProvider(() => pending)
  recommendationEngine.onTrackRemoved(trackKey => {
    pending = pending.filter(item => keyOf(item) != trackKey)
    removeCommittedFromPlayerQueue(trackKey)
  })
```

在 `stopRadio` 中，`pending = []` 之后加：

```ts
  recommendationEngine.registerPendingProvider(null)
```

- [ ] **Step 7: 校验引擎接线**

Run: `npm test`
Expected: PASS。

Run: `npx eslint src/core/recommend`
Expected: 退出码 0；特别确认 `shouldDeferQueuedItem` 已从 `index.ts` 移除且没有未使用 import。

Run: `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/phase1-task4.bundle --assets-dest /tmp/phase1-task4-assets && grep -c "registerPendingProvider" /tmp/phase1-task4.bundle`
Expected: bundle 构建成功，`grep -c` 输出 ≥ 2（引擎定义 + radio 调用）。

- [ ] **Step 8: Commit**

```bash
git add src/core/recommend/index.ts src/core/recommend/radio.ts tests/recommend-algorithm.mts
git commit -m "fix(recommend): let safe mode defer tracks already handed to the player"
```

---

### Task 5: 音频特征按真实模型标识隔离

**Files:**
- Modify: `src/core/recommend/audioEmbedding.ts`（`computePlaylistAudioAffinity`，第 103-127 行）
- Modify: `src/core/recommend/audioFeature.ts`（`ModelInfo` 第 23-26 行、`ensureModel` 第 35-64 行、`analyzeTrack` 第 108-118 行）
- Test: `tests/recommend-algorithm.mts`（文件末尾追加）

**Interfaces:**
- Consumes: `AudioEmbedding`、`ObservedPlaylist`（`types.ts`）、`cosine`（`melSpectrogram.ts`）、`dequantizeEmbedding`（同文件）。
- Produces:
  - `audioModelId(inputShape: string, outputShape: string, outputDim: number): string` — 由真实张量形状派生的模型标识，替换写死的 `'musiconn-discogs'`。
  - `computePlaylistAudioAffinity(...)` 新增语义：只统计与品味质心同一 `modelId` 的向量；`minCoverage` 的分母仍为该歌单已获取曲目数，但跨模型样本不计入分子也不计入覆盖。

**背景：** `audioFeature.ts:113` 把 `modelId` 写死为 `'musiconn-discogs'`，而实际模型输出是 `model/Sigmoid` 的 50 维标签分数；`getTasteCentroid` 按多数派模型过滤，但 `computePlaylistAudioAffinity` 对歌单内样本没有做同样过滤，更换模型后旧向量会与新质心做余弦。

- [ ] **Step 1: 写失败测试**

在 `tests/recommend-algorithm.mts` 末尾追加：

```ts
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
```

同时在文件顶部 import 区把第 26 行的：

```ts
import { quantizeEmbedding, dequantizeEmbedding, getTasteCentroid, computePlaylistAudioAffinity, bytesToBase64, base64ToBytes } from '../src/core/recommend/audioEmbedding.ts'
```

改为：

```ts
import { quantizeEmbedding, dequantizeEmbedding, getTasteCentroid, computePlaylistAudioAffinity, audioModelId, bytesToBase64, base64ToBytes } from '../src/core/recommend/audioEmbedding.ts'
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test`
Expected: FAIL，`audioModelId` 未导出（SyntaxError 或 `does not provide an export named`）。

- [ ] **Step 3: 实现模型标识与同代过滤**

在 `src/core/recommend/audioEmbedding.ts` 中，`getTasteCentroid` 之前加：

```ts
/** 模型标识来自真实张量形状与输出维度；换模型或换输出层都会改变标识，旧向量自动失效。 */
export const audioModelId = (inputShape: string, outputShape: string, outputDim: number): string =>
  `in${inputShape.replace(/[^0-9a-zA-Z]+/g, 'x')}-out${outputShape.replace(/[^0-9a-zA-Z]+/g, 'x')}-d${outputDim}`
```

把 `computePlaylistAudioAffinity` 的循环体（第 112-125 行）替换为：

```ts
  const centroidModelId = centroidModel(embeddings, excludeKeys)
  const result: Record<string, number> = {}
  for (const playlist of Object.values(observedPlaylists)) {
    const total = playlist.fetchedTracks.length
    if (!total) continue
    let covered = 0
    let sum = 0
    for (const trackKey of playlist.fetchedTracks) {
      const embedding = embeddings[trackKey]
      if (!embedding) continue
      if (centroidModelId && embedding.modelId != centroidModelId) continue
      covered += 1
      sum += (cosine(dequantizeEmbedding(embedding), centroid) + 1) / 2
    }
    if (covered / total < minCoverage) continue
    result[playlist.id] = Math.max(0, Math.min(1, sum / covered))
  }
  return result
```

并把 `getTasteCentroid` 里挑选多数派模型的逻辑抽成同文件内的 `centroidModel`，供两处共用：

```ts
const centroidModel = (
  embeddings: Readonly<Record<string, AudioEmbedding>>,
  excludeKeys: ReadonlySet<string>,
): string | null => {
  const list = Object.entries(embeddings)
    .filter(([trackKey]) => !excludeKeys.has(trackKey))
    .map(([, embedding]) => embedding)
  if (!list.length) return null
  const countByModel = new Map<string, number>()
  for (const embedding of list) countByModel.set(embedding.modelId, (countByModel.get(embedding.modelId) ?? 0) + 1)
  let majorityModel = list[0].modelId
  let majorityCount = 0
  for (const [modelId, count] of countByModel) {
    if (count > majorityCount) {
      majorityModel = modelId
      majorityCount = count
    }
  }
  return majorityModel
}
```

`getTasteCentroid` 改为调用 `centroidModel` 后再按该 `modelId` 过滤，行为与现状一致（多数派模型）。

- [ ] **Step 4: 写入真实模型标识**

在 `src/core/recommend/audioFeature.ts` 中：

把 `ModelInfo` 与 `ensureModel` 里保存的字段扩展为带标识：

```ts
interface ModelInfo {
  path: string
  outputDim: number
  modelId: string
}
```

`ensureModel` 内成功分支改为：

```ts
          modelInfo = { path, outputDim, modelId: audioModelId(shape.inputShape, shape.outputShape, outputDim) }
          recallLog('audioModelLoaded', { path, modelId: modelInfo.modelId, inputShape: shape.inputShape, outputShape: shape.outputShape })
          return modelInfo
```

并把第 9 行的 import 改为：

```ts
import { quantizeEmbedding, base64ToBytes, audioModelId } from './audioEmbedding.ts'
```

`analyzeTrack` 中写入 embedding 的地方（第 110-115 行）改为：

```ts
    state.audioEmbeddings[job.trackKey] = {
      ...quantized,
      dim: model.outputDim,
      modelId: model.modelId,
      analyzedAt: Date.now(),
    }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test`
Expected: PASS，包括既有的质心与亲和度用例。

- [ ] **Step 6: Lint**

Run: `npx eslint src/core/recommend/audioEmbedding.ts src/core/recommend/audioFeature.ts`
Expected: 退出码 0。

- [ ] **Step 7: Commit**

```bash
git add src/core/recommend/audioEmbedding.ts src/core/recommend/audioFeature.ts tests/recommend-algorithm.mts
git commit -m "fix(recommend): key audio embeddings by real model signature"
```

---

### Task 6: 修复原生推理桥接参数类型

**Files:**
- Modify: `android/app/src/main/java/cn/toside/music/mobile/audioFeature/TfliteModule.java`（`run` 方法，第 81-127 行）

**Interfaces:**
- Consumes: `ReadableArray`（`com.facebook.react.bridge.ReadableArray`）、`Arguments`、`Promise`。
- Produces: `run(String modelPath, ReadableArray input, ReadableArray shape, Promise promise)` — JS 侧签名不变（`nativeAudio.ts:21` 已传 `number[]`），但参数类型改为桥接支持的 `ReadableArray`。

**背景（spec §3.2）：** `JavaMethodWrapper.buildArgumentExtractors` 只支持 `Boolean/Integer/Double/Float/String/Callback/Promise/ReadableMap/ReadableArray/Dynamic`，`float[]` 会抛 `Got unknown argument class: float[]`。JS 侧一直传数组，因此推理在真机上无法成功。

- [ ] **Step 1: 替换方法签名与输入读取**

把 `run` 方法替换为：

```java
  /** input is a flat row-major float array; shape must match the model signature. */
  @ReactMethod
  public void run(String modelPath, ReadableArray input, ReadableArray shape, Promise promise) {
    executor.execute(() -> {
      try {
        Interpreter current;
        int inSize;
        int outSize;
        synchronized (this) {
          if (interpreter == null || !modelPath.equals(loadedModelId)) {
            throw new IllegalStateException("model not loaded: " + modelPath);
          }
          current = interpreter;
          inSize = inputSize;
          outSize = outputSize;
        }
        if (input == null || input.size() != inSize) {
          promise.reject("ESHAPE", "input size mismatch: got "
            + (input == null ? 0 : input.size()) + ", expected " + inSize);
          return;
        }
        int[] dims = new int[shape.size()];
        int expected = 1;
        for (int i = 0; i < dims.length; i++) {
          dims[i] = shape.getInt(i);
          expected *= Math.max(1, dims[i]);
        }
        if (expected != inSize) {
          promise.reject("ESHAPE", "shape mismatch: given shape expects " + expected + ", model expects " + inSize);
          return;
        }
        ByteBuffer in = ByteBuffer.allocateDirect(inSize * 4).order(ByteOrder.nativeOrder());
        for (int i = 0; i < inSize; i++) in.putFloat((float) input.getDouble(i));
        in.rewind();
        float[][] out = new float[1][outSize];
        synchronized (current) {
          current.run(in, out);
        }
        float[] flat = out[0];
        WritableMap result = Arguments.createMap();
        result.putArray("output", toArray(flat));
        promise.resolve(result);
      } catch (Exception e) {
        promise.reject("ERUN", e.getMessage() == null ? "inference failed" : e.getMessage(), e);
      }
    });
  }
```

确认文件顶部已 import `com.facebook.react.bridge.ReadableArray`（`shape` 参数原本就用它，应已存在）；若缺失则补上。

- [ ] **Step 2: 编译原生代码**

Run: `cd android && ./gradlew :app:compileDebugJavaWithJavac`
Expected: BUILD SUCCESSFUL。若报 `cannot find symbol ReadableArray`，补 import 后重跑。

- [ ] **Step 3: 校验 JS 侧未回归**

Run: `npm test`
Expected: PASS（JS 侧无改动，此步防止误改）。

Run: `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/phase1-task6.bundle --assets-dest /tmp/phase1-task6-assets`
Expected: 构建成功。

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/cn/toside/music/mobile/audioFeature/TfliteModule.java
git commit -m "fix(audio): pass TFLite input through ReadableArray so the bridge accepts it"
```

---

### Task 7: 真机验收与诊断清理

**Files:**
- Modify: `src/core/recommend/index.ts`（`getProfileDigest` 第 601-618 行的 TODO 标记，仅在验收通过后处理）
- Modify: `src/core/recommend/radio.ts`（如需临时提高诊断可见性）

**Interfaces:**
- Consumes: `getRadioStatus()`（`radio.ts:227`）、`getAudioFeatureStatus()`（`audioFeature.ts:75`）、`getDeferredView()`（Task 4）。
- Produces: 一份真机验收记录（写入本计划文件末尾的“验收记录”小节），不产生新的运行时代码。

- [ ] **Step 1: 出包前快速校验**

Run: `npm test && npx eslint src/core/recommend`
Expected: 全部通过。

Run: `npx react-native bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/phase1-release.bundle --assets-dest /tmp/phase1-release-assets && grep -c "registerPendingProvider" /tmp/phase1-release.bundle`
Expected: 构建成功，输出 ≥ 2。

- [ ] **Step 2: 构建 arm64 release APK**

Run: `cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`
Expected: BUILD SUCCESSFUL（约 10 分钟）。构建期间不要并行执行第二条 gradle 命令。

- [ ] **Step 3: 核对 APK 是新版**

Run: `ls -l android/app/build/outputs/apk/release/*.apk`
Expected: mtime 晚于本次构建开始时间。旧包会留在同目录，只看文件名会被骗。

Run: `unzip -p android/app/build/outputs/apk/release/app-arm64-v8a-release.apk assets/index.android.bundle | grep -a -c "registerPendingProvider"`
Expected: 输出 ≥ 1（Hermes 字节码可 `grep -a` 命中特征串）。

- [ ] **Step 4: 安装到真机**

先确认设备前台不是其他应用（避免误触），再：

Run: `adb connect <设备IP:端口> && adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk`
Expected: Success。

- [ ] **Step 5: 采集验收证据**

清缓冲后按需轮询（release 包 `__DEV__` 为 false，`recallLog` 静默；需要看日志时临时把相关 `recallLog` 换成 `console.error` 再出包）：

Run: `adb logcat -c`

真机操作场景：
1. 打开个性电台，连续主动切掉 2-3 首不合口味的歌。
2. 观察下一首是否明显换方向，而不是继续同一批预取歌曲。
3. 手动“稍后播放”一首自己的歌，确认它仍排在电台补位曲之前。
4. 点上一首，确认按实际播放顺序后退且不再直接停止。
5. 自然听完若干首后查看 `getAudioFeatureStatus()` 的 `analyzed` 是否增长（Task 5 生效的标志）。

Run: `adb logcat -d | grep -E "recommend|ReactNativeJS" | tail -60`
Expected: 无 `float[]`/`Got unknown argument class` 类桥接错误；安全模式日志的 `view.handedOff` 在移交后不为 0。

- [ ] **Step 6: 记录结果**

在本计划文件末尾追加“验收记录”小节，写明：APK mtime、特征串命中数、每个场景的实际表现、`analyzed` 数量变化、未达标项与下一步。

- [ ] **Step 7: 验收通过后清理诊断代码**

仅在 Step 5 全部达标时执行：删除 `index.ts` 中标记 `TODO 定位后删除` 的 `getProfileDigest()` 及其调用方，并把临时改成 `console.error` 的日志还原为 `recallLog`。

Run: `npm test && npx eslint src/core/recommend`
Expected: 通过。

```bash
git add src/core/recommend/index.ts src/core/recommend/radio.ts docs/superpowers/plans/2026-10-06-recommendation-quality-phase1.md
git commit -m "chore(recommend): record phase 1 device verification and drop diagnostic hooks"
```

若任一场景未达标：不要清理诊断代码，回到 systematic-debugging 重新取证，并在此记录失败现象。

---

## 阶段一之后的入口（不在本计划范围）

- 阶段二：固定音频样本对齐参考实现、分析偏好锚点与少量候选（spec §4.2、§6 阶段二）。
- 阶段三：多兴趣画像、歌曲级统一排序与探索比例（spec §4.3-§4.5）。
- 阶段四：模型升级与外部相似曲数据的收益评估（spec §5、§6 阶段四）。

## 验收记录

（Task 7 Step 6 填写）
