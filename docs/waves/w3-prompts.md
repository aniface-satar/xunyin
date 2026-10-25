# Wave 3 · 并行会话提示词（预草稿 2026-10-25）

**前置条件**：Wave 2 已全部并入 main（现状核实于 e7f390a：core 470 + app 68 全绿，
协调会话已用 `--rerun-tasks` 强制复跑：61 tasks 全 executed、failures/errors/skipped 全 0）。
本套任务书按该状态起草并逐条复核修订完成。

用法不变：

```
协调会话（主仓库：复核修订任务书 → 波前快照 → 建 worktree）
        └──▶ 车道 A/B/C 并行 ──lane 报告 commit──▶ 集成会话（主仓库）
```

- 车道会话工作目录：`..\music-w3\laneA / laneB / laneC`，分支 `w3/laneX`。
- 不要三车道同时全开；建议先开 A（最小、动核心播控，早合早稳），再 B、C。
- 每个代码块整段复制给对应会话。

## Wave 3 冲突面（波前审计已做）

| 文件/目录 | Lane A（播控+歌词） | Lane B（推荐M1） | Lane C（歌单搜索+详情） |
|:--|:--:|:--:|:--:|
| app/player/、app/lyric/、ui/settings/、AndroidManifest | ✔ 独占 | 禁 | 禁 |
| core/.../setting/（含 DefaultSetting、SettingsStore） | ✔ 独占 | 禁 | 禁 |
| core/recommend/（新建）、推荐通道数据编排 | 禁 | ✔ 独占 | 禁（连调用都少） |
| core/music/search/ 新文件、ui/search/、data/SearchRuntime.kt | 禁 | 禁 | ✔ |
| ui/songlist/、ui/play/CoverImageLoader.kt | 禁 | 禁（只改数据不改渲染） | ✔（该类已公开可复用，预期零改动） |
| core/list/（ListStore 只许新增） | 禁 | 禁（只调用） | ✔（仅可选任务） |
| ui/play/MoreActionSheet.kt（更多菜单） | ✔ 只接歌词行 | 禁 | 禁 |
| ui/play/TimeoutExitRuntime.kt | ✔ 退出收尾 | 禁 | 禁 |

三车道两两不相交，无共享文件——本波理论上零 merge 冲突（DefaultSetting 只有 A 动）。

---

## 协调会话 —— 任务书复核修订 + 波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave3 的协调会话。只在当前主仓库目录工作。不写业务代码，不 push。
前提确认（问我一句）：是否已无其他会话在主仓库工作、Wave2 之后 main 是否就是最新现状。

步骤：
1. 通读 docs/waves/RULES.md、docs/kotlin-migration-progress.md（重点：速查表、
   「Wave2 集成记录」「遗留问题（Wave3 候选）」「Wave3 推荐立项输入：引擎解耦评估」）、
   docs/waves/w3-A.md / w3-B.md / w3-C.md、本文。
2. 【教训2：逐条复核 w3 任务书的假设，漂移就直接改任务书】
   - grep exitProcess 与 SleepTimer.isPlayedStop：w3-A 任务 3 是否仍未收（Wave2 期间若已修就删该任务）；
   - 找到播放页「更多菜单」sheet 的实际文件名，写死进 w3-A/w3-B/C 相关行；
   - 确认发现页推荐通道的 runtime 实际文件名与「重排」接入点，写死进 w3-B 范围；
   - 确认 ui/play/CoverImageLoader.kt 的类可见性现状，w3-C 是否只需一行改动；
   - 确认 core/.../music/search/ 下无 songlist 同名文件（w3-C 是纯新建）；
   - 核对进度文档基线（应为 core 470 + app 68）并同步进三份任务书提示词。
3. 跑基线（注意本机 Git Bash 约定）：cd android-native &&
   GRADLE_USER_HOME=E:/GradleHome ./gradlew.bat ktlintCheck test assembleDebug 必须全绿。
4. 仓库卫生前置（本波独有，单独一笔提交，消息注明与波次无关）：
   git add .github/workflows/native-build.yml docs/kotlin-saltui-migration-feasibility.md
   git commit -m "chore: CI workflow 与迁移评估文档补入库"
   ——CI 首跑欠了两波，这次随快照一起了结。
