# Wave 1 · 并行会话提示词（2026-10-25）

用法（顺序不能乱）：

```
会话0 快照+建worktree（主仓库） ──完成──▶ 车道 A/B/C 三个会话并行开工
                                          └──各自 lane 报告 commit 后──▶ 集成会话（主仓库）
```

- **会话0 与集成会话都在主仓库目录开**；三个车道会话分别在
  `..\music-w1\laneA / laneB / laneC` 目录用 Qoder 新开会话（工作目录=worktree 根）。
- 三条车道**不要同时全开**：每车道一个完整 gradle 构建很吃内存/磁盘
  （C/D/E 同一块盘）。建议先开 A、B，A 首次全绿构建完成后再开 C；机器吃力就再错开。
- 下面每个代码块就是复制粘贴给对应会话的完整提示词，无需再补充上下文。

---

## 会话 0 —— 协调：波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave1 的协调会话。只在当前主仓库目录工作，目标只有两件事：
做出「波前快照提交」，并为三条车道建好 git worktree。不写任何业务代码，不 push。

开工前先确认：现在没有其他会话正在这个主仓库工作区写代码（问我一句）。

步骤：
1. 通读 docs/waves/RULES.md 与 docs/kotlin-migration-progress.md（尤其「Wave 并行机制记录」一节）。
2. 跑基线：cd android-native && gradlew.bat ktlintCheck test assembleDebug。
   必须全绿（文档基线应为 :core 309 + :app 19；不一致时以实际全绿数字为准并记下）。
   若红：先把它修绿（只许最小修复），并在报告里说明改了什么。
3. 快照提交（只加这三处，别碰 src/ 等 RN 侧未提交改动，不加不 stash）：
   git add android-native docs/kotlin-migration-progress.md docs/waves
   git commit -m "chore(wave1): 波前快照（android-native 首次入库 + Wave1 任务书/规则）"
4. 建三个 worktree（分支都切自该快照提交）：
   git worktree add ../music-w1/laneA -b w1/laneA HEAD
   git worktree add ../music-w1/laneB -b w1/laneB HEAD
   git worktree add ../music-w1/laneC -b w1/laneC HEAD
5. 被 .gitignore 的文件不会随 worktree 复制——把 android-native/local.properties
   逐一拷到三个 worktree 的同路径下。
6. 冒烟：任选一个 worktree，cd 其 android-native && gradlew.bat compileDebugKotlin，确认可构建。
7. 汇报并停下：快照短哈希、实测测试数、三个 worktree 的绝对路径、冒烟结果。
   把「实测测试数」明确写出来——车道会话自检要对这个数字。
```

---

## 车道 A —— 排行榜 tx/wy/mg 详情

```text
你是 Wave1 Lane A 执行会话，任务：排行榜 tx/wy/mg 榜单详情收口（S2）。

你的工作区是独立 git worktree：<把会话0汇报的 laneA 绝对路径贴这里>，
分支 w1/laneA。其他会话在别的目录、别的分支上工作，你们互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 批次状态；「验证基线」的测试数是你的自检基准
4. docs/waves/w1-A.md —— 你的任务书；它的「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w1/laneA
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（只会等于或大于；变少=有人删测试，停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 快照里带着上一会话的半成品：TxLeaderboard.kt / WyLeaderboard.kt / WyWeapi.kt
  （已能编译，但没接线、没测试）。你的第一步是审计它们，不是重写。
- 抓真实响应做 fixture 时某接口不可达就改用合成 fixture 并在报告注明，不要卡死在这。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照；主仓库 RN 侧有未提交改动，但你在 worktree 里看到的是
  已提交版本——照它实证，差异记报告，绝不试图去看主仓库。
- 按逻辑小块中途 commit，消息以 W1-laneA: 开头。
- 新增 :core 逻辑全部配 JVM 单测；黄金测试对照 kw/kg 既有做法。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W1-laneA: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w1-A.md 末尾（结论/commit/触碰文件
   清单/语义修正/遗留问题），git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 B —— 自定义源管理 + 设置页扩展

