# Wave 3 · Lane B 任务书 —— S9 个性化推荐 M1（画像重排，不接 bandit）

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已按 Wave3 快照复核修订**（2026-10-25，协调会话；快照基点 = 含 Lane A 成果的
> main `e6a31aa` 之上的任务书修订提交，见 git log）。
> **验证基线**：`:core` 488 + `:app` 72 = **560** 全绿（协调会话 `--rerun-tasks`
> 强制实测：61 actionable tasks 全 executed，1m39s，failures/errors/skipped 全 0，
> APK 27,865,102 B）。
> 开工自检只许等于或大于这个数。
> 注：Lane A（播控/持久化二轮）已并入本基线，`core/.../player/`（PlayerCore/
> SleepTimer/PlaybackCoordinator/PlayProgressMemory）与 `core/.../setting/SettingsStore`
> 已有改动——你的范围不含这些文件，无冲突面，但回读「画像输入」时 PlayerCore 的
> 公开 API（如 `isPlayedStop`）以当前 main 实现为准。

## 背景与立项依据

进度文档「Wave3 推荐立项输入：引擎解耦评估（Wave2 Lane A）」已定分层：
内容通道与画像引擎可解耦——**M1 先做「纯规则 + 存储」的画像重排**（不接 bandit），
M2 才是 bandit 全家桶，M3 是音频相似/MMR。本 lane 只做 **M1**，M2/M3 一律不做。

M1 边界（评估原话）：`tabSections` 的 `rankPlaylistTags / rankPlaylistsByProfile /
rankTracksByProfile` 输入是普通 Map、边界清楚；依赖约 7 个纯规则文件
（`trackKey`、`artistPrior`、`tokenFeedback`、`feedback`（仅 themeNetWeight）、
`playlistIndex`、`language`（判定字段）、`stateSchema/storage`）。

RN 对照（worktree 内只读，先通读实证再动手）：
- `src/core/recommend/tabSections.ts`、`trackKey.ts`、`artistPrior.ts`、
  `tokenFeedback.ts`、`feedback.ts`、`playlistIndex.ts`、`language.ts`、
  `stateSchema.ts`、`storage.ts`
- `src/screens/Home/Views/Recommend/`（发现页推荐/新歌通道当前如何展示，Wave2 Lane A 已落地）

## 任务

1. **`:core` 新增 `recommend/` 包**：把上面 7 个纯规则文件 + `tabSections` 的三个
   重排函数移植为纯 Kotlin——**输入输出一律普通 Map/List，不引协程以外副作用，
   全部 JVM 单测**；黄金测试对照 RN 行为（同输入同输出），能拿到真实歌单/曲目
   数据时落盘 fixture，拿不到用合成 fixture 并注明。
2. **画像输入**：从原生已有信号取——收藏列表（`ListStore`）、播放历史/个性化曲
   （`PlayerCore` 既有公开 API）。**缺的信号一律不造假**（数据底线）：某依赖
   （如 bandit 反馈、音频特征）在 M1 不接入的，按评估让它走空态/默认 prior，
   并在报告里逐一写明「本波用了哪些真实信号、哪些留空、留空的降级后果」。
3. **接线**：把 `rankPlaylistsByProfile / rankTracksByProfile / rankPlaylistTags`
   接进发现页推荐歌单/新歌速递通道的数据编排层，让官方内容通道的展示顺序按画像微调；
   **不改内容通道本身的取数逻辑与 UI 组件**。
   **实际接入点（2026-10-25 快照核实）**：
   - 文件：`android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SonglistRuntime.kt`
     （`object RecommendRuntime` 与 `SonglistRuntime` 同文件，约 :203 起）；
   - 推荐歌单：`RecommendRuntime.getCuratedPlaylists()` 里
     `CuratedPlaylists(..., page.list.take(count))` 这一行之前做画像重排；
   - 新歌速递：`RecommendRuntime.getCuratedNewSongs()` 里
     `tracks.take(count)` 之前做画像重排；
   - 消费方 `ui/songlist/RecommendPanel.kt:77/89` 只读，**禁改**；
     若重排需要异步/存储加载，允许新建 `data/RecommendProfileRuntime.kt` 作为装配层。
