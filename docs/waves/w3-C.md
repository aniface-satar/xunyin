# Wave 3 · Lane C 任务书 —— S12 歌单搜索（五源 songlist 类型）+ 在线歌单详情二轮

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已按 Wave3 快照复核修订**（2026-10-25，协调会话；快照基点 = 含 Lane A 成果的
> main `e6a31aa` 之上的任务书修订提交，见 git log）。
> **验证基线**：`:core` 488 + `:app` 72 = **560** 全绿（协调会话 `--rerun-tasks`
> 强制实测：61 actionable tasks 全 executed，1m39s，failures/errors/skipped 全 0，
> APK 27,865,102 B）。
> 开工自检只许等于或大于这个数。
> 注：Lane A（播控/持久化二轮）已并入本基线；你范围的 `ui/play/CoverImageLoader.kt`
> 与 Lane A 的 `ui/play/` 其余文件不相交，无冲突面。

## 背景

Wave2 集成记录「遗留问题（Wave3 候选）」第 2、3 条：
- 歌单搜索未做：搜索 tab 的 songlist 类型（RN `core/search/songlist.ts`）。
- 歌单详情未移植：「添加到我的歌单」「多选」；封面图未显示（原生仅有 ui/play 的
  CoverImageLoader 未被复用）。下载/分享/相似歌曲三菜单项依赖未移植的能力，本波**不做**。

RN 对照（worktree 内只读，先实证再动手）：
- `src/core/search/songlist.ts`、`src/store/search/songlist/{state,action}.ts`（各源 action 与聚合）
- `src/screens/Home/Views/Search/SearchTypeSelector.tsx`（类型切换 UI；**提交版只有
  `music` / `songlist` 两档**，与任务范围一致）+ `List.tsx` / `SonglistList.tsx`
- `src/screens/SonglistDetail/`（加入歌单弹层、多选）
- 各源 `src/utils/musicSdk/*/songlist.js` 的 search 方法

> 复核备注：预草稿里的 `SonglistSelector.tsx` **在仓库中不存在**（已改为上表的
> `SearchTypeSelector.tsx`）；RN 工作区里未提交的 singer/album 搜索改动不在本波快照内，
> lane 会话以 worktree 的已提交版本为准。

## 任务

1. **`:core` 歌单搜索五源**（新文件放 `music/search/`，不动既有五源**单曲**文件）：
   传输中立解析（沿用 `SearchRequest` 注入模式），各源分页边界/去重/字段映射
   逐条对照 RN；真实响应落盘 fixture 做黄金测试（不可达改合成并注明）。
2. **app 接线**：`data/SearchRuntime.kt` 扩展歌单搜索编排（可新建
   `SonglistSearchRuntime.kt` 避免和单曲编排纠缠）；搜索页加「歌曲/歌单」类型切换
   （对照 RN 类型选择器，**只加歌单类型，singer/album 本波不做**）。
3. **歌单详情二轮**（`ui/songlist/`）：
   - 单曲「加入我的歌单」+ 「多选」模式（交互对齐 Wave1 用户歌单多选页：全选/
     批量加入，重复跳过去重文案对照 RN「该列表已经有这首歌啦」）；
   - 落库走 `ListStore.listMusicAdd`（加歌位置遵循设置）；
   - 封面显示复用 `ui/play/CoverImageLoader.kt`。**复核结论：该类已是公开
     `object CoverImageLoader`、`load()` 公开，`ui/MiniPlayer.kt:66` 已跨包复用，
     预期本文件零改动**；只需要在详情页头部调用。注意其 LRU 只有 6 张，**只加载
     详情页头图一张**，不要给每行歌单曲目加载封面（会互相挤掉播放页缓存）。
     若确实需要工具方法，改动范围仅限新增公开函数，不动缓存与取图逻辑。
