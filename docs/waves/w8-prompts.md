# Wave 8 · 并行会话提示词（预草稿 2026-10-27，协调会话已复核）

**前置状态核实（协调会话实测，HEAD `20811f9`）**：Wave1–7 二十一条车道全部并入 main，
基线 **core 1105 + app 147 = 1252** 全绿，APK **29,263,058 B** / sha256 `f4ebfdc6…`。
真机清单累计 **169 条**未跑。Wave8 是收官波：B7 整批 + 推荐/列表两条线的终扫尾。

**协调会话复核后的关键事实**（三车道直接依赖，原起草版有 5 处漂移已修正）：

- 主题三件套 `core/theme/`（17 内置主题+生成器，黄金单测已有）但 **app 零装配**：
  `MusicApp.kt:51-53` 仍只按 `isSystemInDarkTheme()` 用 `SaltConfigs.default`；
  小写 `grep theme ui/settings/` 只命中 `DesktopLyricSettingsSection.kt`（那是桌面歌词配色）；
  键已在表（`DefaultSetting.kt:89-95` theme.* 七键，与 RN 同名；96-100 是 Wave7 歌词键）。
- monet 原生零代码（grep 无命中）；`PreloadPlan.kt:18,32,97-98` 有 PALETTE 步，
  但 **`buildPreloadPlan` 无 app 调用方**——不是现成管线，别当执行器用。
- `app/build.gradle.kts:21,24` 两段 `isMinifyEnabled = false`；无 benchmark 模块；
  release 无 `signingConfig`（本机 debug 签名覆盖装是既有实测路径）。
- `ShardedKvStore.kt` 只是分片**格式**编解码；两版 applicationId 不同（`:native` vs RN）
  ⇒ 沙箱隔离，**读不到 RN AsyncStorage SQLite**；迁移只能走备份文件/SAF 等实测通道。
- `desktopLyric.position.x/y` 默认值仍是 Int 0（`DefaultSetting.kt:66-67`，W7-1 根因）；
  `local.fallbackConfirm` **常量与钩子已在**（`LocalFallbackConfirm.kt:28`、
  `LocalMusicRuntime.kt:249/347`），缺默认值+Switch+一行赋值（原起草说「键不存在」是错的）。
- `ListMenuActions.kt` 595 行、枚举在 `:64-78`、SYNC=「更新」toast 占位（`:390`）；
  `ListDetailPage.kt` 1046 行内联逻辑（W5-9 撞的两文件）。
- Manifest 有 `lxmusic` scheme 与 json MIME filter，**无 http(s) filter**；
  `SonglistLinkParser.kt` 解析能力已在 `core/songlist/`。
- `RadioRuntime.kt:574` `importedOrigins = emptyList()`（W7-4，w7-A 报告有三步最小清单）；
  **`applyThemeFeedback` 已实现且电台侧已接线**（`RadioFeedback.kt:334`、
  `RadioBehavior.kt:114,450`、`settleExplicitFeedback` `:373/:317`）；真实缺口是发现页
  `SonglistRuntime.kt:232-239` 传 `emptyMap()` 主题权重；`PlayerCore.kt:852` 的 norm 做了
  `@→#` 而 `DislikeRulesParser.parse`（`core/recommend/RecommendSignals.kt:26`）没做。
- rankState blocked/hidden **app 侧已在传**（`SonglistRuntime.kt:259-260`）、
  隐藏歌单 UI 与 onboarding 已存在（`HiddenPlaylistCard.kt`/`OnboardingSheet.kt`）——
  w8-B 已把这三项从「实现」降级为「核对」。

**四件已拍板（用户确认：全按默认，2026-10-27）**：

1. **release 签名**：Lane A 备好清单后**停下等你**——沿用现 keystore 还是新建、
   口令怎么给，不猜。
2. **R8 开启**：**本波只交混淆缺口清单，不打开** `isMinifyEnabled`。
3. **RN 数据迁移范围**：歌单+爱心+设置键+播放历史四类起步，其余记遗留；
   清单出来后你勾一遍再落码。