5. 波前快照提交：
   git add docs/waves ; git commit -m "chore(wave3): 任务书按 Wave2 合并后快照修订"
6. 建 worktree + 拷 local.properties + 冒烟：
   git worktree add ../music-w3/laneA -b w3/laneA HEAD
   git worktree add ../music-w3/laneB -b w3/laneB HEAD
   git worktree add ../music-w3/laneC -b w3/laneC HEAD
   每份拷 android-native/local.properties；任选一个 worktree 跑 compileDebugKotlin。
7. 汇报：两笔提交哈希、实测测试数、三个 worktree 绝对路径、任务书修订点清单。停下。
```

---

## 车道 A —— 播控与持久化二轮包（S8）

```text
你是 Wave3 Lane A 执行会话，任务：播控与持久化二轮包（S8：三键回读/进度记忆/
SleepTimer 收口/桌面歌词二轮/flaky 排查）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w3/laneA 绝对路径>，
分支 w3/laneA。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B3 待办「三键只有写没有读」、
   B6 桌面歌词遗留、Wave1 集成遗留项 1（SleepTimer）与遗留 8（flaky）
4. docs/waves/w3-A.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w3/laneA
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（**基线 core 470 + app 68 = 538**；只会等于或大于；
  变少=有人删测试，停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 你是本波 app/player/ 与 core/.../setting/ 的唯一持有者：改 PlayerCore/
  PlaybackCoordinator 语义前先在 RN 源码实证并记「语义修正」节。
- 音量均衡开启时 isEnableAudioOffload 必须置 false（RN player.ts:251）——
  动启动接线时别把它碰丢。
- SettingsStore 若做数值互通改造，既有用例一条都不许变红。
- AndroidManifest 只动桌面歌词服务相关行，screenOrientation 绝对禁触。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照，以 worktree 内已提交版本为准，差异记报告。
- 按逻辑小块中途 commit，消息以 W3-laneA: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W3-laneA: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w3-A.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 B —— 个性化推荐 M1：画像重排（S9）

```text
你是 Wave3 Lane B 执行会话，任务：个性化推荐 M1——画像重排，不接 bandit（S9）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w3/laneB 绝对路径>，
分支 w3/laneB。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 必读「Wave3 推荐立项输入：引擎解耦评估」
   一节（M1/M2/M3 边界与 7 个依赖文件清单是给你的立项裁决）
4. docs/waves/w3-B.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w3/laneB
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（**基线 core 470 + app 68 = 538**，变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 只做 M1（rankPlaylistTags / rankPlaylistsByProfile / rankTracksByProfile 及
  7 个依赖纯规则）；bandit/candidate/queue/audioEmbedding 等 M2/M3 一个字不写。
- 画像输入缺的信号一律不造假：拿不到就空态/默认 prior，并在报告逐一列
  「用了哪些真实信号、哪些留空、降级后果」。
- 你只改数据顺序，不改发现页/歌单的任何渲染组件；ListStore/PlayerCore 只调用。
- 评估若与你实读到的 RN 源码不符（比如某函数其实依赖 bandit 状态），以实证为准，
  调整范围并记报告，别硬凑。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- 按逻辑小块中途 commit，消息以 W3-laneB: 开头。
- core/recommend/ 全部纯规则配 JVM 单测，重排函数做对照 RN 的黄金测试。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W3-laneB: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w3-B.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 C —— 歌单搜索 + 在线歌单详情二轮（S12）

```text
你是 Wave3 Lane C 执行会话，任务：搜索 tab 歌单类型五源移植 + 在线歌单详情二轮（S12）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w3/laneC 绝对路径>，
分支 w3/laneC。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点「Wave2 集成记录·遗留问题（Wave3 候选）」
   第 2、3、6 条
4. docs/waves/w3-C.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w3/laneC
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（**基线 core 470 + app 68 = 538**，变少停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 类型切换只做「歌曲/歌单」两档，singer/album 本波不做（Wave2 撞车过的教训：
  别顺手扩大战线）。