4. **profile 存储**：M1 用到的画像持久层走原生既有 KvStore（对照 RN `storage.ts`），
   键名/形状对齐；新增逻辑配单测。
5. M2/M3 **不移植**：bandit/candidate/queue/audioEmbedding/melSpectrogram/diversity
   等一律不碰；如 M1 接线时发现非改不可的边界，记进报告留给 Wave4，不动手。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`（新建）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SonglistRuntime.kt`
  （**只动 `RecommendRuntime` 的「顺序/重排」相关行**，不动 `SonglistRuntime` 取数部分）
  + 可新建 `data/RecommendProfileRuntime.kt`（画像加载/装配）
- 新增测试与 fixture 放对应包

## 禁触

- 发现页/歌单的**展示 UI 组件**（`ui/songlist/`、`ui/leaderboard/`、`ui/HomePage.kt` 的
  布局行）——只改数据顺序，不改渲染
- `ui/list/`、`ui/search/`、`core/.../music/search/`、`data/SearchRuntime.kt`（Lane C 范围）
- `data/LeaderboardRuntime.kt`、`data/ListRuntime.kt`、`data/SettingsRuntime.kt`（只读调用）
- `player/`、`lyric/`、`ui/settings/`、`ui/play/`、`core/.../setting/`、
  `core/.../music/leaderboard/`、`.github/`、gradle 与版本目录
- `ListStore.kt` / `PlayerCore.kt` 内部（只调用既有公开 API 取信号，禁改）

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- `core/recommend/` 每个纯规则函数有 JVM 单测（含边界：空画像、缺字段、全同分）；
- 三个重排函数有对照 RN 的黄金测试；
- 报告「语义修正」节写明七文件里任何与直觉不符的 RN 行为；
- lane 报告按 RULES 模板追加到本文件末尾并 commit。

## Lane 报告（2026-10-26）

- **结论：完成（M1 画像重排）**。`:core` 新增 `recommend/` 纯规则包 + 画像装配/持久层，
  发现页推荐歌单与新歌速递的排序已接上画像（取数逻辑与 UI 未动）；M2/M3
  （bandit/candidate/queue/audioEmbedding/diversity）未碰。
  开工自检基线 488+72 → 收尾 **core 528 + app 72 = 600 全绿**（+40 个 recommend 用例）。
- **commit**：`564af4d` 纯规则与黄金测试；`961a0c3` 画像装配/持久/信号；`c804d4e` 运行时接线；
  本报告单独一笔。验证：`ktlintCheck test assembleDebug` BUILD SUCCESSFUL，
  APK 27,984,641 B，sha256 `78e0f334a530fe58ceb05e1d254538991dc46772e1a2cb5bff82850526e4d74a`。
- **触碰文件清单**：
  - 新增 `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`：
    `RecommendModels.kt`、`TrackKeys.kt`、`ArtistPrior.kt`、`NameTokenFeedback.kt`、
    `ThemeFeedback.kt`、`PlaylistRank.kt`、`RecommendProfile.kt`、
    `RecommendProfileStore.kt`、`RecommendSignals.kt`、`RecommendSampling.kt`
  - 新增 `android-native/core/src/test/kotlin/cn/toside/music/core/recommend/`：
    `RecommendFactorsTest.kt`、`PlaylistRankTest.kt`、`RecommendProfileTest.kt`
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/RecommendProfileRuntime.kt`
  - 修改 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SonglistRuntime.kt`
    （只动 `object RecommendRuntime` 的排序/分类挑选行，`SonglistRuntime` 取数未动）
  - **越界最小修复（RULES 4，接线必需）**：
    `data/ListRuntime.kt`（+`appContext`、+`Companion.current()`）、
    `player/PlayerRuntime.kt`（+`Companion.current()`）。
    原因：消费方 `ui/songlist/RecommendPanel.kt` 任务书禁改，而 `RecommendRuntime` 是
    无参 `object`，拿不到 `Context`/播放器实例；两处均只加只读访问器，不改既有行为。
