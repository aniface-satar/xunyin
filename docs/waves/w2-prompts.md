# Wave 2 · 并行会话提示词（派发版 2026-10-25，按 Wave1 合并后快照修订）

**前置条件（已满足）：Wave 1 三条车道已全部合并进 main、进度文档已更新到合并后基线。**

**波前实测基线（2026-10-25，强制真跑 `--rerun-tasks --no-build-cache`）**：
`:core` **384** + `:app` **62**（合计 **446**）全绿，failures/errors/skipped 全 0，
`app-debug.apk` = **27,602,811 B**；Wave1 收口提交 `47be7e0`。
三条车道自检一律用这组数字：测试数只会等于或大于，变少=有人删测试 → 停下报告。

用法与 Wave 1 相同：

```
协调会话（主仓库：修订任务书 → 波前快照 → 建 worktree）
        └──▶ 车道 A/B/C 三个会话并行 ──lane 报告 commit──▶ 集成会话（主仓库）
```

- 车道会话分别在 `..\music-w2\laneA / laneB / laneC` 目录用 Qoder 新开会话。
- 波前实测基线：`:core` 384 + `:app` 62 = **446** 全绿，APK **27,602,811 B**
  （快照 = 主仓库 `47be7e0` 再叠本次任务书修订提交）。
- 三条车道不要同时全开（内存/磁盘）；建议先开 B、C（较小），A 随后。
- 每个代码块整段复制给对应会话。

## Wave 2 冲突面（波前审计已做，修订时复核）

| 文件 | Lane A | Lane B | Lane C |
|:--|:--:|:--:|:--:|
| HomePage.kt / HomeNavigator.kt | ✔ 本波独占 | — | — |
| `core/songlist/` `ui/songlist/` `SonglistRuntime` | ✔ 新建 | — | — |
| AndroidManifest（overlay/服务） | — | ✔ 独占 | — |
| `ui/play/MoreActionSheet.kt`（播放页 ⋮ 面板） | — | ✔ 只加一行 | — |
| `core/.../lyric/` | — | 只新建文件 | — |
| DefaultSetting.kt | — | 禁触（14 个键已齐全，改键契约测试） | 禁触 |
| `ui/list/` + ListStore 新增方法 | 只调用 | — | ✔ 独占 |

三车道文件面互不相交。Wave1 的教训已吸收：`DefaultSetting.kt` 本波**没有任何车道改**。

---

## 协调会话 —— 任务书修订 + 波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave2 的协调会话。只在当前主仓库目录工作。不写业务代码，不 push。
前提确认（问我一句）：Wave1 三车道是否已全部并入 main 且进度文档基线已更新？

步骤：
1. 通读 docs/waves/RULES.md、docs/kotlin-migration-progress.md、
   docs/waves/w2-A.md / w2-B.md / w2-C.md、docs/waves/w2-prompts.md。
2. 【教训2：任务书必须按当前快照复核修订】逐条验证并在发现漂移时直接改任务书：
   - grep LeaderboardRuntime.kt：tx/wy/mg 是否已由 Wave1 接入（w2-A 的假设）；
   - 确认播放页「更多菜单」sheet 文件已存在且文件名是什么，把 w2-B 里的
     「唯一允许改的文件」写成具体文件名；
   - 确认 RN worktree 内存在 src/core/songlist.ts、
     src/screens/Home/Views/Mylist/MyList/ListMusicSort.tsx（w2-A/C 的对照物）；
     若 Wave1 期间 RN 侧同名文件在主仓库有未提交改动，确认不影响 worktree 版本。
   - 核对进度文档「验证基线」的当前测试数/APK 大小，把三份 w2 任务书和本文
     车道提示词里的基线数字改成实测值。
3. 跑基线：cd android-native && gradlew.bat ktlintCheck test assembleDebug 必须全绿。
4. 波前快照提交（只提交 docs/waves 修订，android-native 应已在 Wave1 快照入库；
   若有新的未跟踪构建输入文件一并加入，别碰 src/ 的 RN 未提交改动）：
   git add docs/waves ; git commit -m "chore(wave2): 任务书按 Wave1 合并后快照修订"