- 下载/分享/相似歌曲菜单项依赖未移植能力，不做，写遗留。
- core/music/search/ 只新建歌单搜索文件，既有单曲五源与聚合器禁改——
  翻页/缓存编排照 SearchCoordinator 模式另起炉灶（SonglistSearchRuntime）。
- 可选任务 4（附加时间元数据）优先级最低：主任务没收尾前不碰 core/list。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；推荐通道数据编排文件（含 SonglistRuntime 重排行）
  本波归 Lane B，绝对禁触。
- RN（src/）只读对照，以 worktree 内已提交版本为准，差异记报告。
- 按逻辑小块中途 commit，消息以 W3-laneC: 开头。
- 歌单搜索五源全部真实响应落盘 fixture 做黄金测试（不可达改合成并注明）。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W3-laneC: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w3-C.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 集成会话 —— 按序合并三条车道（主仓库）

```text
你是 Kotlin 迁移 Wave3 的集成会话。只在主仓库目录工作，不写业务功能代码，不 push（除非我要求）。

前提：三条车道都已按 RULES 收尾（各自分支最后两笔 = 成果 + lane 报告）。
先读完 docs/waves/w3-A.md / w3-B.md / w3-C.md 末尾的 lane 报告再动手。

步骤：
1. 主仓库 git status：RN 侧未提交改动保持原样（不 add、不 stash、不还原）；记下 HEAD。
2. 按 A → B → C 顺序逐条合并（A 动播控核心，先进基线；理论零冲突，
   真出冲突说明有 lane 越界——停下核对触碰文件清单再合）：
   git merge --no-ff w3/laneX -m "merge(wave3): laneX <任务名>"
   - 每并完一条立刻 cd android-native && gradlew.bat ktlintCheck test assembleDebug，
     全绿才许并下一条。
   - Lane A 动了 player/：合并后重点看 B/C 的运行时序用例有没有被带红。
3. 三条全绿后统一收尾：
   - 更新 docs/kotlin-migration-progress.md：速查表（B4/B5/B6 行）、
     「遗留问题」逐条勾销/改述（推荐 M2/M3 立项输入更新为 M1 落地后的真实边界）、
     验证基线数字与 APK sha256；
   - 各 lane「语义修正」并入对应批次表格；
   - git add docs && git commit -m "docs(wave3): 三车道收口，进度文档对齐"
4. 清理：git worktree remove ../music-w3/laneX --force（三条）；
   git branch -d w3/laneX（-d 失败=没并进 main，停下报告）。
5. 汇报：三条 merge 哈希、最终测试数、APK、真机清单汇总（累计数提醒我清账——
   Wave1 24 条 + Wave2 16 条 + 本波新增，全部未跑）。
```

---

## Wave 3 之后还剩什么（Wave 4 候选，此处只列不立项）

- **推荐 M2**：bandit + candidate/candidatePool/queue/requestPolicy/sessionHealth/
  listening 全家桶 + 个性电台/探索页（输入 = Wave3 Lane B 落地后的真实边界）
- **推荐 M3**：音频相似（audioEmbedding/melSpectrogram/nativeAudio，需原生方案评审）
  与 MMR（diversity/similarity）
- **分享卡**（播控页 + 歌词海报；对照项目记忆「RN 截屏导出的六条坑」，需 Canvas 重绘方案）
- **B7 收官**：RN 数据一次性迁移导入（ShardedKvStore 读旧分片）、release 签名决策、
  R8/混淆规则、双通道并行收尾——签名/R8 涉 gradle，走单独串行会话，不开车道
- 列表级菜单 5 项（去重/本地文件/同步/导入/导出）+ 首页长按菜单入口
- 未接 id/分享链接解析（kw digest/kg 酷狗码/tx playsquare/wy 单段链接）
- singer/album 搜索类型、`getPicPath` 封面校验磁盘缓存、播放页 morph 转场评估
- **真机验收清账**（用户侧硬项）：Wave1 24 条 + Wave2 16 条 + Wave3 新增，JVM 闸门测不到