```text
你是 Wave1 Lane B 执行会话，任务：自定义源管理 + 设置页扩展（S5）。

你的工作区是独立 git worktree：<把会话0汇报的 laneB 绝对路径贴这里>，
分支 w1/laneB。其他会话在别的目录、别的分支上工作，你们互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 批次状态，重点 B3 节「续接点」与「已知差异」
4. docs/waves/w1-B.md —— 你的任务书；它的「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w1/laneB
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（只会等于或大于；变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- DefaultSetting.kt 你与 Lane C 都会加键：只许在表尾追加、不动既有条目、
  不加与 C 无关之外的共享文件（SettingsRuntime.kt、userapi 运行时接线是你的，C 不碰）。
- 更新设置接入点：替换 UserApiRuntime.updaterSettings 的硬编码默认值（文档 B3 已知差异第 4 条）。
- formData(multipart) 缺口是否要补，结论写报告即可，实现可留给 Wave 2。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照，以 worktree 内已提交版本为准。
- 按逻辑小块中途 commit，消息以 W1-laneB: 开头。
- 自定义源导入→列表→启停→更新地址编辑全链路要有 JVM 单测（InMemory KvStore）。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W1-laneB: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w1-B.md 末尾，git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 C —— B4 剩余弹层

```text
你是 Wave1 Lane C 执行会话，任务：B4 剩余弹层（S11：更多菜单/定时关闭/倍速音量/歌词设置持久化）。

你的工作区是独立 git worktree：<把会话0汇报的 laneC 绝对路径贴这里>，
分支 w1/laneC。其他会话在别的目录、别的分支上工作，你们互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B4 节「待办」与续接点第 2 条
4. docs/waves/w1-C.md —— 你的任务书；它的「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w1/laneC
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（只会等于或大于；变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 音量/倍速直接用 PlayerRuntime.setVolume/setRate 既有公开 API，不改 player/ 内部；
  确需新增公开入口时改动最小化并在报告显著标注。
- DefaultSetting.kt 你与 Lane B 都会加键：只许追加、不动既有条目。
- 弹层是纯 UI + 既有能力组装；分享卡、桌面歌词本波不做（对照 B6/Wave 2）。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照；注意 RN 侧播控组件在主仓库有未提交改动，你在 worktree 里
  看到的是已提交版本——照它实证，差异记报告，绝不试图去看主仓库。
- 按逻辑小块中途 commit，消息以 W1-laneC: 开头。
- 定时关闭的纯逻辑（core/player/SleepTimer.kt 新文件）必须有 JVM 单测。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W1-laneC: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w1-C.md 末尾，git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 集成会话 —— 按序合并三条车道（主仓库）

```text
你是 Kotlin 迁移 Wave1 的集成会话。只在主仓库目录工作，不写业务功能代码，不 push（除我要求）。

前提：三条车道都已按 RULES 收尾（各自分支最后两笔提交 = 成果 + lane 报告）。
先逐个打开 docs/waves/w1-A.md / w1-B.md / w1-C.md 末尾的 lane 报告读完再动手。

步骤：
1. 确认主仓库 git status：RN 侧未提交改动保持原样（不 add、不 stash、不还原）；
   记下当前 HEAD。
2. 按 A → B → C 顺序逐条合并，一次只并一条：
   git merge --no-ff w1/laneX -m "merge(wave1): laneX <任务名>"
   - 冲突只可能出现在 DefaultSetting.kt（B/C 都是纯新增键）：保留两侧全部键。
   - 每并完一条立刻 cd android-native && gradlew.bat ktlintCheck test assembleDebug，
     全绿才许并下一条；红了就修到绿（改动记入收尾提交说明）。
3. 三条全绿后统一收尾：
   - 更新 docs/kotlin-migration-progress.md：速查表状态、对应批次章节
     （B3/B4/B5 已完成项与遗留项）、验证基线测试数与 APK 大小。
   - 把各 lane 报告的「语义修正与实证发现」并入进度文档相应表格。
   - git add docs && git commit -m "docs(wave1): 三车道收口，进度文档对齐"
4. 清理（确认合并完成后才做）：
   git worktree remove ../music-w1/laneX --force（三条）
   git branch -d w1/laneX（三条；-d 失败说明没并进 main，停下报告）
5. 汇报：三条 merge 提交哈希、最终测试数、APK 大小、真机验收清单汇总（从各 lane 报告抄）。
```

---

## 冲突审计结论（波前 2026-10-25 已做）

- Lane A（leaderboard/** + LeaderboardRuntime + ui/leaderboard）与 B（userapi/** +
  ui/settings + setting）、C（ui/play + 新增 SleepTimer + setting 追加键）文件面互不相交。
- 唯一共享文件：`core/.../setting/DefaultSetting.kt`（B、C 追加键）——集成时保留两侧即可。
- 半成品 Tx/Wy 文件归 Lane A 审计收口；主仓库已完成会话留下的其他未提交 RN 改动
  （src/ 下歌手/专辑等）**不进快照**，与波次无关。