5. 建 worktree：
   git worktree add ../music-w2/laneA -b w2/laneA HEAD
   git worktree add ../music-w2/laneB -b w2/laneB HEAD
   git worktree add ../music-w2/laneC -b w2/laneC HEAD
6. 每个 worktree 拷 android-native/local.properties 到同路径。
7. 冒烟：任选一个 worktree 的 android-native 跑 gradlew.bat compileDebugKotlin。
8. 汇报：快照短哈希、实测测试数、三个 worktree 绝对路径、任务书修订点清单。停下。
```

---

## 车道 A —— 在线歌单 + 推荐通道（S6）

```text
你是 Wave2 Lane A 执行会话，任务：在线歌单五源数据 + 发现页推荐内容通道（S6）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w2/laneA 绝对路径>，
分支 w2/laneA。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 批次状态；「验证基线」测试数是你的自检基准
4. docs/waves/w2-A.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w2/laneA
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数为 :core 384 + :app 62（合计 446；只会等于或大于；变少=有人删测试，停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 个性化推荐引擎（bandit/audioEmbedding/melSpectrogram 等 46 文件）本波不移植。
  只做能与其解耦的官方内容通道，其余写「引擎解耦评估」进报告——不许造假数据。
- 歌单搜索（搜索 tab 的 songlist 类型）本波不做，写进遗留。
- 起播一律复用临时列表链路（listMusicOverwrite(TEMP)→playListById→后台补全），
  不新建第二套播放入口。
- RN 对照以 worktree 的 HEAD 版本为准：主仓库工作区有未提交的 album/artist 改动
  （songlist.ts 的 isAlbumListId 分支、五源 index.js 的 album/artist 注册），
  不会出现在你的 worktree 里，也不属于本波，不要移植。
- 排行榜已收口（LeaderboardRuntime 已接 tx/wy/mg），本车道不要动排行榜。
- 源表只有 kw/kg/tx/wy/mg 五源，RN 的 bd 不移植。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照，以 worktree 内已提交版本为准，差异记报告。
- 按逻辑小块中途 commit，消息以 W2-laneA: 开头。
- 新增 :core 逻辑全部配 JVM 单测；真实响应落盘 fixture 做黄金测试，
  接口不可达改合成 fixture 并在报告注明。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W2-laneA: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w2-A.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 B —— 桌面歌词 MVP（S10）

```text
你是 Wave2 Lane B 执行会话，任务：桌面歌词服务 MVP（S10）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w2/laneB 绝对路径>，
分支 w2/laneB。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束（本 lane 要改 AndroidManifest，方向属性绝对不能动）
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 批次状态；「验证基线」测试数是你的自检基准
4. docs/waves/w2-B.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w2/laneB
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数为 :core 384 + :app 62（合计 446；变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 只做 MVP：浮窗 + 逐行滚动 + 启停；OEM 兼容、锁词拖动精修留给后续波次。
- 歌词文本一律从 PlayerRuntime 公开流取，不改 core/lyric 既有文件、不碰 player/ 内部。
- 入口文件是 android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/
  MoreActionSheet.kt（调用点 PlayDetailPage.kt:161-173），只许加一行；该行必须
  自包含（进程级单例 + LocalContext），不要改 PlayDetailPage 的签名。
- DefaultSetting.kt 禁触：14 个 desktopLyric.* 键已全部存在（DefaultSetting.kt:60-74），
  改为键契约测试（默认值逐键对照 RN，含 :104 的新年皮肤覆盖）。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN 对照物在 android/app/src/main/java/cn/toside/music/mobile/lyric/（9 个 Java
  文件）+ src/core/desktopLyric.ts，只读。
- 按逻辑小块中途 commit，消息以 W2-laneB: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W2-laneB: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w2-B.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 C —— 歌单批量操作与排序菜单（S7）

```text
你是 Wave2 Lane C 执行会话，任务：歌单批量操作与排序菜单，B5 遗留收口（S7）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w2/laneC 绝对路径>，
分支 w2/laneC。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 批次状态；「验证基线」测试数是你的自检基准
4. docs/waves/w2-C.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w2/laneC
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数为 :core 384 + :app 62（合计 446；变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 排序比较规则先实证 RN（localeCompare 语义 vs Java/Kotlin 比较器有坑），
  结论与锁定用例写进报告「语义修正」节。
