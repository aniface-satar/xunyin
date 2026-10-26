# Wave 6 · Lane A 任务书 —— 推荐 M3 供给层接线（让 Wave5 的规则真生效）

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（Wave5 遗留清单 W5-1~W5-3）与本文全文。
> 分支 `w6/laneA`，车道起点 = `main` 的 `1a837fd`（core 883 + app 111 = 994 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | 选曲点仍在用 **M2** 的 `RadioSelection.select` | `core/.../recommend/radio/RadioEngine.kt:360`（`generateQueue` 内） |
| 2 | M3 的 `Diversity.select` **零调用方**，只有测试在调 | 全仓 grep：`Diversity.select` 仅出现在 `Diversity.kt` 与 `DiversityTest` |
| 3 | `PoolCandidate.lang / langLevel / langHint` **零生产方** | `RadioModels.kt:164-167` 有字段；全仓 grep 无 `lang =` 赋值（除 m3 内部比较） |
| 4 | `FinalQueueItem` 同样有 `lang / langLevel / langHint`，同样零生产方 | `RadioModels.kt:210-214` |
| 5 | 语种四级判定链已实现且带测试，但只被自己的用例调用 | `m3/Language.kt`：`bucketFromLangField`(:145) / `bucketFromScript`(:194) / `bucketFromLyric`(:237) / `resolveLang`(:346) |
| 6 | 配额算术已实现：`computeLangTargets(weights, windowSize)` → `LangTargets`；`computeLangCaps` / `computeLangCapsForBatch(targets, recentLangs, batchSize, …)` | `m3/LanguageQuota.kt:93 / 141 / 163` |
| 7 | 池子裁剪两件套只移植未接线 | `computeBucketDetailReserve`(:239) / `computePoolBucketLimits`(:255) |
| 8 | `Diversity.Options` 要的两个回调都已留好注入点 | `Diversity.kt:127`（`langCaps` / `mmrLambda` / `timeSlotFactor` / `explorationGap`） |
| 9 | 时段亲和度已实现，输入是 `List<RadioPlayRecord>` | `m3/TimeSlot.kt:56` `computeAffinity(radioHistory, now, zone, config)` → `Affinity.factorFor(List<String>)` |
| 10 | 问卷净权已在 `RadioState.onboardingWeights`（Wave5 播种后的值） | `RadioState.kt` + `RadioEngine.applyOnboarding`(:165) |
| 11 | 歌手语言表在 **app 侧**（`ArtistLangStore`），core 拿不到 | `app/.../data/ArtistLangStore.kt`（Wave5 建） |
| 12 | 通道 E 已是「后台单飞刷新 + `drainBuffered()`」，首批队列必然没有 E | Wave5 Lane A 报告 + `app/.../data/SimilarArtistRuntime.kt` |

**起草结论**：Wave5 把 M3 的**规则**写完了，但**供给**（语种字段）与**消费**（选曲器）两头都没接。
本车道就是把这两头接上，不改规则算术本身（`Diversity` / `Language` / `LanguageQuota` 的
既有断言一条都不许改口径；除非实证发现算术 bug，那要单列语义修正）。

## 1. 任务

1. **语种字段生产链路（先做，纯函数可测）**
   - 在 `:core` 里把「一首候选如何定出语种」封装成一个可注入的解析器（建议
     `core/recommend/radio/CandidateLang.kt`）：
     - L1：`source` 是 `kg`/`tx` 时走 `Language.bucketFromLangField`（注意 `Number('')===0`
       的坑，空串必须拦在码表前——`Language.kt` 里已有拦截，别在调用侧绕过）；
     - L2：整批候选的 `langHint`（桶召回/歌单标签带来的提示）；
     - L3：歌手语言表（歌手键 → `ArtistLangEntry`），由调用方以
       `artistLang: (String) -> LangBucket?` 形式注入，**core 不许依赖 app**；
     - L4：`Language.bucketFromScript` 字面统计（**L4 不判 en**，只有歌词拉丁占比
       ≥0.8 才判 en，规则写在 `Language.kt` 注释里，照用不要重写）。
     产出 `(lang, langLevel)`，一并写进 `PoolCandidate` 与后续 `FinalQueueItem`。
   - 候选人选池的三条构建路径都要覆盖：`RadioCandidates.createArtistCandidates` /
     `createPlaylistCandidates` / `createDiscoveryCandidates`（Wave5 新加），以及
     `RadioEngine.buildRecentSelectionItems`（历史项也要有 `lang`，否则 MMR 的语言项与
     连播规则全瞎）。
   - app 侧把 `ArtistLangStore` 的查询以 lambda 注入（`RadioRuntime` 装配点），失败/缺表
     一律返回 null（降级到 L4）。