4. **可选（第三优先级，时间够才做）**：为 `listMusicAdd` 落曲目附加时间元数据，
   激活排序空操作档位 `add_time_up/down`（进度文档遗留 6）。动了就把
   「play_count 仍为 0 兜底」写清楚；不做就保持现状。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/music/search/`
  （只新建歌单搜索文件；既有单曲五源与 `SearchAggregator` 只调用不改）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/search/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SearchRuntime.kt`
  （接线）+ 可新建 `SonglistSearchRuntime.kt`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/songlist/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/CoverImageLoader.kt`
  （仅可见性/工具方法扩展）
- `android-native/core/src/main/kotlin/cn/toside/music/core/list/`（仅可选任务 4：
  只许新增方法或加元数据，不改既有方法语义，既有 ListStore 用例不许变红）
- 新增测试放对应包

## 禁触

- 推荐通道数据编排（`data/` 里推荐/SonglistRuntime 的重排行——Lane B 本波独占）；
  `core/.../recommend/`
- `ui/HomePage.kt`、`HomeNavigator.kt`（本波两 lane 都不动；路由不够用记报告）
- `player/`、`lyric/`、`ui/settings/`、`ui/play/` 其余文件、`core/.../setting/`（Lane A 范围）
- `ui/leaderboard/`、`core/.../music/leaderboard/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 歌单搜索每源至少 3 用例 + 黄金 fixture；加入歌单去重/多选批量有 JVM 单测；
- 真机清单（歌单搜索五源观感、类型切换、批量加入、封面显示）写进报告；
- lane 报告按 RULES 模板追加到本文件末尾并 commit。

## Lane 报告（2026-10-26）

- 结论：任务 1-3 完成；可选任务 4（add_time 元数据）未做，保持 play_count/add_time 取 0 的现状。任务 4 不做即按任务书「保持现状」处理，进度文档遗留 6 维持原样。
- commit：`6045982`（core 五源 + fixture）、`7a865be`（app 接线 + 类型切换）、`6ca9a66`（详情二轮 + 批量去重单测）、本报告单独一笔；测试数 **core 518 + app 76 全绿**（基线 488+72，各 +30/+4）；APK 28,075,038 B，sha256 `63d9f2e9533a7c1016569edf174b154930b8cf4e8e4564f59dc9a756c1aeac55`。
- 触碰文件清单：
  - core 新增：`core/.../music/search/SonglistSearchModels.kt`、`SonglistSearchSupport.kt`、`SonglistSearchCoordinator.kt`、`KwSonglistSearch.kt`、`KgSonglistSearch.kt`、`TxSonglistSearch.kt`、`WySonglistSearch.kt`、`MgSonglistSearch.kt`
  - core 测试/资源新增：`core/src/test/.../music/search/SonglistSearchAggregatorTest.kt`、`SonglistSearchCoordinatorTest.kt`、`KwSonglistSearchTest.kt`、`KgSonglistSearchTest.kt`、`TxSonglistSearchTest.kt`、`WySonglistSearchTest.kt`、`MgSonglistSearchTest.kt`；`core/src/test/resources/songlist-search-{kw,kg,tx,wy,mg}.json`
  - app 新增：`data/SonglistSearchRuntime.kt`、`ui/songlist/AddToListDialog.kt`、`ui/songlist/AddToMylist.kt`、`app/src/test/.../ui/songlist/AddToMylistTest.kt`
  - app 修改：`ui/search/SearchPage.kt`（歌曲/歌单切换、歌单结果、页内详情）、`ui/songlist/SonglistDetailPage.kt`（加入/多选/头图）
  - 未改动：`ui/play/CoverImageLoader.kt` 零改动（复核结论成立）；`ui/HomePage.kt`、`HomeNavigator.kt`、既有单曲五源与 `SearchAggregator`、`core/list/` 均未动。