- 排序档位共 9 项 + 自定义排序（name/album/duration_up/duration_down/add_time_up/
  add_time_down/singer/year/play_count/custom），文案以 zh-cn.json 的
  list_sort_option_* 为准（name 的文案是「标题」）。
- 不要实现「随机播放」「收藏全部」——RN 列表页没有这两个菜单项；
  play_list_random 是播放模式按钮，Kotlin 已有。
- ListStore.kt 只许新增方法，不改既有方法语义；排序可直接用既有的
  listMusicUpdatePosition。自定义排序与多选态互斥，先实证 RN 再映射到现有拖拽模式。
- add_time_* / play_count 依赖 @music_add_time / @music_play_count，Kotlin 只有
  键名常量、无读写者：按 0 兜底并在报告登记数据缺口，不要改禁触文件。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；ui/play、HomePage、HomeNavigator、AndroidManifest
  本波属于其他 lane，绝对禁触。
- RN 对照物：src/screens/Home/Views/Mylist/MyList/（ListMusicSort.tsx、utils.ts、
  ListMenu.tsx、listAction.ts）+ src/screens/MylistDetail/index.tsx，只读。
  （src/store/Mylist/MyListAction.ts 不存在，别去找）
- 按逻辑小块中途 commit，消息以 W2-laneC: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W2-laneC: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w2-C.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 集成会话 —— 按序合并三条车道（主仓库）

```text
你是 Kotlin 迁移 Wave2 的集成会话。只在主仓库目录工作，不写业务功能代码，不 push（除非我要求）。

前提：三条车道都已按 RULES 收尾（各自分支最后两笔提交 = 成果 + lane 报告）。
先读完 docs/waves/w2-A.md / w2-B.md / w2-C.md 末尾的 lane 报告再动手。

步骤：
1. 主仓库 git status：RN 侧未提交改动保持原样（不 add、不 stash、不还原）；记下 HEAD。
2. 按 C → B → A 顺序逐条合并（先小后大，冲突面小的先进基线）：
   git merge --no-ff w2/laneX -m "merge(wave2): laneX <任务名>"
   - 每并完一条立刻 cd android-native && gradlew.bat ktlintCheck test assembleDebug，
     全绿才许并下一条；红了修到绿（修复点记入收尾提交说明）。
   - 理论冲突点：w2-B 的更多菜单行 vs w2-A 的 ui/songlist（应无交集）；
     DefaultSetting.kt 本波只有 B 加键。真出冲突逐文件保留语义两侧并重新跑测。
3. 三条全绿后统一收尾：
   - 更新 docs/kotlin-migration-progress.md：速查表、B5/B6 节、验证基线数字/APK 大小；
   - 把各 lane 报告「语义修正与实证发现」并入进度文档表格；
   - Lane A 的「推荐引擎解耦评估」单独成节，作为 Wave3 推荐立项的输入；
   - git add docs && git commit -m "docs(wave2): 三车道收口，进度文档对齐"
4. 清理：git worktree remove ../music-w2/laneX --force（三条）；
   git branch -d w2/laneX（-d 失败=没并进 main，停下报告）。
5. 汇报：三条 merge 提交哈希、最终测试数、APK 大小、真机验收清单汇总。
```

---

## Wave 2 之后的剩余（Wave 3 候选，先不立项）

- 个性化推荐引擎移植立项（输入 = Lane A 的解耦评估报告）
- B7 收官：RN 数据一次性迁移导入、release 签名决策 + R8/混淆、双通道收尾
- 分享卡（对照项目记忆「RN 截屏导出的六条坑」，原生侧需 Canvas 重绘方案）
- 播放页歌词增强：逐字歌词（lxlyric）、繁简转换、歌词搜索换源
- 歌单搜索（搜索 tab songlist 类型）
- 各波累计的真机验收清单潮（B0/B2/B3/B4/B5 + Wave1/2 报告内清单）