4. **真机清账时机**：**波前不挡车道**，但 Wave8 并完即发版候选——169+新增条目的
   清账必须排在任何发版动作前。

## Wave 8 冲突面（波前审计已做）

| 文件/目录 | Lane A（B7 收官） | Lane B（推荐终扫尾） | Lane C（列表/歌词终扫尾） |
| :-- | :-: | :-: | :-: |
| `core/theme/**`、`ui/play/`（动态背景接线）、`PreloadPlan.kt` | ✔ 独占 | 禁 | 禁 |
| `DefaultSetting.kt`（position 改既有 + fallbackConfirm 表尾） | ✔ **本波唯一改键者** | 禁 | 禁 |
| `ui/settings/SettingsPage.kt`/`SettingsFormat.kt` | ✔（主题/迁移小节） | 禁 | 只调用 |
| `ui/settings/{DesktopLyricSettingsSection,BackgroundPlayHelpPage}.kt` | 禁 | 禁 | ✔ 独占 |
| gradle/版本目录/settings.gradle、Manifest 权限与签名块 | ✔ 本波唯一 | 禁 | 禁 |
| Manifest **intent-filter 段** | 禁 | 禁 | ✔（各改各段，集成保留两侧） |
| `MusicApp.kt`/`MainActivity.kt`/`NavStack.kt`/`HomePage.kt` | ✔（主题装配） | 禁 | 仅 deeplink 分发行 |
| `core/recommend/**`、`ui/radio/`、`ui/songlist/`、`data/{Radio,Recommend,...}*.kt` | 禁 | ✔ 独占 | 禁 |
| `core/list/**` | 禁 | ✔ 仅 `listMusicAdd` origin 参数行 | ✔ 其余（同步/add_time 元数据） |
| `ui/list/**` | 禁 | 仅 `ListDetailPage` 行菜单一行（先 commit） | ✔ 主场 |
| `ui/search/SearchPage.kt` | 禁 | ✔ 仅「加入列表」origin 一行 | 禁 |
| `lyric/**`、`deeplink/**` | 禁（position 键在 A，服务读侧在 C） | 禁 | ✔ 独占 |
| `userapi/**`、QuickJS | 禁 | 禁 | 禁（全波禁触） |

三处**已知交界**（都是「各改各的段/行」型，集成可解）：
① `core/list` 的 `listMusicAdd`——B 加 origin 形参，C 在同步/收藏路径扩写侧；
② `AndroidManifest.xml`——A 动权限/签名块，C 动 intent-filter 段；
③ `ui/list/ListDetailPage.kt`——B 只加一行「相似歌曲」入口，C 是重构主场；
   约定 **B 先并、C 后并**，C 合流时集成会话把 B 那一行保留进重构后的菜单，并后跑全量闸门。

**合并顺序：A → B → C**。理由：A 先落键默认值（W7-1 解锁 C 任务 5）与 gradle/主题底座；
B 的 `listMusicAdd(origin)` 签名先于 C 的消费；C 的 W5-9 重构最后并，把前两家增量折进统一版。

用法不变：

```text
协调会话（主仓库：复核修订任务书 → 波前快照 → 建 worktree）
        └──▶ 车道 A/B/C 并行 ──lane 报告 commit──▶ 集成会话（主仓库，顺序 A→B→C）
```

- 车道会话工作目录：`..\music-w8\laneA / laneB / laneC`，分支 `w8/laneX`。
- 开工顺序建议：**A 先开**（拍板门要早点触达你）→ B → C；三车道不要同时进入全量构建阶段。

---

## 协调会话 —— 任务书复核修订 + 波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave8 的协调会话。只在当前主仓库目录工作。不写业务代码，不 push。
前提确认（问我一句）：是否已无其他会话在主仓库工作、main 是否就是最新现状；
docs/waves/w8-prompts.md 顶部「待你拍板的四件」按默认还是有改。

