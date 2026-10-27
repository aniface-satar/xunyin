# Wave 8 · Lane B 任务书 —— 推荐与电台终扫尾：来源归因 + 反馈结算 + 踩雷归一 + 相似曲入口

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（B5 待办「画像 M2 剩余细项」「踩雷解析两侧不一致」
> 「onboarding 与更多分页」、W7-3/W7-4）与本文全文。
> 分支 `w8/laneB`，车道起点 = Wave7 三车道并入后的 `main`（core 1105 + app 147 = **1252** 全绿）。

## 0. 起草时点复核（2026-10-27，全部实测；协调会话投用前逐条重跑）

> **协调会话复核（2026-10-27，HEAD `20811f9`）**：#2 结论已漂移（`applyThemeFeedback`
> 其实已实现并接线），#6 文件位置写错。下表已按复核结果修订，任务 2/4 随之改写。

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | `importedOrigins` 仍恒空，w7-A 报告已给最小改动清单（三步） | `data/RadioRuntime.kt:574`（`= emptyList()`）；清单在 `docs/waves/w7-A.md` 遗留节 |
| 2 | `applyThemeFeedback` / `settleExplicitFeedback` **已实现且电台侧已接线**；真正的洞是**发现页主题权重传空表** | `core/recommend/radio/RadioFeedback.kt:334`（`applyThemeFeedback`）、`:373`（`settleExplicitFeedback`）；`RadioBehavior.kt:114,450` 调前、`:317` 调后；`RadioRuntime.kt:926` 传 `engine.state.themeWeights`，而 `SonglistRuntime.kt:232-239` 的 `pickPlaylistTag` 传的是 `emptyMap()` |
| 3 | rankState 的 blocked/hidden **app 侧已有传参**（W5 说「无消费方」可能已过时） | `data/SonglistRuntime.kt:259-260`；core 消费在 `PlaylistRank.kt:117-131`——本任务降级为「核对真机可观测行为 + 补漏」 |
| 4 | 隐藏歌单 UI 已有 `HiddenPlaylistCard` | `ui/radio/HiddenPlaylistCard.kt`——任务 3 第三项降级为对照 RN 查漏 |
| 5 | onboarding 已移植（W5 必做项落了地） | `ui/radio/OnboardingSheet.kt`、`data/OnboardingStore.kt`——本任务降级为对照 RN `onboarding.ts` 核对重置/权重语义 |
| 6 | 踩雷解析两侧不一致：`DislikeRulesParser.parse` 无 `@`→`#` 归一，`PlayerCore.DislikeInfo.key` 有 | **解析器在 `core/recommend/RecommendSignals.kt:26`（无独立文件）**；`core/player/PlayerCore.kt:852`（norm）；`parse()` 无归一 |
| 7 | 电台页队列只展示 6 首预览，「更多」分页第五次挂账 | B5 待办原文；`ui/radio/RadioPage.kt` |
| 8 | 歌单详情缺「相似歌曲」菜单项 | B5 待办（Wave4 Lane C 收口记录）：仍缺 下载/分享/相似歌曲 三项 |
| 9 | 音频特征四件套原生零代码，W7-3 要求「评测口径先落纸」 | `w7-A.md` 任务 7 时间盒未用尽；grep monet/audioFeature 类名无命中 |

## 1. 背景

Wave7 把电台的相似/预算/诊断都接了，画像也滤了本地曲，但还挂着五个「有算法没数据、
有参数没消费、有一侧没归一」的小洞。本车道是推荐线的最后一站：把 W7-4 的归因映射
落地、显式反馈结算闭环、两侧判重统一，再给「相似歌曲」一个真入口。下载/分享两项
**不做**（下载是独立立项，见 §4）。

## 2. 任务

1. **`importedOrigins` 归因闭环**（W7-4）：按 w7-A 遗留清单三步走——
   ① `ListStore.listMusicAdd` 增可选 `origin` 参数，写入曲目 JSON（`meta._importedFrom`
   或顶层，字段形状先对照 RN 有无等价键再定，别自造）；② 「加入列表」调用点
   （`ui/songlist/AddToListDialog.kt`、`AddToMylist.kt`、`SonglistDetailPage.kt`、
   `ui/search/SearchPage.kt`）把来源歌单传进来；③ `RadioRuntime.importedOrigins` 建
   `trackKey → origins` 映射替换 `emptyList()`，`creditImportedOrigins` 生效。
   存量数据（无 origin 的老曲目）行为要保持，迁移不做、记报告。
