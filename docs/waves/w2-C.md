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
