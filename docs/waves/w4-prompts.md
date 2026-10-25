# Wave 4 · 并行会话提示词（预草稿 2026-10-26）

**前置状态核实（起草时点）**：Wave 1–3 九条车道已全部并入 main
（HEAD `0db83e7`，基线 core 558 + app 76 = 634，APK 28,142,274 B，
sha256 `09678fe4…`）。Wave 4 任务书按该快照起草，投用前协调会话仍必须逐条复核
（教训 2——前三波每次都靠复核抓到漂移）。

**复核修订记录（2026-10-26 协调会话，快照前）**：

- 基线真跑：`ktlintCheck test assembleDebug` 全绿，`--rerun-tasks` 复核测试数
  core 558 + app 76 = 634；APK 28,142,274 B、sha256 `09678fe4…` 与 Wave3 一致。
- w4-A：`@play_history` 仍无写入方（任务 1 保持从零实现）；`HomeNavigator.kt` 路径
  修正为 `nativeapp/HomeNavigator.kt`；OEM 输入落点写死为 w3-A「任务 5」全节，
  决议 = 本波不实现（Manifest 无需改）。
- w4-B：入口文件写死 `ui/play/MoreActionSheet.kt`；`CoverImageLoader` 现行 API
  （`suspend load(rawUrl): CoverArt?`，LRU 6 / 1200 / RGB_565 / blur 32）写死；
  `PlayDetailPage.kt` / `LyricView.kt` / `TimeoutExitRuntime.kt` 禁触。
- w4-C：首页列表**行**菜单在 `HomePage.kt` 的 `MyPage` 内（Lane A），本波菜单项入口
  改落 `ui/list/ListDetailPage.kt`；链接粘贴入口限 `SonglistPanel` / `SonglistDetailPage`
  （已有导航回调，零跨车道改动）；搜索页 `detailTarget` 页内覆盖的路由缺口本波不修；
  `CoverImageLoader` 既有语义锁死。
- 已建 worktree：`../music-w4/laneA|laneB|laneC`，分支 `w4/laneA|B|C`，
  均从本快照 HEAD 建出并拷好 `android-native/local.properties`。

用法不变：

```
协调会话（主仓库：复核修订任务书 → 波前快照 → 建 worktree）
        └──▶ 车道 A/B/C 并行 ──lane 报告 commit──▶ 集成会话（主仓库，顺序 C→B→A）
```

- 车道会话工作目录：`..\music-w4\laneA / laneB / laneC`，分支 `w4/laneX`。
- 开工顺序建议：先开 C、B（中件），A（M2 全家桶，最重）最后开或最先开均可，
  但三车道不要同时进入全量构建阶段。

## Wave 4 冲突面（波前审计已做）

| 文件/目录 | Lane A（电台M2） | Lane B（分享卡） | Lane C（歌单长尾） |
|:--|:--:|:--:|:--:|
| core/recommend、core/player、app/player、ui/radio | ✔ 独占 | 禁 | 禁 |
| HomePage.kt / HomeNavigator.kt / AndroidManifest | ✔ 独占 | 禁 | 禁（入口走既有路由） |
| ui/share、core/share、MediaStore 保存类 | 禁 | ✔ 新建 | 禁 |
| ui/play 更多菜单 sheet | 禁 | ✔ 只加「分享」行 | 禁 |
| CoverImageLoader.kt | 禁 | **只调用** | ✔ 独占（磁盘缓存扩展） |
| util/（SAF） | 禁 | 禁（保存类放 share/ 内） | ✔ 独占 |
| ui/list、ui/songlist、core/list、core/songlist、core/backup | 禁 | 禁 | ✔（core/list 只新增） |
| ui/settings、core/setting | 禁 | 禁（share.* 键本波不加） | 禁 |

三条车道两两不相交，唯一交叉是 B 调用 C 正在改造的 CoverImageLoader——
约定为「C 只扩公开 API 不改既有方法语义」，B 按现状调用即可。

---

## 协调会话 —— 任务书复核修订 + 波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave4 的协调会话。只在当前主仓库目录工作。不写业务代码，不 push。
前提确认（问我一句）：是否已无其他会话在主仓库工作、main 是否就是最新现状。

步骤：
1. 通读 docs/waves/RULES.md、docs/kotlin-migration-progress.md（重点：Wave3 集成记录、
   各批待办、文末 Wave3 立项评估节）、docs/waves/w4-A.md / w4-B.md / w4-C.md、本文。