2. **发现页分类挑选消费 `themeWeights`（M1 收口）**：`applyThemeFeedback` /
   `settleExplicitFeedback` 已在 `RadioFeedback` 实现、电台侧（`RadioBehavior`）已接线，
   **不要重复实现**。真正的断点：`SonglistRuntime.kt:232-239` 的主页歌单分类挑选传
   `emptyMap()`，而电台侧 `RadioRuntime.kt:926` 传 `engine.state.themeWeights`。
   - 把学到主题权重接进发现页挑选（**来源走既有持久化**：权重就在 `RadioState`
     里、由 `RadioStateStore.read()` 落盘，读它或让 `RadioRuntime` 暴露只读都行；
     不要新建存储、也不要塞进 `RecommendProfile` 新字段）；
   - 顺带核对同处 `rankPlaylistsByProfile`（`:252`）与 `rankPlaylistTags` 是否也该吃权重，
     该吃的补上、不该吃的在报告写理由；
   - 单测锁「非空权重改变挑选/排序结果」的数值级行为（core 纯函数已有覆盖，
     补 app 侧或 core 层挑选用例）。
3. **核对批**（复核表 3/4/5 已把三项降级）：blocked/hidden 消费链是否有断点、
   隐藏歌单 UI 对照 RN 查漏、onboarding 对照 RN 核权重/重置语义——发现断点就修，
   修不了记遗留；核对结论一律写报告「语义修正」节。
4. **踩雷解析归一统一**（W5 遗留）：`core/recommend/RecommendSignals.kt:26` 的
   `DislikeRulesParser.parse` 补 `@`→`#` 归一，与 `PlayerCore.DislikeInfo.key`（`:852`）
   对齐（RN 两侧都归一）；加含 `@` 歌名的双侧判重用例。**注意**写侧 `normalize()` 已有
   `@`→`#`，读侧 `parse()` 缺，修读侧即可、别把写侧再改一遍。
5. **「相似歌曲」入口**：歌曲级相似（复用 `m3/Similarity` + `LibraryIndex`，**不含音频**）
   落一个入口（建议：歌单详情行菜单或播放页更多菜单，选择权在你，但 ListDetailPage
   有已知交界——见 §3）。队列「更多」分页与电台队列全量查看：**本波仍不做**，写一条
   「第六次延期」结论进报告（连同理由），了结这条挂账。
6. **音频特征时间盒（可选，W7-3）**：主线 1–5 全收且仍有余力才碰。先落纸评测口径
   （同曲不同版本/翻唱/完全不同曲三组样本的区分度判据），口径没定不许写特征代码。

## 3. 范围（只许改这里）

- `core/src/main/kotlin/cn/toside/music/core/recommend/**`（含 `m3/`、`radio/`）
- `core/src/main/kotlin/cn/toside/music/core/list/`（仅 `listMusicAdd` origin 参数与 schema 写侧；
  **本波 core/list 唯一写入者**）
- `app/.../data/{Radio,RecommendProfile,Songlist,Dislike,SimilarArtist,Hidden,Onboarding,PlayHistory}*.kt`
- `app/.../ui/radio/`、`app/.../ui/songlist/`（AddToListDialog/AddToMylist/SonglistDetailPage/RecommendPanel）
- `app/.../ui/search/SearchPage.kt`（**仅「加入列表」origin 一行**，搜索逻辑/路由禁触）
- `app/.../ui/play/MoreActionSheet.kt`（仅相似歌曲入口可选落点）
- **已知交界**：`ui/list/ListDetailPage.kt` 归 Lane C（W5-9 重构主场）。你若需要行菜单
  加「相似歌曲」一项，**只加一行、先 commit**，集成会话与 C 合流时保留两侧。
- 新增测试放对应包。

## 4. 禁触

- `core/theme/**`、`DefaultSetting.kt`、gradle/manifest、`ui/settings/`（Lane A；本车道不需要新键）
- `ui/list/ListMenuActions.kt`、`lyric/**`、`deeplink/**`、`util/`（Lane C）
- **下载功能**（「下载」菜单项不做——下载立项另议）；音频特征四件套受任务 6 时间盒约束，
  口径未落纸前一个字不写
- 主进度文档只读。

## 5. 验收

- 闸门全绿、1252 只增不减；origin 归因/主题权重挑选/@ 归一全有 JVM 单测（数值级）；
- 真机清单（≥5 条）：导入在线歌单进爱心后诊断卡 `reasons` 出现归因路径、含 `@` 歌名
  踩雷双侧判重一致、相似歌曲入口出候选且不违反「同歌手连推」、**发现页分类随
  喜欢/踩雷后的 `themeWeights` 变化可观测**（不是只在电台页）、隐藏歌单行为对照 RN；
  写进 lane 报告。
- 报告「语义修正」节必须写明：`applyThemeFeedback` 原判「未做」系误判、真实缺口是
  发现页传空表；如判定 `rankPlaylistsByProfile` 不该吃权重，也在此给理由。

## Lane 报告（执行会话追加区）

按 RULES 收尾三步，在此追加：结论 / commit / 触碰文件清单 / 语义修正 / 遗留与真机清单。