步骤：
1. 通读 docs/waves/RULES.md、docs/kotlin-migration-progress.md（重点：批次速查表、
   Wave7 集成记录与 W7-1~W7-12 遗留、各批待办）、docs/waves/w8-A.md / w8-B.md / w8-C.md、本文。
2. 【教训2：逐条复核三任务书 §0 的每张表，漂移就直接改任务书】重点是这几处：
   - theme 装配是否仍零存在（grep 以源码目录为准，别把 core/build 产物算进来）；
   - monet/取色是否仍零代码、PreloadPlan 的 PALETTE 步现状；
   - SonglistRuntime 的 blocked/hidden 传参（w8-B 复核表 3）之后有没有更多消费方；
   - importedOrigins 是否仍 emptyList（若 w7-A 之后有人补了，任务 1 降级为核对）；
   - ListMenuActions/ListDetailPage 是否仍是两份逻辑、SYNC 是否仍是 toast 占位；
   - ShardedKvStore 兼容层的实际能力边界（读哪些 RN 键、分片格式到什么程度），
     不足就把 w8-A 任务 6 的范围改成「清单+能迁的迁」；
   - 基线核对：应为 core 1105 + app 147 = 1252（与进度文档「验证基线」一致）。
3. 跑基线：cd android-native && GRADLE_USER_HOME=E:/GradleHome ./gradlew.bat
   ktlintCheck test assembleDebug 必须全绿；数字不符先查清再动。
4. 仓库卫生：RN 侧（src/、package.json、docs/waves/w5-prompts.md 的未提交改动等）一律
   保持原样——不 add、不 stash、不还原；只提交本波 docs。
5. 波前快照：git add docs/waves ; git commit -m "chore(wave8): 三车道任务书与并行会话提示词"
   （含 w8 四文件的复核修订）。
6. 建 worktree + 拷 local.properties + 冒烟：
   git worktree add ../music-w8/laneA -b w8/laneA HEAD
   git worktree add ../music-w8/laneB -b w8/laneB HEAD
   git worktree add ../music-w8/laneC -b w8/laneC HEAD
   每份拷 android-native/local.properties；任选一个跑 compileDebugKotlin。
7. 汇报：提交哈希、实测测试数、三个 worktree 绝对路径、任务书修订点清单；
   并就「169 条真机清账的拆分建议」给一页纸（哪些条目会被 Wave8 改动覆盖/作废，
   优先清播控与取链主干）。停下。
```

---

## 车道 A —— B7 收官：主题全链路 + monet + 无障碍 + 性能 + 签名/迁移

```text
你是 Wave8 Lane A 执行会话，任务：B7 收官整批（主题装配/monet/无障碍/性能基线/
签名与 R8 清单/RN 数据一次性迁移 + W7-1 键改/W7-2 键加/W7-11 评估落纸）。

你的工作区是独立 git worktree（协调会话给你的路径），分支 w8/laneA。
其他会话在别的目录、别的分支工作，互相看不到改动——不要试图同步，不要离开本目录，
不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md（竖屏约束）
2. docs/waves/RULES.md（纪律与收尾三步）
3. docs/kotlin-migration-progress.md（B7 定义=可行性文档 §B7；W7-1/W7-2/W7-10/W7-11；
   B1 决策表「ShardedKvStore 兼容层」条目）
4. docs/waves/w8-A.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检】git status 干净、分支 w8/laneA；gradlew ktlintCheck test assembleDebug
全绿且 = core 1105 + app 147（变少=删测试，停下报告）；local.properties 存在。

【本车道特别提醒】
- 三处**拍板门**（签名密钥落地、R8 打开、迁移范围终稿）：备好清单即停下报告等我，
  不许替我决定。清单要写成「选项+代价+建议」，别堆术语。
- monet 取色器必须可注入确定性种子（莫奈抖动教训）；纯规则进 core/theme/ + JVM 单测，
  渲染接线只在 ui/play/ 的动态背景部分，别碰 LyricView/morph。`PreloadPlan.PALETTE`
  无 app 执行器，别假定它是现成管线（补执行器可选、不作验收条件）。