- 语义修正与实证发现：
  | 项 | RN 现状（worktree 提交版实证） | 原生实现 | 说明 |
  | --- | --- | --- | --- |
  | 单源「到底」判定 | `store/search/songlist/action.ts#setList` 只写 list/total/page/limit，**从不写 `maxPages`**；UI 用 `maxPages[source] == page`，单源等于 0，实际永不显示到底 | `SonglistSearchAggregator.single` 按 `total/limit` 推算 `allPage`，`reachedEnd` 用 `maxPage <= page` | 有意修正 RN 的失效判定；单源 total 已知时正常到底 |
  | 聚合页源跳过 | `search()` 在 page>1 时跳过 `page > maxPages[source]`；失败源 catch 成空页后仍由 `setLists` 写 `maxPages=0` | 同条件跳过；失败源按 `emptyPage(id, limit)` 参与聚合，`maxPages` 记 0 | 一致 |
  | 不去重 | `deduplicationList` 导入被注释，单源/聚合都直接拼接 | 聚合器不做 id 去重（仅单曲搜索去重） | 一致；用例 `single does not deduplicate ids` / `all page two appends without deduplication` |
  | limit | 单源 18；`all` 15 且把 15 传给每个源 | 同（`SOURCE_LIMIT=18`、`ALL_LIMIT=15`） | 一致 |
  | 聚合排序 | `handleSortList`：`similar(keyword, item.name)` → `sortInsert` → 整体 `reverse()` | 复刻同一算法与比较插入顺序 | 一致 |
  | total 兜底 | page==1 或 (total && list.length) 用 total，否则 `limit*page`（聚合用 `maxLimit*page`） | 同 | 一致 |
  | 关键词代次 | `key = page__source__text`，响应回来校验 key 不一致返回 `[]` | 缓存 key 同形；代次不符返回 `null`，界面丢弃 | 同语义（空数组 vs null 的表示差异） |
  | 缺 id 条目 | 各源 map 后未显式过滤 id（缺 id 也可进列表） | 五个解析器跳过空 id，避免落库/播放出空 key | 有意收紧，已在解析器 KDoc 记录 |
  | 酷我响应 | 单引号 JS 对象，`objStr2JSON` 转换 | 同规则只替换结构位置的 `'`（保留 `It's` 这类正文撇号） | 用例覆盖 |
  | 酷我播放量 | `formatPlayCount(playcnt)`，小数值仍是字符串（如「566.4万」） | `SonglistUtils.formatPlayCount`，字段保持 String | 一致 |
  | 企鹅重试 | `retryNum > 5` 抛错 ⇒ 最多 6 次；UA=MSIE9 + Referer=y.qq.com | 同 6 次与请求头 | 用例验证 3 次成功/6 次失败 |
  | 网易 eapi | AES-128-ECB；Node `NoPadding` 实测报 `wrong final block length`，PKCS7 服务端返回 code=200 | JCE `AES/ECB/PKCS5Padding`（与既有 `WySearch` 同） | 实测确认，已写 KDoc |
  | 咪咕签名 | md5(keyword + 固定串 + appKey + deviceId + time)，`searchSwitch` 仅开 songlist | 同式，`clock` 可注入便于单测 | 黄金签名用例 |
  | 日期 | `dateFormat('Y-M-D')`：数字按毫秒，字符串 `-`→`/` 后取年月日 | `SonglistSearchSupport.date` 同规则（纯数字→毫秒格式，否则取前 10 位替换） | 酷狗 `2023-01-10 19:31:00` → `2023-01-10` |
  | 搜索页到底 | `maxPages[source] == page`（单源恒 0 ⇒ 永不 end） | `reachedEnd` 用 `maxPage <= page` | 同单源修正 |
- 真机清单（本 lane 未跑，全部待验）：
  1. 搜索 tab 切到「歌单」，五源各搜「周杰伦」：名称/作者/播放量/首数显示正确；「全部」按相似度排序并显示来源标签。
  2. 关键词不变时来回切「歌曲/歌单」，列表各自正确；切源立即重查；翻页到底显示「到底啦~」。
  3. 点歌单行进入详情、返回后仍停在搜索页；详情头图加载，列表行不加载封面（避免挤掉播放页封面缓存）。
  4. 详情滚动分页；「播放全部」进播放页，队列后台补全为整单。
  5. 单曲「加入」：选试听列表/我的收藏/自建歌单；重复曲目提示「该列表已经有这首歌啦」；`list.addMusicLocationType` 的 top/bottom 生效。
  6. 多选：全选/取消全选/批量加入；部分重复提示「已添加 N 首，跳过 M 首重复」，全重复提示「该列表已经有这首歌啦」；「完成」退出多选。
  7. 全程竖屏；不出现横屏布局。
- 遗留问题与对后续波次的建议：
  - **路由缺口**：`ui/HomePage.kt` / `HomeNavigator.kt` 本波禁触，搜索页点歌单改为「页内覆盖 `SonglistDetailPage`」（`detailTarget` 非空时整页替换），不在导航栈里；返回即回到搜索状态，但结果列表滚动位置会重置。下波若允许动 HomeNavigator，可补 `Route.SonglistDetail` 从搜索页推送。
  - **整单导入未移植**：RN 提交版 `SonglistDetail/ActionBar.tsx` 是「整单导入为自建歌单」（`handleImportAsList`，带 source/sourceListId 供更新同步）；本波任务书明确要的是单曲加入 + 多选批量，未实现整单导入，也未改既有「播放全部」。两者语义不同，后续需要拍板是否并存。
  - 下载/分享/相似歌曲三菜单项未移植（依赖能力缺失，任务书明确不做）。
  - 可选任务 4 未做：`add_time_up/down` 仍为空操作，`play_count` 仍取 0 兜底；`listMusicAdd` 未附加时间元数据。
  - 歌单搜索结果为行式（标题/作者/播放量/首数），不是 RN 的封面网格：`CoverImageLoader` LRU 仅 6 张，逐行取图会挤掉播放页缓存；如后续有独立的小图缓存，再换网格。