2. 【教训2：逐条复核 w4 任务书假设，漂移就直接改任务书】
   - grep 确认 `@play_history` 写入方在 Wave3 Lane A 播控二轮之后是否已存在
     （若已有，w4-A 任务 1 改为「核对形状并按 M2 listening 需要扩展」）；
   - 确认 RN worktree 内存在 src/core/recommend/ 的 bandit.ts/candidate.ts/
     candidatePool.ts/queue.ts/requestPolicy.ts/sessionHealth.ts/listening.ts、
     src/core/dislikeList.ts、src/components/ShareCard/、src/utils/shareCard/exportCard.ts、
     Mylist/MyList/ 的 DuplicateMusic.tsx 与 ListImportExport.tsx；
   - 读 docs/waves/w3-A.md 报告区，把 OEM 保活调研结论的落点（文件+节名）写死进
     w4-A 任务 5；读 w3-C.md 报告区，把「路由缺口」的具体表现写死进 w4-C 任务 3；
   - 确认 CoverImageLoader 当前公开 API 形状（B 依赖），在 w4-B 第 5 条写死方法名；
   - 核对基线（应为 core 558 + app 76 = 634）同步进任务书。
3. 跑基线：cd android-native && GRADLE_USER_HOME=E:/GradleHome ./gradlew.bat
   ktlintCheck test assembleDebug 必须全绿。
4. 仓库卫生检查：git status 里若 `.github/workflows/native-build.yml` 或
   docs 下评估文档仍未入库，先单独一笔 chore 提交（与波次分开）；
   CI 首跑若仍欠，随本波快照了结并汇报。
5. 波前快照：git add docs/waves ; git commit -m "chore(wave4): 任务书按 Wave3 合并后快照修订"
6. 建 worktree + 拷 local.properties + 冒烟：
   git worktree add ../music-w4/laneA -b w4/laneA HEAD
   git worktree add ../music-w4/laneB -b w4/laneB HEAD
   git worktree add ../music-w4/laneC -b w4/laneC HEAD
   每份拷 android-native/local.properties；任选一个跑 compileDebugKotlin。
7. 汇报：提交哈希、实测测试数、三个 worktree 绝对路径、任务书修订点清单。停下。
```

---

## 车道 A —— 推荐 M2：bandit 全家桶 + 个性电台（S13）

```text
你是 Wave4 Lane A 执行会话，任务：推荐 M2——bandit 全家桶 + 个性电台 + 不感兴趣闭环（S13）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w4/laneA 绝对路径>，
分支 w4/laneA。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 必读「Wave3 推荐立项输入：引擎解耦评估」
   （M2 边界）与 B2 语义修正表（playedList 只由电台写入那条）
4. docs/waves/w4-A.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w4/laneA
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（只会等于或大于；变少=有人删测试，停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 只做 M2；M3（audioEmbedding/melSpectrogram/nativeAudio/diversity/similarity）
  一个字不写。M2 分支若依赖 M3，降级处理并记报告。
- 引擎里凡 RN 用 Math.random 的地方改成可注入 RNG 并锁种子（项目教训：
  不可注入的随机源会让单测抖动）。
- 你是本波 player/、core/player/、HomePage/HomeNavigator、AndroidManifest 的唯一
  持有者；动 PlayerCore 语义前先 RN 实证并记「语义修正」节；Manifest 禁动方向属性；
  音量均衡↔isEnableAudioOffload 互斥约束不许碰丢。
- 电台主线（引擎→队列→UI→喜欢/不感兴趣闭环）优先收口；
  onboarding、「更多」分页是可选——赶不上就写遗留，不许砍质量赶进度。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照，以 worktree 内已提交版本为准，差异记报告。
- 按逻辑小块中途 commit，消息以 W4-laneA: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W4-laneA: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w4-A.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 B —— 分享图卡片（S14）

```text
你是 Wave4 Lane B 执行会话，任务：Apple Music 风格分享卡（音乐卡+歌词卡）与保存相册（S14）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w4/laneB 绝对路径>，
分支 w4/laneB。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B4 待办「分享卡」与各 Wave 集成记录中
   与截屏导出相关的提醒
4. docs/waves/w4-B.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w4/laneB
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- RN 的 view-shot 截屏路线在原生没有等价物——先在 lane 报告写「导出方案选型」
  （Canvas/Picture 主动重绘为主），选型没定之前不动绘制层代码；
  排版/取值/截断规则一律放 :core 用 JVM 单测锁死，绘制只是执行器。
- 封面只调用 CoverImageLoader 既有公开 API（本波该文件归 Lane C 改造，禁触）。
- 保存相册的辅助类写在 ui/share/ 包内；util/ 本波归 Lane C，一个字都不写。
- share.* 设置键本波不加（core/setting/ 无人认领），用进程级默认并记遗留。
- 品牌图/字体进 release 包后会被资源改名——真机清单里写「按像素验证进包」。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；更多菜单 sheet 只许加「分享」接线行。
- RN（src/）只读对照：src/components/ShareCard/ 与 src/utils/shareCard/ 为已提交版本。
- 按逻辑小块中途 commit，消息以 W4-laneB: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W4-laneB: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w4-B.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 C —— 歌单长尾包（S15）

```text
你是 Wave4 Lane C 执行会话，任务：列表菜单补项 + lxmc 导入导出 + 整单导入/链接解析 + 封面链路（S15）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w4/laneC 绝对路径>，
分支 w4/laneC。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B1 验收对照（BackupManager UI 欠账）、
   Wave2/Wave3 集成记录里列表菜单与「路由缺口」相关条目