- 你是本波唯一改 DefaultSetting 既有键的人（position.x/y → 0.0）；除这两键外只许表尾追加。
- `local.fallbackConfirm` 常量/钩子已在，别重建：只补 `DefaultSetting` 默认值 +
  `LocalMusicRuntime` 一行赋值 + 设置 Switch。
- gradle 你可以动，但 assembleDebug 路径必须保持全绿（Lane C 的构建要靠它）；
  benchmark 模块是可选，默认用 logcat TotalTime 出冷启动数。
- RN 数据迁移**先交范围清单、交完即停**：ShardedKvStore 只解格式、读不到 RN AsyncStorage
  （沙箱隔离），只能走备份文件/SAF 等实测可达通道；清单逐键写「迁/不迁/为什么」。

【收尾三步】闸门全绿 → commit（W8-laneA: 前缀）→ lane 报告追加进 docs/waves/w8-A.md
并 commit。完成后停下等待集成，不要自行开始其他任务。
```

---

## 车道 B —— 推荐与电台终扫尾：归因闭环 + 主题权重 + 踩雷归一 + 相似入口

```text
你是 Wave8 Lane B 执行会话，任务：importedOrigins 归因闭环（W7-4）、发现页分类挑选消费
themeWeights（M1 收口）、rankState/隐藏歌单/onboarding 三处核对、DislikeRulesParser
@→# 归一、「相似歌曲」入口、音频特征时间盒（可选）。

你的工作区是独立 git worktree（协调会话给你的路径），分支 w8/laneB。
纪律同 RULES：不离开目录、不切分支、禁 push/merge/rebase/stash/reset。

【开工必读】AGENTS.md → docs/waves/RULES.md → 进度文档（B5 待办「画像 M2 剩余细项」
「踩雷解析两侧不一致」、w7-A 报告遗留节的 importedOrigins 三步清单）→ docs/waves/w8-B.md。

【开工自检】分支 w8/laneB；基线 core 1105 + app 147 全绿；local.properties 存在。

【本车道特别提醒】
- 你拥有本波 `listMusicAdd` 的 origin 参数行，**只加可选形参保持二进制兼容**——
  Lane C 在同文件扩同步/add_time 写侧，签名形状先 commit 再实现。
- ListDetailPage 是 Lane C 的主场：你只允许在行菜单加「相似歌曲」一行，先 commit，
  别顺手整理那个文件（W5-9 重构归 C）。
- 任务 3 是「核对批」：先跑现状（blocked/hidden 已在传、隐藏歌单/onboarding 已存在），
  核对结论写报告，别按旧待办重写已有功能。
- `applyThemeFeedback`/`settleExplicitFeedback` **已实现且电台侧已接线**，别重复实现；
  你只补发现页 `SonglistRuntime.kt:232-239` 的 `emptyMap()` → 真实主题权重
  （来源 `RadioStateStore.read()?.themeWeights` 或 RadioRuntime 只读暴露）。
- 踩雷归一修**读侧** `DislikeRulesParser.parse`（`core/recommend/RecommendSignals.kt:26`），
  写侧 `normalize()` 已有 `@→#`，别改第二遍。
- 下载/分享菜单项不做；「更多」分页第六次延期，只写一条结论。
- 音频特征：评测口径没落纸之前一个字不写。

【收尾三步】同 RULES，前缀 W8-laneB:。停下等待集成。
```

---

## 车道 C —— 列表与歌词终扫尾：W5-9 统一 + 同步实装 + add_time + 路由

```text
你是 Wave8 Lane C 执行会话，任务：W5-9 菜单统一重构、列表「更新」同步实装、
默认列表随机播放/收藏全部、add_time 定位元数据、W7-1 读侧收口（等 A）、
https intent-filter 与歌单链接外部直达、歌词增强时间盒（可选）。

你的工作区是独立 git worktree（协调会话给你的路径），分支 w8/laneC。
纪律同 RULES：不离开目录、不切分支、禁 push/merge/rebase/stash/reset。

