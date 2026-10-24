# Wave 2 · Lane A 任务书 —— S6 在线歌单五源数据 + 发现页推荐内容通道

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **派发版**（2026-10-25 按 Wave1 合并后快照修订；Wave1 三车道已全部并入 main）。

## 开工基线（实测，2026-10-25）

- 波前快照 = 本文件所在提交（主仓库 HEAD；Wave1 收口提交为 `47be7e0`）。
- `cd android-native && gradlew.bat ktlintCheck test assembleDebug`（强制真跑）
  → `:core` **384** + `:app` **62**（合计 **446**）全绿，failures/errors/skipped 全 0，
  `app-debug.apk` = **27,602,811 B**。
- 测试数只会等于或大于 446；变少 = 有人删测试，停下报告。

## 背景

B5 第六切片的发现页只提供「推荐 / 排行榜 / 歌单」导航壳与空态。排行榜已在 Wave 1 收口：
`data/LeaderboardRuntime.kt` 里 tx/wy/mg 已接入（`TxLeaderboard/WyLeaderboard/MgLeaderboard`
在构造表里，`DETAIL_SOURCES` 含各源），**本 lane 不要动排行榜**。
本 lane 补在线歌单数据链路，并评估推荐通道。

RN 对照（worktree 内只读，统一以 **HEAD 版本**为准）：
- `src/core/songlist.ts`、`src/screens/Home/Views/SongList/`（tag 目录、分页、详情）、
  `src/screens/SonglistDetail/`（歌单详情→起播）、各源 `src/utils/musicSdk/*/songList.js`
  （kw/kg/tx/wy/mg 五源文件均在）——**先通读并实证各源请求链，再动手**
- `src/core/recommend/`（46 文件个性化引擎）与 `src/screens/Home/Views/Recommend/`

**源表事实**：Kotlin 侧只有 kw / kg / tx / wy / mg 五源（`SearchRuntime.SOURCES`），
RN 的 `bd` 不在移植范围，任务里说的「五源」即此五源。

**RN 工作区脏文件提示（不要照抄）**：主仓库 `src/` 有未提交的 album/artist 改动——
`src/core/songlist.ts` 多了 `isAlbumListId` 分支，五个源的 `index.js` 多了 album/artist
注册。这些改动**不会出现在 worktree 里**，且不属于本波范围：只按 HEAD 版 `songlist.ts`
与 `songList.js` 的 songList 链路移植。

## 任务

1. **`:core` 在线歌单**（新包 `songlist/`）：五源 tag 清单、歌单分页列表、歌单详情
   （歌曲分页）的传输中立移植——照 `music/search/` 的 `SearchRequest` 注入模式，
   解析规则纯 JVM 可测；真实响应落盘 fixture 做黄金测试
   （接口不可达改合成 fixture 并在测试类注释与报告里注明）。
2. **app 组装**：`data/SonglistRuntime.kt`（HttpURLConnection 传输 + core 编排），
   对外形状对齐 `LeaderboardRuntime` 的用法（`boards/board/getListDetail/reachedEnd`）。
3. **UI**：发现页「歌单」面板（源选择 + tag 横滑 + 分页网格/列表）与歌单详情页
   （`HomeNavigator.Route.SonglistDetail` 路由）；起播沿用排行榜的临时列表链路
   （`ListStore.listMusicOverwrite(TEMP)` → `playListById(TEMP)` → 后台补全），
   不新建第二套播放入口。
   - 现有锚点：`ui/HomePage.kt` 的 `DiscoverSection.SONGLIST` 分支（约 259-292 行，
     `DiscoverPlaceholder("在线歌单内容暂未接入")` 为占位）；`HomeNavigator.kt` 的
     `Route` sealed interface（约 16-25 行，已有 `ListDetail` / `LeaderboardDetail`）。
4. **推荐通道（有限度）**：只移植 RN 推荐中**不依赖个性化引擎**的官方内容通道
   （tabSections/channels 里的静态分类、官方推荐歌单拉取等，能解耦多少做多少）。
   **bandit/audioEmbedding/melSpectrogram 等引擎本体本波不移植**——在 lane 报告写
   「引擎解耦评估」：哪些键/通道可先行、引擎最小可行子集边界在哪，供 Wave 3 立项。
   解耦不了的部分保持空态，不许造 RN 没有的假数据。
5. 搜索 tab 的歌单搜索（RN `core/search/songlist.ts`）本波**不做**，写进遗留。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/songlist/`（新建）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SonglistRuntime.kt`（新建）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/songlist/`（新建）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/HomePage.kt`
  （只许改发现页推荐/歌单面板相关行；Wave1 遗留的 `isDetailSupported` 死分支不许顺手删）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/HomeNavigator.kt`
  （只许加 `Route.SonglistDetail` 相关行）
- 新增测试与 fixture 放对应包

## 禁触

- `core/.../music/search/`、`core/.../music/leaderboard/`、`ui/search/`、`ui/leaderboard/`
- `ui/list/`、`core/.../list/`（Lane C 范围；`ListStore.listMusicOverwrite` 只调用不改）
- `ui/play/`、`ui/settings/`、`core/.../setting/`、`core/.../lyric/`、`userapi/`
- `AndroidManifest.xml`（本 lane 不需要新权限）、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿，
  测试数 ≥ 446（`:core` ≥384 + `:app` ≥62）；
- 歌单五源解析每源至少 3 用例 + 黄金 fixture；发现页「歌单」面板真机清单写报告；
- lane 报告含「推荐引擎解耦评估」节；按 RULES 模板追加到本文件末尾并 commit。