4. docs/waves/w4-C.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w4/laneC
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 整单导入语义是用户拍板过的：**整张外部歌单新建一张自建歌单**（不是塞进已有列表），
  与爱心收藏同认人不建两张——按任务书写，不要自作主张改成「加入指定歌单」。
- SAF 已知事实：导出已在安卓16真机验通、同名不覆盖会堆「(1)」；实现前先在 lane
  报告登记你对 RN 同名行为的实证结论。
- 本地文件/同步只做评估不实现；首页长按菜单、deeplink 本波不做（HomeNavigator/
  HomePage 归 Lane A）——四条遗留都要写进报告。
- CoverImageLoader 本波归你：扩公开 API 可以，改既有方法语义不行（Lane B 正在调用）。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件。
- RN（src/）只读对照：Mylist/MyList/ 的 DuplicateMusic.tsx、ListImportExport.tsx 等。
- 按逻辑小块中途 commit，消息以 W4-laneC: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W4-laneC: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w4-C.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 集成会话 —— 按序合并三条车道（主仓库，顺序 C → B → A）

```text
你是 Kotlin 迁移 Wave4 的集成会话。只在主仓库目录工作，不写业务功能代码，不 push（除非我要求）。

前提：三条车道都已按 RULES 收尾（各自分支最后两笔 = 成果 + lane 报告）。
先读完 docs/waves/w4-A.md / w4-B.md / w4-C.md 末尾的 lane 报告再动手。

步骤：
1. 主仓库 git status：RN 侧未提交改动保持原样（不 add、不 stash、不还原）；记下 HEAD。
2. 按 C → B → A 顺序逐条合并（长尾件先进，M2 最重最后）：
   git merge --no-ff w4/laneX -m "merge(wave4): laneX <任务名>"
   - 每并完一条立刻 cd android-native && gradlew.bat ktlintCheck test assembleDebug，
     全绿才许并下一条。
   - 理论唯一交叉点：Lane C 改了 CoverImageLoader 公开 API，Lane B 按旧签名调用——
     合并后若编译不过，优先在 C 侧补兼容重载（不改语义），别动 B 的业务代码。
   - Lane A 动了 player/：合并后重点跑播控相关用例，确认 M2 写入点没带红历史语义
     （B2 语义修正表是判据）。
3. 三条全绿后统一收尾：
   - 更新 docs/kotlin-migration-progress.md：速查表（B4/B5/B6）、遗留逐条勾销/改述
     （首页长按菜单、deeplink、本地文件/同步评估、onboarding、「更多」分页、
     share.* 设置键、OEM 实施与否的决议）、验证基线数字与 APK sha256；
   - 各 lane「语义修正」并入对应批次表格；
   - git add docs && git commit -m "docs(wave4): 三车道收口，进度文档对齐"
4. 清理：git worktree remove ../music-w4/laneX --force（三条）；
   git branch -d w4/laneX（-d 失败=没并进 main，停下报告）。
5. 汇报：三条 merge 哈希、最终测试数、APK、真机清单累计数
   （Wave1 24 + Wave2 16 + Wave3 20 + Wave4 新增——**建议此刻安排一次真机清账**，
   JVM 闸门全绿≠可发版）。
```

---

## Wave 4 之后还剩什么（Wave 5 候选，此处只列不立项）

- **M3 决议**：音频相似 vs 纯标签相似简化版 vs 砍掉——需要一次方案评审
  （音频特征提取的原生代价不小，结合「无自建后端/永久免费」硬约束建议先试简化版）
- **B7 收官（串行，不开车道）**：RN 数据一次性迁移导入、release 签名决策、
  R8/混淆规则、双通道收尾
- 长尾二次包：首页长按菜单、deeplink intent、onboarding 问卷、「更多」分页、
  share.* 设置持久化、singer/album 搜索类型、播放页 morph 转场评估、
  本地文件/同步（若评估通过）
- **真机清账**：60+ 条累计清单（发版硬项，用户本人执行）
