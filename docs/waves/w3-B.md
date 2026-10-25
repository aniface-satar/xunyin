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
