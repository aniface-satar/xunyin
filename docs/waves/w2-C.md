# Wave 2 · Lane C 任务书 —— S7 歌单批量操作与排序菜单（B5 遗留收口）

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **派发版**（2026-10-25 按 Wave1 合并后快照修订；Wave1 三车道已全部并入 main）。

## 开工基线（实测，2026-10-25）

- 波前快照 = 本文件所在提交（主仓库 HEAD；Wave1 收口提交为 `47be7e0`）。
- `cd android-native && gradlew.bat ktlintCheck test assembleDebug`（强制真跑）
  → `:core` **384** + `:app` **62**（合计 **446**）全绿，failures/errors/skipped 全 0，
  `app-debug.apk` = **27,602,811 B**。
- 测试数只会等于或大于 446；变少 = 有人删测试，停下报告。

## 背景

B5 待办遗留：「默认列表的『随机播放/收藏全部』等批量操作与排序菜单」。
**波前实证修正**：RN 列表页并没有「随机播放」「收藏全部」这两个菜单项——
`play_list_random` 是播放页的播放模式按钮（Kotlin `PlayerState` 已有），
全仓 grep 无「收藏全部」。RN `src/screens/MylistDetail/index.tsx:163-235` 的列表
操作条只有两个动作：**多选** 与 **排序**（多选态下排序按钮 disabled）。
所以本 lane 的范围按 RN 实际实现收口为：**排序菜单** + 列表级菜单的逐项盘点，
不要实现 RN 没有的菜单项。

Wave 1 已落地多选批量删除/移动与拖拽排序（B5 第五切片）；Kotlin
`ui/list/ListDetailPage.kt` 目前只有「多选」与「播放全部」（约 157 / 171 行），
没有任何排序入口。

RN 对照（worktree 内只读，先通读实证再动手）：
- `src/screens/Home/Views/Mylist/MyList/ListMusicSort.tsx` + `utils.ts`
  （排序弹窗与比较规则）
- `src/screens/Home/Views/Mylist/MyList/ListMenu.tsx`（列表级菜单：
  new / rename / sort / duplicateMusic / local_file / sync / import / export / remove，
  `src/store/Mylist/MyListAction.ts` **不存在**，操作实现在
  `src/screens/Home/Views/Mylist/MyList/listAction.ts`）
- `src/screens/MylistDetail/index.tsx`（操作条与自定义排序模式的入口）

**排序档位实测（9 项 + 自定义）**：`name`（文案是「标题」）、`album`（专辑（音轨））、
`duration_up`、`duration_down`、`add_time_up`、`add_time_down`、`singer`、`year`、
`play_count`；`custom`（自定义排序）只在有 `onCustomSort` 时出现。
比较规则在 `utils.ts`：`compareString` 用 `localeCompare(b, localeId)`
（`localeId` 的 `_` 先换成 `-`，null 排最前）；`album` 先专辑名再歌名；
`duration` 解析 `mm:ss` 且 `interval == null` 的排最前/最后；`year` 从
`meta.releaseDate` 前 4 位取，无年份排最后；`add_time_up/down` 与 `play_count`
分别读 `@music_add_time` / `@music_play_count`。

**数据前提（必须先实证）**：Kotlin 只在 `core/.../storage/StorageKeys.kt:56-57`
定义了 `MUSIC_ADD_TIME` / `MUSIC_PLAY_COUNT` 两个键名，**全仓没有读写者**；
`DataRepository` 也没有通用 KV getter。若在禁触范围内拿不到这两个键：
按 0 兜底（JS 排序稳定 ⇒ 保持原相对顺序），在 lane 报告登记
「`add_time_*` / `play_count` 数据缺口：生产者未移植」。不要为排序去改禁触文件。

## 任务

1. **排序菜单**：歌单详情页加「排序」入口（位置对照 RN 操作条，与「多选」并列；
   多选态下 disabled）——档位与比较规则逐条对照 RN `utils.ts`。
   字符比较注意 RN 用 `localeCompare`：先实证 Kotlin/Java 的对照实现
   （`Collator` vs 平台 `String.compareTo`），结论与锁定用例写报告。
   排序结果通过 `ListStore.listMusicUpdatePosition`（已存在）落库；
   如确缺原子能力，允许在 `core/.../list/ListStore.kt` **新增方法**，不改既有语义，
   配 JVM 单测。
