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

## Lane 报告（2026-10-25）

- **结论：完成**（任务书全部 5 项）。核心链路：五源歌单标签/列表/详情解析、30 条展示分页、
  发现页「歌单」面板（源/排序/标签/分页列表）与歌单详情页（信息头+分页起播）；
  推荐通道只移植与画像引擎解耦的冷启动官方内容通道（推荐歌单 + 新歌速递）。
  个性化引擎（bandit/audioEmbedding/melSpectrogram 等 46 文件）未移植，见下方解耦评估。
- **commit**：`7810b43`（五源解析+详情分页，core +39 单测）、`dc737cf`（推荐冷启动选择规则，
  core +10 单测）、`0249e1d`（app 装配+UI+6 单测）。
  **测试数 core 433 + app 68 = 501**（基线 446，0 failures / 0 errors / 0 skipped）；
  `./gradlew.bat ktlintCheck test assembleDebug` 全绿；
  `app-debug.apk` = **27,972,574 B**，sha256 `cf969ddc96650c79c44400c09c71d61fbfec466e9e232db9c275d92f6b7ea8d2`。
- **触碰文件清单**：
  - core 主代码（均在 `android-native/core/src/main/kotlin/cn/toside/music/core/songlist/`）：
    `SonglistModels.kt`、`SonglistUtils.kt`、`KwSonglist.kt`、`KgSonglist.kt`、`TxSonglist.kt`、
    `WySonglist.kt`、`MgSonglist.kt`、`SonglistDetailPager.kt`、`RecommendSelection.kt`（后 1 个为新增）
  - core 测试：`core/src/test/kotlin/cn/toside/music/core/songlist/` 下 `Fixtures.kt`、
    `SonglistUtilsTest.kt`、`KwSonglistTest.kt`、`KgSonglistTest.kt`、`TxSonglistTest.kt`、
    `WySonglistTest.kt`、`MgSonglistTest.kt`、`SonglistDetailPagerTest.kt`、`RecommendSelectionTest.kt`
  - fixtures：`core/src/test/resources/songlist-*` 共 27 个（26 个响应 + `songlist-linuxapi-golden.txt`）
  - app：`app/src/main/kotlin/cn/toside/music/nativeapp/data/SonglistRuntime.kt`（新建，含
    `RecommendRuntime`/`CuratedPlaylists`/`CuratedNewSongs`）、`ui/songlist/SonglistPanel.kt`、
    `ui/songlist/SonglistDetailPage.kt`、`ui/songlist/RecommendPanel.kt`（均新建）、
    `ui/HomePage.kt`（仅发现页推荐/歌单分支、路由回调与 `DiscoverSection` 渲染）、
    `HomeNavigator.kt`（仅 `Route.SonglistDetail`）、
    `app/src/test/kotlin/cn/toside/music/nativeapp/data/SonglistRuntimeTest.kt`
  - **未触碰**：`core/.../music/search|leaderboard/`、`ui/search|leaderboard|list|play|settings/`、
    `core/.../list|setting|lyric/`、`userapi/`、`AndroidManifest.xml`、`.github/`、gradle/版本目录；
    Wave1 的 `isDetailSupported` 死分支原样保留。
- **语义修正与实证发现**：
  1. **wy linuxapi 加密**：RN `crypto.js` 用 `ECB_128_NoPadding` 加密 **Base64(JSON) 文本**；
     Base64 长度非 16 倍数时原生层抛 `wrong final block length` 并返回空串。2026-10-25 实测同一
     `api/v3/playlist/detail`：**原始 JSON 字节 + PKCS7 → code 200**；`Base64(JSON)` + PKCS7 →
     code 400。Kotlin 按原始字节 + PKCS7 实现，黄金 fixture 固化（`songlist-linuxapi-golden.txt`）。
  2. **tx 歌单详情**：GET `cgi-bin/musicu.fcg` 直取被 `subcode 4000` 拒；改 **POST
     `uniform_get_Dissinfo`** 后可用。两个响应都落盘（`songlist-tx-detail-blocked.json` /
     `songlist-tx-detail-fallback.json`）。
  3. **kg 歌单详情**：HTML `global.data` 有 30 行，网关批量接口只回 26 条有效 `audio_info`
     （4 条缺字段）。RN 直接 map 会抛异常；Kotlin 跳过不可播条目，`total = list.size`（26），
     并在测试注释记录差异。
  4. **Java 正则差异**：kg 的 `global = {…};` 在 JS 无碍，Java `Pattern` 把裸 `{` 当量词抛
     `Illegal repetition`；已转义并在代码注释注明。
  5. **kw 线上数据怪癖**：`rcm` 的 `total=1753`；`tag 10000` 服务端 `rn=36` 实际只回 35 条
     （总分页仍按 total）；详情 `uname` 形如 uid（`kw3563157520`），RN 原样透传。
  6. **wy 音质尺寸**：flac 尺寸取 `sq.size`（无损条目），格式化为 `29.62 MiB` 等；缺字段输出
     `JsonNull`。`###` cookie 归一为 `MUSIC_U=<token>`（RN 直接把整串当 Cookie 头）。
  7. **详情分页扩展**：RN `getListDetailLimit` 只在顺序翻页时成立，跳页（深链/首屏恢复）会丢掉
     前一页的 `sourcePage` 记账；Kotlin `SonglistDetailPager` 从最近的已加载展示页续拉补齐，
     并把 tempList 拼接页的 `sourcePage` 记为当前源页，避免重复请求。展示页缓存统一写
     `limit=30`，`maxPage` 与 RN `setListDetail` 一致。
  8. **列表 total 兜底**：RN `songlistActions.setList` 在翻页空响应/无 total 时用
     `limit * page`；`SonglistRuntime.reachedEnd` 同规则（app 单测覆盖）。
  9. **推荐冷启动等价**：RN `pickPlaylistTag` 无画像时等价于 `ranked[rotation % size]`；
     `pickPlaylistSort` 以 `name + tid` 匹配 hot；`pickNewSongBoard` 新歌组优先、组内取名字最短
     （「新歌榜」3 字 <「网红新歌榜」5 字 <「ACG新歌榜」6 字，按字符数而非视觉宽度）。
     RN 用 `shuffledSources + Math.random`，Kotlin 改**轮次轮换**（可复现），代价是同一进程内顺序固定。
  10. **路由形状**：`PlaylistItem.id` 是各源本地 id（kw `digest-8__x`、kg `id_…`），不带源前缀；
     Kotlin 路由显式存 `SonglistDetail(source, id, title)`，避免 RN `source__id` 复合键的拆分歧义。