2. **`Diversity.select` 替换选曲点**
   - `RadioEngine.generateQueue` 的选曲调用改为 `Diversity.select(finalItems, Diversity.Options(...))`，
     注入：
     - `langCaps = LanguageQuota.computeLangCapsForBatch(LanguageQuota.computeLangTargets(state.onboardingWeights), recentLangs, batchSize = target, …)`；
       `recentLangs` 取「最近窗口的 `FinalQueueItem.lang`」（注意 `windowSlice` 的 `slice(-0)` 坑在
       Kotlin 侧已夹紧，直接用现成函数）；
     - `mmrLambda = Diversity.DEFAULT_MMR_LAMBDA`（除非任务书后续要求可配）；
     - `timeSlotFactor = TimeSlot.computeAffinity(state.radioHistory, now).factorFor`（`sampleSize` 不足时该函数
       自带 1.0 降级，不要另写判断）；
     - `explorationGap` 沿用 `SessionHealthLogic.resolveExploration` 的结果（与 M2 一致）。
   - `RadioSelection`：**不许直接删**。先在 lane 报告里实证它与 `Diversity.select` 的差异清单，
     再决定「保留为 @Deprecated 参照实现」或「删除 + 用例迁移」。无论哪种，
     `RadioSelectionTest` 的 12 条断言**不许消失**——要逐条对应到 `Diversity` 的语义上（可改用例名，
     不许删除覆盖面）。若某条 M2 语义被 M3 有意取代（例如语种硬配额），改成新语义的断言并
     在 lane 报告里写清楚「哪条被谁取代」。
   - 选曲原因要能让真机看见：`reasons` 里必须能读出 `lang_quota_relaxed` / `relax_level_N` /
     `no_candidate_after_relaxation`（`Diversity` 已产出，确认落到 `RadioSummary` 或日志里）。

3. **池子裁剪接线（W5-2 的后半）**
   - 把 `countPoolLang` + `computePoolBucketLimits` 接进候选池维护（`RadioPool` 的补池/淘汰路径）：
     池子超过上限时按语种配额**优先淘汰超配额语种的最旧候选**，而不是简单 FIFO。
   - `computeBucketDetailReserve` 接进「详情额度」分配点（若当前没有详情额度概念，就接在
     候选抓取的 detail budget 上；找不到落点就在报告里写明并保持不接线，**不要硬造概念**）。

4. **通道 E 首屏供货（W5-3，可降级项）**
   - 目标：首屏队列也可能含 E。做法在以下两种里选一种并说明理由：
     a) `startSession` 后第一次取曲前 `await` 一次相似歌手 refresh（**硬上限 2.5 s**，超时照常出歌）；
     b) 保留现状（首批无 E），但把 `SimilarArtistRuntime` 的上一会话缓存作为首屏补给。
   - 无论选哪种，**取曲延迟预算不能被吃掉**：现有 `fetchSimilarArtist` 返回 0 requests 的约定不变。

5. **用例（本车道的验收主体）**
   - 新增：语种解析链（L1~L4 各自命中 + 都判不出返回 null 的降级）、候选人构建后 `lang` 落位、
     历史项 `lang` 落位、`langCaps` 注入后「华语 100%」与「华语 0%」的队列语种分布差异、
     时段因子生效（同候选不同 `factorFor` 时选中概率变化可用固定种子序列验证）、
     池子按语种淘汰的顺序。
   - 迁移：`RadioSelectionTest` 12 条。
   - 端到端：`RadioW5EndToEndTest` 那 3 条要继续绿；再加一条「问卷答『华语 100%』→ 取 20 首 →
     华语占比 ≥ 目标八成」的集成用例（RNG 固定种子）。

## 2. 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/**`（radio + m3）
- `android-native/core/src/test/.../core/recommend/**`
- `android-native/app/.../data/RadioRuntime.kt`（装配与注入）
- `android-native/app/.../data/RecommendStores.kt` / `ArtistLangStore.kt`（只读查询入口增强）
- `android-native/app/src/test/.../data/**`（新增用例）

## 3. 禁触

- `ui/radio/*`、`ui/songlist/*`（UI 已定型，本波不改界面）
- `core/music/search/**`、`ui/search/**`（Lane B 范围）
- `player/**`、`ui/share/**`、`AndroidManifest.xml`、`data/LocalMusicRuntime.kt`（Lane C 范围）
- `ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`、`gradle/` 与版本目录、`.github/`
- **不许改 `Diversity` / `Language` / `LanguageQuota` 的既有算式**（只允许修实证到的真 bug，
  且必须在报告里单列一条语义修正）

## 4. 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿（Windows 下
  `GRADLE_USER_HOME=E:/GradleHome ./gradlew ...`）；
- 每条新规则都有 JVM 单测；随机一律通过 `rng: () -> Double` 注入，测试固定种子；
- lane 报告必须含：
  1. **语种供给映射表**（L1/L2/L3/L4 各自的输入、命中率预估、判不出时的行为）；
  2. `RadioSelection` → `Diversity` 的**差异对照表**与 12 条用例的迁移去向；
  3. 池子裁剪的淘汰规则与为什么这样淘汰；
  4. 通道 E 首屏方案选择与首曲延迟实测（JVM 侧只能给「有没有阻塞」的证明，真机数字留给用户）；
  5. 真机清单（见下）。
- 真机清单至少覆盖：问卷「华语 100% / 0%」各一轮看语种分布与 `reasons`；`getSummary()` 里
  `channelShare` 的 C/E 非 0；连播 30 首看「同歌手连推」是否比 Wave5 更少（MMR 生效）；
  时段切换（早/晚）各一轮看同一歌手的命中是否变化；音质/播放链路回归（选曲器换了，播放不该变）。

## 5. 已知风险（写进报告，不许掩盖）

- 语种判定 L1 只覆盖 `kg`/`tx`，`kw`/`wy`/`mg` 只能靠 L3/L4 —— 配额在 kw 为主的池子里可能兑现不了，
  这属供给不足，不是选曲 bug。
- `Diversity` 的「末档不把同歌手间隔归零」会让候选枯竭时队列比 M2 更短（`no_candidate_after_relaxation`），
  属**有意行为**，真机上看到队列变短先查这个原因。
- M3 的 `explorationGap` 与 M2 的探索间隔语义不完全一致（M2 用 streak，M3 看窗口内是否有探索曲），
  接的时候要确认不是「两个间隔叠加」，否则 C/D 通道会被双重限制。