2. **自定义排序选项**：RN 的 `custom` 档进入拖拽模式，与多选态**互斥**
   （排序按钮在多选态 disabled）。Kotlin 现有拖拽只在多选编辑态可用——
   实证 RN 后决定：把「自定义排序」映射到现有拖拽模式（可从排序弹窗直接进入），
   结论写进报告。若需要拆分「多选」与「拖拽」两个模式，改动限 `ui/list/`。
3. **列表级菜单（逐项盘点，不扩权）**：对照 RN `ListMenu.tsx` 的 9 项，逐项标注
   Kotlin 现状与可做性（新建/重命名/删除已在首页；导入导出/local_file/sync 属 B6/B7
   或缺失能力）。本波至少把「排序」接进同一入口；不可做项写「遗留问题」，
   **不许实现 RN 没有的菜单项**，也不许为凑菜单造空动作。
4. 所有新增纯规则（排序比较、档位映射）放 `:core`（新文件，如
   `core/list/MusicSort.kt`），JVM 单测 + 边界用例（空列表、同名单元、脏字段、
   缺失专辑/时长/年份、中文与英文混排）。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/list/`（整个目录）
- `android-native/core/src/main/kotlin/cn/toside/music/core/list/`
  （既有 `ListStore.kt` 只许新增方法；新文件如 `MusicSort.kt`）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/ListRuntime.kt`
  （只加转发方法）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`ui/songlist/`、`core/.../songlist/`（Lane A 范围）
- `ui/play/`、`lyric/`、`AndroidManifest.xml`、`core/.../setting/DefaultSetting.kt`
  （Lane B 范围）