- **语义修正与实证发现**：
  1. **JS `\s` ≠ Java `\s`**：RN `normalizeText` 的 `/\s+/g` 含全角空格 U+3000，
     Kotlin 默认只认 ASCII 空白；`TrackKeys` 已改用 `(?U)\s` + `trim{isWhitespace()}`，
     否则「A　B」会粘成一个词（单测 `textNormalizationMatchesRn` 复现过）。
  2. **trimState 的限额归属**：`themeWeightLimit=200` 同时管 `themeWeights` 与
     `tokenWeights`；`artistStats` 用独立的 `artistStatsLimit=800`（RN storage.ts:120-137）。
     初版用例把 200 传给 artistStats，属测试写错，已改断言参数（未删测试）。
  3. **词面学习是降级实现**：RN 用 segmentit 词典分词；Kotlin/JVM 无等价纯 Java 分词，
     按空白切分。后果：中文无空格歌名在 M1 **基本学不到词面**（命不中即因子 1，
     不会误加成）；歌手先验不受影响，是 M1 的主信号。待后续波次引分词后对齐。
  4. **画像存储形状与 RN 不同**：同在 `xunyin_recommend_state_v2` 键下，RN 存原始学习
     状态、Kotlin 存装配好的 `LearnedProfile`；两版数据互不解析（解析失败=空画像重建）。
     原生版与 RN 版本来就不共享存储（B1 决策），键名对齐只为将来统一预留。
  5. **信号真实性与留空**：
     - 用了：收藏 `@list__love`、用户自建歌单（≤20 张）曲目、`@play_history`（解析器就绪）、
       PlayerCore `playedList`（个性电台实时曲目）。
     - `@play_history` 原生尚无写入方 → 当前恒空；`playedList` 无时间戳，按装配时刻计入，
       与历史按「归一化歌名@歌手」去重（历史优先，保真实时间）。
     - 留空：踩雷规则/「不感兴趣」隐藏名单没有原生入口与写入方 → 以空规则调用；
       `themeWeights` 在 M1 无学习来源（RN 由主题级反馈结算）→ 分类排序只吃画像关键词亲和度，
       其中「歌手名关键词 vs 分类名」通常不命中，所以**分类挑选在 M1 大多等于原序**，
       只有风格词（如「国风」）能被分类名命中。这是 M1 边界，不是缺陷。
  6. **playedList 仅个性电台**：PlayerCore 注释明确普通播放不写入 playedList，
     因此它不能当「通用播放历史」用；通用历史要等 `@play_history` 写入方（见遗留）。
  7. **随机源**：RN 卡片取样用 `Math.random`；原生沿用 Wave2 的轮次轮换（可复现），
     `RecommendSampling.pickCardPlaylists` 保留注入式随机源供后续接真随机。
- **真机验收清单（未跑，累计待清账）**：
  1. 收藏某歌手 10 首后进发现页：推荐歌单里该歌手相关卡片前移，卡片集合不变；
  2. 新歌速递前 3 首出现收藏/自建歌单里的常听歌手；
  3. 有画像时下拉刷新：分类选择随画像关键词变化（风格词分类优先）；
  4. 全新安装/清空收藏：两个区块顺序与 Wave2 完全一致（冷启动不过问）；
  5. 清空收藏后重启 App：画像回到空、顺序恢复原序（不残留旧画像）；
  6. 60s 内反复进出发现页/刷新：不重复读列表，无卡顿（内存缓存生效）；
  7. 真机检查 `@xunyin_recommend_state_v2` 有写入且 JSON 可解析（与 RN 同键不互通已在报告说明）。
- **遗留问题与对后续波次的建议**：
  - **M2 立项输入（M1 落地后的真实边界）**：`themeWeights`、显式反馈结算
    （applyThemeFeedback）、踩雷/dislike 原生 provider、隐藏歌单 UI、bandit 候选池与
    audioEmbedding/melSpectrogram/diversity 全部未做；`rankState` 的 `blocked/hidden`
    参数已预留，接上即可生效。
  - `@play_history` 需要原生写入方（播放事件落盘），否则通用历史信号长期为空；
    `playedList` 只能覆盖个性电台。
  - 分词：若要中文无空格歌名的词面学习生效，需引入词典分词或自建停用词/后缀切分，
    属 M2/M3 前置数据工程。
  - RN 的 1500ms 存储防抖在原生是 60s 画像内存 TTL（读多写少，无对应高频写路径）；
    若 M2 引入逐笔结算，需要再补 debounce/flush。