- **推荐引擎解耦评估（Wave 3 立项输入）**：
  - **本波已落地的可解耦通道**：官方分类目录（`getTags`）+ 最热排序挑分类 + 取第一页；
    新歌速递（静态榜单表挑新歌/飙升榜 + 榜单第一页）。两通道只需五源 songList/leaderboard
    接口，不读写画像。
  - **可拆成「纯规则 + 存储」的最小可行子集（建议 Wave 3-M1）**：`tabSections` 的
    `rankPlaylistTags / rankPlaylistsByProfile / rankTracksByProfile` 输入是普通 Map，边界清楚；
    依赖文件约 7 个：`trackKey`、`artistPrior`、`tokenFeedback`、`feedback`（仅 themeNetWeight）、
    `playlistIndex`、`language`（判定字段）、`stateSchema/storage`。先做「推荐歌单/新歌按画像重排」，
    不接 bandit，仍可用 JVM 单测覆盖。
  - **必须连引擎的部分（Wave 3-M2）**：电台/探索 = `bandit + candidate/candidatePool/queue/
    requestPolicy/sessionHealth/listening` 全家桶；音频相似（`audioEmbedding/melSpectrogram/
    nativeAudio`）与 MMR（`diversity/similarity`）建议最后做（Wave 3-M3），需要 native 方案评审。
  - **语种配额（`languageQuota/language`）**只影响电台补货，不影响本波内容通道；五源逐曲语种
    字段知识已在 RN 实测中确认（kg/tx 有 L1，kw/wy/mg 只能靠分类 L2）。
  - **本波保持空态、绝不造假**：电台卡片、探索卡片、画像重排、「不感兴趣」、onboarding、
    「更多」分页均未移植；取不到内容时显示失败/空态文案。
- **真机清单（本 lane 未执行，避免与并行车道抢同一设备；交集成后统一跑）**：
  1. 发现→歌单：五源各切一次；排序横滑可点；标签横滑（全部/热门/分组）切换后列表回到第 1 页。
  2. 列表滚动到底触发下一页；换源后排序回首档、标签回「全部」；断网显示错误与重试。
  3. 点歌单进详情：名称/作者/播放量/简介显示；30 条/页滚动加载；底部出现「到底啦~」。
  4. 详情「播放全部」进播放页；队列最终长度等于整单；点第 N 首从该首起播；返回逐级退。
  5. 发现→推荐：推荐歌单 6 张、新歌速递 3 首；「换一批」两次应换源/分类；点卡片进详情、
     点新歌起播（临时列表链路）。
  6. 竖屏全程；三 tab 详情栈互不干扰（Wave1 行为不回归）；记录每源首屏条数与可播性。
- **遗留问题与对后续波次的建议**：
  - 搜索 tab 的歌单搜索（RN `core/search/songlist.ts`）按任务书本波不做，留给后续。
  - 未接的 id/入口：kw digest-13（专辑歌单）、kw 用户歌单/BD；kg 纯数字/酷狗码、用户歌单
    （infSign）；tx playsquare 与短分享链接（需跟重定向）；wy 单段 `playlist/<id>` 链接（需跟重定向）。
    这些入口在 Kotlin `normalizeId` 一律**显式抛错**（界面显示加载失败），不会请求错误 URL。
  - 详情页未移植：RN「添加到我的歌单」「多选」「更多菜单（下载/分享/相似歌曲）」；封面图未显示
    （原生壳暂无联网图片加载器，本波不改 gradle）。建议在 Lane C/播放器菜单批次统一接。
  - 推荐未移植：电台/探索、画像重排、不感兴趣、onboarding、歌单「更多」分页。
  - RN 侧建议修：`linuxapi` 的 NoPadding+Base64 实现（服务端会拒）；kg 网关缺失 `audio_info`
    时 RN 会抛异常；`getListDetailLimit` 跳页缓存丢失。
  - `:app` 单测是纯 JVM（无 Robolectric），UI 行为只做到编译级验证；真机项以上清单为准。