- `app/.../player/`、`core/.../player/`（只调用既有公开 API）
- `ui/search/`、`ui/leaderboard/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿，
  测试数 ≥ 446（`:core` ≥384 + `:app` ≥62）；
- 排序比较规则有 JVM 单测（含与 RN `localeCompare` 差异的锁定用例）；
- 新增 ListStore 方法有单测；真机菜单项清单写进报告；
- lane 报告按 RULES 模板追加到本文件末尾并 commit。

---

## Lane 报告（2026-10-25）

- 结论：完成。排序菜单（9 档 + 自定义排序）已接入歌单详情页；排序规则落在 `:core` 并有 16 例 JVM 单测；列表级菜单 9 项逐项盘点见下，未实现项登记遗留。
- commit：`9ffc40f`（core 规则）、`a14326d`（UI 接入）、`832e81e`（差异锁定用例）；测试数 core 400 + app 62 = 462 全绿（基线 446，+16 为本车道新增），APK 27,670,207 B。
- 触碰文件清单：
  - `android-native/core/src/main/kotlin/cn/toside/music/core/list/MusicSort.kt`（新增）
  - `android-native/core/src/test/kotlin/cn/toside/music/core/list/MusicSortTest.kt`（新增）
  - `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/list/ListDetailPage.kt`（修改）
  - `docs/waves/w2-C.md`（本报告）
  - `ListRuntime.kt` / `ListStore.kt` 未改：整表排序直接复用既有 `listMusicUpdatePosition`，无需新增原子能力。
- 语义修正与实证发现：

  ### 1. 字符串比较：Collator vs JS localeCompare
  实证环境：Node v24 `localeCompare(b, 'zh-CN')` vs JDK 21（Android Studio JBR）`java.text.Collator(Locale.forLanguageTag("zh-CN"))`。
  结论：Android 的 `java.text.Collator` 委托 ICU，与 RN 的 `localeCompare` 同源，故采用 Collator（未用 `String.compareTo`）；`localeId` 先做 `_`→`-` 归一化（RN same）。

  一致用例（已锁进 `MusicSortTest`）：`a<A`、`abc<ABC`、数字按字典序 `"10"<"9"`、`ABC<abd`、`_x<ax`、`Z<a`、`李<曾<张`、`长<重`。

  已知不一致（JVM 实测；**真机 ICU 未复核**）：

  | 比较对 | JS(zh-CN) | JVM Collator(zh-CN) |
  | --- | --- | --- |
  | 阿 vs b | -1 | +1 |
  | a-b vs ab | -1 | +1 |
  | ab vs "a b" | +1 | -1 |
  | é vs e | -1 | +1 |
  | ， vs a | -1 | +1 |
  | 阿 vs 啊 | -1 | +1 |

  处理：一致用例写成断言；差异方向写成 `jvmCollatorDivergenceFromJsIsLocked` 特征用例（换比较实现时该用例失败 → 必须同步复核本表）。风险面：中文与拉丁混排、含标点/重音的歌曲名可能个别次序与 RN 不同；分组/时长/年份等档位不受影响。
  边界：null 永远在前；排序稳定（Kotlin `sortedWith` 与 JS `sort` 均稳定）；`getIntv` 采用 `parseInt` 前缀语义，非法片段按 0（RN NaN 在比较中视同相等）。

  ### 2. 排序落库复用既有能力
  `ListStore.listMusicUpdatePosition(listId, 0, allIds)` 在传入全集时等价整表重排（内部 rest 为空、按入参顺序插回），既有语义已覆盖，故未新增 ListStore 方法。

  ### 3. 自定义排序 ↔ 多选互斥映射
  RN：排序弹窗选 custom → 关弹窗进拖拽态；进入多选强制退出拖拽态；多选态排序按钮 disabled。
  Kotlin：新增独立 `customSortMode`（与 `editMode` 互斥），拖拽柄在两种模式都显示；多选态操作条保留灰显「排序」且不可点；自定义态操作条为「完成 / 多选」。
  细微差异：RN 的「上次档位」是模块级变量、跨歌单跨页面记忆；Kotlin 存在页面级 `remember`，切歌单保留、退出详情页重置。RN 排序按钮文案是「排序歌曲」，Kotlin 操作条还承载重命名/清空/删除列表，为防小屏溢出用「排序」；**9 档 + 自定义的档位文案与 zh-cn.json 逐字一致**（标题/专辑（音轨）/时长（短→长）/时长（长→短）/添加时间/添加时间降序/歌手/年份/播放次数/自定义排序）。

  ### 4. add_time / play_count 数据缺口
  Kotlin 仅有 `StorageKeys.MUSIC_ADD_TIME` / `MUSIC_PLAY_COUNT`（StorageKeys.kt:56-57），无读写者，`ListRuntime` 也未暴露通用 KV。按任务书以 0 兜底：`add_time_up/down` 与 `play_count` 对当前数据是**稳定的空操作**（保持原顺序），待 data.ts 等价层落地后自动生效。未改禁触文件。

  ### 5. RN 列表页没有「随机播放」「收藏全部」
  再次核实 `MylistDetail/index.tsx` 操作条只有多选/排序，未实现这两个菜单项。

  ### 6. 列表级菜单逐项盘点（RN `MyList/ListMenu.tsx`，9 项）
  | RN 菜单 | Kotlin 现状 | 结论 |
  | --- | --- | --- |
  | new 新建 | HomePage「新建列表」 | 已有 |
  | rename 重命名 | 详情页「重命名」（用户歌单） | 已有（入口位置不同） |
  | sort 排序 | 本波详情页「排序」 | 本波接入 |
  | duplicateMusic 重复歌曲 | 无 | 遗留：需 filterDuplicateMusic 纯规则 + 弹层 |
  | local_file 选择本地文件 | 无 | 遗留（B6/B7：SAF 多选导入） |
  | sync 同步歌单 | 无 | 遗留（B6/B7：依赖来源 songList 能力） |
  | import 导入 | 无 | 遗留（B6/B7） |
  | export 导出 | 无 | 遗留（B6/B7） |
  | remove 删除列表 | 详情页「删除列表」（用户歌单） | 已有 |
  说明：RN 的列表级菜单挂在首页列表长按；Kotlin 首页无长按菜单且 `ui/HomePage.kt` 属 Lane A 禁触，故本波只把排序接到详情页操作条（RN 详情页同样有该入口）。

  ### 7. 闸门观察
  首次全量 `test` 时 `core` 既有用例 `PlaybackCoordinatorTest.loadFailureSchedulesNextTrack` 偶发失败（expected b but was a），单独重跑与随后全量重跑均通过；该用例属 player 包、本车道未触碰，判定为既有时序型 flaky，建议集成会话留观。

- 遗留问题与对后续波次的建议：
  1. **真机未验**：排序弹窗布局（10 项滚动）、拖拽手感、排序后随机队列同步需装机复验；建议在 Android 14/16 上抽 2-3 例 Collator 边角与 RN 比对（尤其「阿 vs b」）。
  2. add_time / play_count 的读写层（data.ts 对齐）未实现，两个档位当前无实际效果。
  3. 列表级菜单缺 5 项（duplicateMusic / local_file / sync / import / export）；导入导出与本地文件属 B6/B7，duplicateMusic 可独立做纯规则 + 弹层小切片。
  4. 首页列表缺少 RN 的长按列表菜单入口（Lane A 或后续波次）。
