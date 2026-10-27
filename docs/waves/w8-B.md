# Wave 8 · Lane B 任务书 —— 推荐与电台终扫尾：来源归因 + 反馈结算 + 踩雷归一 + 相似曲入口

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（B5 待办「画像 M2 剩余细项」「踩雷解析两侧不一致」
> 「onboarding 与更多分页」、W7-3/W7-4）与本文全文。
> 分支 `w8/laneB`，车道起点 = Wave7 三车道并入后的 `main`（core 1105 + app 147 = **1252** 全绿）。

## 0. 起草时点复核（2026-10-27，全部实测；协调会话投用前逐条重跑）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | `importedOrigins` 仍恒空，w7-A 报告已给最小改动清单（三步） | `data/RadioRuntime.kt:574`（`= emptyList()`）；清单在 `docs/waves/w7-A.md` 遗留节 |
| 2 | `applyThemeFeedback` 未做，core 只有 `themeNetWeight` 部分 | `core/recommend/ThemeFeedback.kt:9` 注释自证 |
| 3 | rankState 的 blocked/hidden **app 侧已有传参**（W5 说「无消费方」可能已过时） | `data/SonglistRuntime.kt:259-260`；core 消费在 `PlaylistRank.kt:117-131`——本任务降级为「核对真机可观测行为 + 补漏」 |
| 4 | 隐藏歌单 UI 已有 `HiddenPlaylistCard` | `ui/radio/HiddenPlaylistCard.kt`——任务 3 第三项降级为对照 RN 查漏 |
| 5 | onboarding 已移植（W5 必做项落了地） | `ui/radio/OnboardingSheet.kt`、`data/OnboardingStore.kt`——本任务降级为对照 RN `onboarding.ts` 核对重置/权重语义 |
| 6 | 踩雷解析两侧不一致：`DislikeRulesParser.parse` 无 `@`→`#` 归一，`PlayerCore.DislikeInfo.key` 有 | `core/player/PlayerCore.kt:852`（norm）；grep `core/recommend/` 无 `@→#` |
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
2. **`themeWeights` 与显式反馈结算**（applyThemeFeedback）：对照 RN `themeFeedback.ts`
   补全净权重结算路径（喜欢/踩雷对主题词的双向作用），core 纯函数 + JVM 单测锁数值。
3. **核对批**（复核表 3/4/5 已把三项降级）：blocked/hidden 消费链是否有断点、
   隐藏歌单 UI 对照 RN 查漏、onboarding 对照 RN 核权重/重置语义——发现断点就修，
   修不了记遗留；核对结论一律写报告「语义修正」节。
4. **踩雷解析归一统一**（W5 遗留）：`DislikeRulesParser.parse` 补 `@`→`#` 归一，
   与 `PlayerCore.DislikeInfo.key` 对齐（RN 两侧都归一）；加含 `@` 歌名的双侧判重用例。
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

- 闸门全绿、1252 只增不减；origin 归因/反馈结算/@ 归一全有 JVM 单测（数值级）；
- 真机清单（≥5 条）：导入在线歌单进爱心后诊断卡 `reasons` 出现归因路径、含 `@` 歌名
  踩雷双侧判重一致、相似歌曲入口出候选且不违反「同歌手连推」、themeWeights 随
  喜欢/踩雷可观测变化、隐藏歌单行为对照 RN；写进 lane 报告。

## Lane 报告（执行会话追加区）

按 RULES 收尾三步，在此追加：结论 / commit / 触碰文件清单 / 语义修正 / 遗留与真机清单。