【开工必读】AGENTS.md → docs/waves/RULES.md → 进度文档（B5 待办 W5-9/同步/批量操作/
排序档位/路由残留、w7-C 报告）→ docs/waves/w8-C.md。

【开工自检】分支 w8/laneC；基线 core 1105 + app 147 全绿；local.properties 存在。

【本车道特别提醒】
- W5-9 是纯重构：动手前先画 ListMenuActions/ListDetailPage 两份逻辑对照表进报告，
  重构前后各锁一组等值用例；语义有任何变化就是越界。
- Manifest 只许动 intent-filter 段（Lane A 在动权限/签名块，各改各段）；
  screenOrientation 禁触（AGENTS.md）。
- 任务 5 依赖 Lane A 的键默认值：开工时 DefaultSetting 的 position 还是 Int，
  该任务挂起，先把 1–4/6 做完，别自己改键表。
- 收藏全部调用 `listMusicAdd` 现状签名即可（Lane B 在加 origin 形参，集成时补传）。
- `@music_add_time`/`@music_play_count` 键常量已在 `core/storage/StorageKeys.kt:56-57`
  但零读写者——补读写，别新建键名。
- 下载、递归扫描/多目录（W7-5）、歌词工具模式——全不做。

【收尾三步】同 RULES，前缀 W8-laneC:。停下等待集成。
```

---

## 集成会话 —— 按 A → B → C 合入并汇总

```text
你是 Wave8 集成会话。只在主仓库目录工作。push 禁止；合并一律 --no-ff。
先读 docs/waves/RULES.md、docs/waves/w8-prompts.md（冲突矩阵与交界三条）、
三份 lane 报告（w8-A/B/C.md 末尾追加区）。

步骤（每条车道重复）：
1. merge w8/laneA → 全量闸门（ktlintCheck test assembleDebug）；
   再 merge w8/laneB → 全量闸门；再 merge w8/laneC → 全量闸门。
   基线只增不减（起点 1252）。
2. 已知交界处置：
   - core/list `listMusicAdd`：B 的 origin 形参 + C 的同步/add_time 写侧都保留，
     语义合流（收藏/同步路径要不要带 origin，按 B 报告的字段形状补一行装配）；
   - AndroidManifest：A 的权限/签名块与 C 的 intent-filter 段都保留，检查无重复 filter；
   - ui/list/ListDetailPage：C 的重构版为基底，把 B 的「相似歌曲」一行折进统一后的菜单，
     并补一行 origin 装配（若 B 的入口路径涉及加入列表）。
3. 撞 DefaultSetting 时保留两侧（本波理论上是 A 独占，出现第三方改动即停下报告）。
4. 车道报告里的「拍板门」产物（签名清单/R8 缺口清单/迁移范围清单）原样收进
   docs/kotlin-migration-progress.md 的 Wave8 集成记录，标记「待用户」。
5. 汇总：更新主进度文档（批次速查表 B2/B3/B4/B5/B6/B7 状态、验证基线数字、
   Wave8 集成记录：合并哈希/闸门可加性核对/语义修正要点/遗留清单 W8-x/
   真机清单合并——含 169 条存量账与作废条目判断）。commit：docs(wave8): 主进度文档汇总。
6. 清理三个 worktree（git worktree remove）与分支需我确认后再动，先汇报。
7. 汇报终态：测试数、APK 字节数与 sha256、遗留清单条数、真机清账总量。停下。
```

---

## Wave 8 之后（Wave9 候选，到时按新快照重写）

1. **真机清账**（169 + Wave8 新增 ≈ 185 条）——发版前的硬闸门，用户执行。
2. 拍板门产物落地：签名/R8/迁移范围确认后单独一次串行会话收口。
3. 挂账大项（均未开工）：音乐下载移植（RN 有四根因修复史）、递归扫描/多目录（W7-5）、
   歌词增强主体（逐字/换源/工具模式）、推荐区「更多」分页（第六次延期）、
   听歌识曲、island（灵动岛）。
4. 双通道收官：原生版发版链路（CI/清单/公告）按更新分发链路的既有实测走。
