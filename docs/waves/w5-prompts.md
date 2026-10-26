# Wave 5 · 并行会话提示词（预草稿 2026-10-26）

**前置状态核实（起草时点）**：Wave 1–4 十二条车道已全部并入 main
（HEAD `f214bd8`，基线 **core 742 + app 76 = 818**，APK 28,860,935 B，
sha256 `b6fc7376…`）。Wave 5 任务书按该快照起草，投用前协调会话仍必须逐条复核
（教训 2——前四波每次都靠复核抓到漂移）。

**起草时点实测的关键事实**（三条车道都直接依赖，协调会话要重跑一遍）：

- `core/recommend/` = M1 十文件 + `radio/` **二十**文件（进度文档写的「21 文件」把测试类算进去了，
  source 实为 20）；`audioEmbedding` / `audioFeature` / `melSpectrogram` / `nativeAudio`
  **零代码**（全工程命中仅 3 处注释：`SonglistRuntime.kt:201-202`、`RadioConfig.kt:5`）。
- RN 相似歌手走 **MusicBrainz + ListenBrainz** 公网接口（不是五源歌手接口），MB 要求 UA + 1 req/s。
- `languageQuota` 的输入是 `onboarding.weights` → **onboarding 从可选项升为必做**。
- `PlayerRuntime.kt:69` 的取链**无条件**走 `userApi.getMusicUrl`，无 `source == "local"` 分支；
  `MusicInfoTools.sanitizeMusicInfo` 已能兜 local 字段（不需要新模型）。
- `HomePage.kt` 共 491 行、`MyPage` 在 393 行，全工程**无** `combinedClickable`/`onLongClick`。
- `AndroidManifest.xml` 只有 MAIN/LAUNCHER，无 scheme；`MainActivity` 16 行空壳。
- `ShareCardSaver.save` 返回 `Saved(fileName)`，**没有 Uri**，系统分享发不出去；
  `DefaultSetting` 已有 `common.shareType` / `shareCard.savePath` / `shareCard.savePathName`。
- `util/SafDocuments.kt` 只有导入导出用的字节 API，无目录树选择/持久授权。

**待你拍板的三件（默认已按括号内起草，回一句就能改）**：

1. **M3 方向**（默认：**简化版**——标签相似 + MMR + 语种配额 + 时段 + MB 相似歌手，
   **不写音频特征**，只交代价评估）。另两条路：彻底砍掉 M3（那就只有修订遗留清单的价值）；
   硬上音频相似（建议先做专项评审，别当一个车道任务）。
2. **「更多」分页 / 播放页 morph 转场**（默认：前者**不做**（第四次延期，Wave6 与 B7 一起收），
   后者只评估不实现）。onboarding 因为成了配额前置，已升为 Lane A 必做。
3. **B7 收官是否并进本波**（默认：**不并**。RN 数据一次性迁移、release 签名、R8/混淆、双通道收尾
   都需要你在场拍板，适合 Wave6 单开一个串行会话，不开车道）。

**复核修订记录（协调会话实测，2026-10-26，主仓库 HEAD `cf8efef`）**：

- **基线实测吻合**：`ktlintCheck test assembleDebug` BUILD SUCCESSFUL；`:core` 742 + `:app` 76
  = **818**，failures/errors/skipped 全 0；APK **28,860,935 B**，
  sha256 `b6fc7376…3837` —— 与进度文档「验证基线」逐位一致，无测试丢失。
- **用户已拍板（2026-10-26）**：三件全按默认 —— M3 走简化版（不写音频特征，只交代价评估）；
  「更多」分页不做、morph 只评估、onboarding 升为 Lane A 必做；B7 收官不并进本波。
- 逐条复核结论（与起草稿的差异，任务书已同步改）：
  1. `core/recommend/` 实际 **10 + 20 = 30 个 kt 源文件**（起草稿与进度文档的「radio 21」为误记，
     含测试类）；音频特征四件套仍**零代码**，命中只有 3 处注释。
  2. 取链不止一处：`PlayerRuntime.kt:68-69` 是 `var urlResolver` 的**默认 lambda**
     （无条件 `userApi.getMusicUrl`），`PlayerCore` 在 `:91` 通过 `urlResolver.getUrl(info)` 绑定。
     → Lane B 的 `source == "local"` 分支必须落在**默认 provider 内**（外层替换者也得过它），
     否则 `RadioRuntime` 等替换 `urlResolver` 的路径会绕过本地分支。
  3. `ListDetailPage.kt` 操作行实为 **7 项**（重命名/清空/删除列表/排序/去重/导入/导出），
     起草稿第 5 项「删除」实为多选态的批量删除，不在菜单行。
  4. `rankState` 的 `blocked`/`hidden`：**core 侧已消费**（`PlaylistRank.kt:117-131`
     先剔踩雷歌单再剔隐藏 key），未接的只是 app 侧装配 —— `SonglistRuntime.kt:257`
     仍以 `RecommendProfile.rankState(profile)` 传默认 null。Lane A 只补写入方与传参，不重写 core。
  5. `ShareCardSaver` 内部**已有** MediaStore Uri（私有 `writeBitmap(resolver, uri, bitmap)`），
     只是没往上传 —— 补返回 Uri 属低风险改动。
  6. `ui/songlist/RecommendPanel.kt` 存在（11.9 KB，w4-A 电台入口卡所在）；`ui/radio/` 仅
     `RadioPage.kt` —— Lane A 的 onboarding 入口位置与新建 `OnboardingSheet.kt` 成立。
  7. `core/local/` 不存在，`SafDocuments` 仍只有字节 API，RN 侧
     `localMediaMetadata.ts` / `ListMenu.tsx` / `deeplink/*` 五个文件均在，对照无悬空引用。

**复核修订记录（起草时点，快照前）**：

- w5-A：M3 代码面零存在（grep 证实），任务 2/4/5/6 全是新建；`rankState` blocked/hidden
  「已预留未接」按 w3-B 报告写死；onboarding 入口写死为 `ui/songlist/RecommendPanel.kt`
  （`HomePage.kt` 归 C，禁触）。
- w5-B：取链签名写死为 `MusicUrlProvider.getUrl(info): String?`（`PlayerRuntime.kt:69` 接线）；
  `sanitizeMusicInfo` 的 local 兜底规则写死；`ListDetailPage` 现有菜单项写死为
  「重命名/清空/删除列表/排序/删除/去重/导入/导出」（**没有本地文件**）；Manifest 不动。
- w5-C：RN 列表菜单九项与 `disabled` 规则写死；`ShareCardSaver` 需补 Uri；
  `DefaultSetting` 既有分享键写死（不许重复造键）；deeplink 只做 `music`/`songlist`/`player`
  与 json/lxmc 文件打开，`js` 与音频文件留遗留。

用法不变：

```
协调会话（主仓库：复核修订任务书 → 波前快照 → 建 worktree）
        └──▶ 车道 A/B/C 并行 ──lane 报告 commit──▶ 集成会话（主仓库，顺序 B→C→A）
```

- 车道会话工作目录：`..\music-w5\laneA / laneB / laneC`，分支 `w5/laneX`。
- 开工顺序建议：先开 **B**（本地曲库最重、且有对外 API），再 C（要调 B 的 API），
  A（推荐收口）最后开；三车道不要同时进入全量构建阶段。
- 每个代码块整段复制给对应会话。

## Wave 5 冲突面（波前审计已做）

| 文件/目录 | Lane A（推荐收口） | Lane B（本地曲库） | Lane C（入口/分享） |
|:--|:--:|:--:|:--:|
| `core/recommend/**`（含新建 `m3/`）、`ui/radio/**`、`ui/songlist/RecommendPanel.kt` | ✔ 独占 | 禁 | 禁 |
| `core/player/**`（仅电台写入点）、`app/data/{Radio,RadioState,Dislike,RecommendProfile,SimilarArtist}Runtime.kt` | ✔ 独占 | 禁 | 禁 |
| `core/local/**`（新建）、`app/data/LocalMusicRuntime.kt` | 禁 | ✔ 独占 | 只调用公开 API |
| `app/player/PlayerRuntime.kt` | 禁 | ✔ 独占 | 禁（只调用既有方法） |
| `ui/list/ListDetailPage.kt`、`ui/list/LocalFileImportDialog.kt` | 禁 | ✔ 独占 | 禁（C 只新增 `ListMenuActions.kt`） |
| `util/SafDocuments.kt` | 禁 | ✔ 独占（只新增 API） | 只调用 |
| `ui/play/CoverImageLoader.kt` | 禁 | ✔ 只新增本地封面入口 | 禁 |
| `ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`、`AndroidManifest.xml` | 禁 | 禁 | ✔ 独占 |
| `ui/share/**`、`core/share/**` | 禁 | 禁 | ✔ 独占 |
| `core/setting/DefaultSetting.kt`（仅表尾）、`ui/settings/**` | 禁 | 禁 | ✔ 可选 |
| `ui/search/**`、`core/music/search/**`、`userapi/**` | 禁 | 禁 | 禁 |
| 音频特征四件套（`audioEmbedding`/`audioFeature`/`melSpectrogram`/`nativeAudio`） | **全波禁触** | **全波禁触** | **全波禁触** |

三条车道两两不相交，三处交叉全部是「调用」而非「共写」：
① B 的 `LocalMusicRuntime` 公开 API 供 C 的首页长按菜单调用（签名先提交、后实现，改要通知集成）；
② B 扩 `SafDocuments`（只新增），C 只调用；
③ C 的 `ListMenuActions` 与 `ListDetailPage` 内联逻辑短期重复——因为 `ListDetailPage` 归 B，
属**已知取舍**，Wave6 统一收口。

---

## 协调会话 —— 任务书复核修订 + 波前快照 + 建 worktree

```text
你是 Kotlin 迁移 Wave5 的协调会话。只在当前主仓库目录工作。不写业务代码，不 push。
前提确认（问我一句）：是否已无其他会话在主仓库工作、main 是否就是最新现状；
以及 docs/waves/w5-prompts.md 顶部「待你拍板的三件」是否按默认走。

步骤：
1. 通读 docs/waves/RULES.md、docs/kotlin-migration-progress.md（重点：批次速查表、
   Wave4 集成记录、各批待办、w4-A/B/C 报告遗留）、docs/waves/w5-A.md / w5-B.md / w5-C.md、本文。
2. 【教训2：逐条复核 w5 任务书假设，漂移就直接改任务书】
   - grep audioEmbedding/melSpectrogram/nativeAudio 在 core/ 与 app/ 是否仍零代码
     （若已有人动手，w5-A 任务 9 改为核对现状）；
   - grep combinedClickable/onLongClick app/ 是否仍为空（若已做长按菜单，w5-C 任务 1 改为核对）；
   - 看 PlayerRuntime 取链是否已加 source=="local" 分支、MusicInfoTools 的 local 兜底是否还在；
   - 看 AndroidManifest 是否已有 scheme、MainActivity 是否已实现 onNewIntent；
   - 看 ShareCardSaver.save 返回类型是否已带 Uri、DefaultSetting 的 share 键是否仍只有那三个；
   - 看 ListDetailPage 菜单项是否仍无「本地文件」、SafDocuments 是否仍无目录树 API；
   - 核对基线：应为 core 742 + app 76 = 818（与进度文档「验证基线」一致）。
3. 跑基线：cd android-native && GRADLE_USER_HOME=E:/GradleHome ./gradlew.bat
   ktlintCheck test assembleDebug 必须全绿；数字不符先查清再动。
4. 仓库卫生：git status 里 RN 侧（src/、package.json）的未提交改动一律保持原样
   （不 add、不 stash、不还原）；docs 下若有未入库的评估文档，单独一笔 chore 提交。
5. 波前快照：git add docs/waves ; git commit -m "chore(wave5): 三车道任务书与并行会话提示词预草稿"
   以及 docs/kotlin-migration-progress.md 若仍有未提交的 Wave4 收口改动，一并提交
   （消息区分：docs(wave4) 收口 / chore(wave5) 任务书）。
6. 建 worktree + 拷 local.properties + 冒烟：
   git worktree add ../music-w5/laneA -b w5/laneA HEAD
   git worktree add ../music-w5/laneB -b w5/laneB HEAD
   git worktree add ../music-w5/laneC -b w5/laneC HEAD
   每份拷 android-native/local.properties；任选一个跑 compileDebugKotlin。
7. 汇报：提交哈希、实测测试数、三个 worktree 绝对路径、任务书修订点清单，
   并给出「本波开工前是否值得先做一次真机清账（Wave1~4 累计 60+ 条）」的判断。停下。
```

---

## 车道 A —— 推荐收口包 S16：M3 简化版 + 相似歌手通道 E + onboarding

```text
你是 Wave5 Lane A 执行会话，任务：推荐收口——M3 简化版（标签相似/MMR/语种配额/时段）
+ 相似歌手通道 E（MusicBrainz/ListenBrainz）+ onboarding 问卷 + 画像结算闭环（S16）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w5/laneA 绝对路径>，
分支 w5/laneA。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 必读「M1 落地后的真实边界」、B5 第十五切片
   （Wave4 Lane A）与 w4-A 报告遗留 2/3（M3 退化清单、探索通道 C 无候选）
4. docs/waves/w5-A.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w5/laneA
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，
  测试数与基线一致（只会等于或大于；变少=有人删测试，停下报告）
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 音频特征四件套（audioEmbedding/audioFeature/melSpectrogram/nativeAudio）**一个字不写**，
  任务 9 只交代价评估报告。这是本波最容易越界的地方。
- 先写映射表再写代码：RN 每个文件保留什么、降级什么、砍掉什么，逐条给理由；
  降级清单进报告，别默默少做。
- onboarding 是语种配额的前置，**必做**；入口只能放 ui/songlist/RecommendPanel.kt 与
  ui/radio/，`ui/HomePage.kt` / `HomeNavigator.kt` 归 Lane C，动了就是越界。
- MB/LB 是公网第三方：必须带 User-Agent、限 1 req/s、失败静默降级（退回 A/B/D 通道），
  断网/限流/超时都要有单测路径；缓存另起键，不与 RN 共用。
- RNG 与时钟全部注入（rng: () -> Double、now: () -> Long），单测锁种子；
  项目教训：不可注入的随机源会让用例抖动。
- `rankState` 的 blocked/hidden 是「已预留未接」，接上后要补用例证明真的过滤。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；缺口在禁触区 → 写进 lane 报告，不动手。
- RN（src/）只读对照，以 worktree 内已提交版本为准，差异记报告。
- 按逻辑小块中途 commit，消息以 W5-laneA: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W5-laneA: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w5-A.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 B —— 本地曲库 S17：SAF 扫描 + 元数据 + local 直连播放

```text
你是 Wave5 Lane B 执行会话，任务：本地曲库（SAF 目录树扫描 + MediaMetadataRetriever 元数据
+ source=="local" 直连播放 + 列表「本地文件」导入）（S17）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w5/laneB 绝对路径>，
分支 w5/laneB。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B5 第十四切片（Wave4 Lane C）报告末尾的
   「本地文件（只评估）」结论、B2 取链与音量均衡约束
4. docs/waves/w5-B.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w5/laneB
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，测试数与基线一致
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 你是本波 `app/player/PlayerRuntime.kt` 的唯一持有者；local 分支只加在取链上
  （`MusicUrlProvider.getUrl` 返回 content:// / file:// 字符串即可，Media3 原生支持），
  **不要改 PlayerCore 的签名**；音量均衡开启时 isEnableAudioOffload 必须 false 的约束不许碰丢。
- `MusicInfoTools.sanitizeMusicInfo` 已经能兜 local 字段（filePath 缺失回填 id、ext 反推），
  先读它再决定要不要动，别重复造模型。
- SAF 不需要 READ_MEDIA_AUDIO：**Manifest 禁触**。持久授权要 takePersistableUriPermission，
  否则重启后全变哑巴——这是真机清单第一项。
- 先纯规则后系统 API：core/local 的文件名解析/扩展名判定/id 规则/排序全部 JVM 可测，
  系统侧（Retriever、DocumentFile）只能靠真机清单，报告里要写清楚哪些没被单测覆盖。
- **公开 API 必须先落地再实现**：`LocalMusicRuntime.importTo(listId, listTitle)` 等签名
  要尽早提交并在报告里写死——Lane C 的首页长按菜单直接调它，签名改了会打断别人。
- 大目录（1000+）要有进度与可取消；单条失败降级，不许中断整批。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；`ui/list/ListDetailPage.kt` 只加「本地文件」一项与弹层接线。
- `ui/settings/`、`core/setting/` 归 Lane C：本地偏好用进程级默认，缺口写遗留，不许加设置键。
- RN（src/）只读对照：src/utils/localMediaMetadata.ts、Mylist/MyList/listAction.ts 等。
- 按逻辑小块中途 commit，消息以 W5-laneB: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W5-laneB: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w5-B.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 车道 C —— 入口与分享收尾 S18：首页长按菜单 + deeplink + 系统分享

```text
你是 Wave5 Lane C 执行会话，任务：入口与分享收尾——首页列表行长按菜单（RN 九项同构）
+ lxmusic:// deeplink（含 json/lxmc 文件打开）+ 系统分享 chooser（S18）。

你的工作区是独立 git worktree：<协调会话汇报的 music-w5/laneC 绝对路径>，
分支 w5/laneC。其他会话在别的目录、别的分支工作，互相看不到改动——
不要试图同步，不要离开本目录，不要切分支，禁止 push/merge/rebase/stash/reset。

【开工必读（按顺序、全文）】
1. AGENTS.md —— 竖屏约束（Manifest 只许加 intent-filter，**禁动 screenOrientation**）
2. docs/waves/RULES.md —— 工作纪律与收尾三步
3. docs/kotlin-migration-progress.md —— 重点 B5 各切片遗留（首页长按菜单/deeplink 被延期两次）、
   B4 分享卡（Wave4 Lane B）与 w4-B 报告遗留 1/2
4. docs/waves/w5-C.md —— 你的任务书；「范围/禁触」是最终裁决

【开工自检（任何一项不过 → 停下报告，不要自行补救）】
- git status 干净，当前分支是 w5/laneC
- cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿，测试数与基线一致
- android-native/local.properties 存在，缺失停下报告

【本车道特别提醒】
- 列表菜单九项按 RN ListMenu.tsx 对齐，**disabled 规则要照抄**（试听列表/我的收藏禁重命名删除、
  非用户列表禁同步）。实现放新文件 ui/list/ListMenuActions.kt——
  `ui/list/ListDetailPage.kt` 归 Lane B，**一个字不许改**；短期逻辑重复是已知取舍，写遗留。
- 「本地文件」项调用 Lane B 的 `LocalMusicRuntime.importTo(...)`；B 还没落地就置灰并写遗留，
  不要自己实现目录选择。
- deeplink 解析必须是可测纯函数（`lxmusic://<type>/<action>/<paths>` 样本表进 JVM 单测），
  不要埋在 onCreate 里；`launchMode` 若调整要单独记报告；竖屏属性绝对不许碰。
- `app/player/` 归 Lane B：deeplink 的 player 动作只调用既有公开方法，缺方法就降级该分支。
- 系统分享要先让 `ShareCardSaver.save` 返回 uri（扩结果类型，不改既有语义），
  再走 ACTION_SEND；`common.shareType` / `shareCard.savePath` 既有键直接用，
  DefaultSetting 只许表尾追加，不许改既有默认值。
- 「搜索歌手/专辑类型」本波不做，只交立项输入（五源 × 两类的 core 文件与接口清单）。

【硬约束（RULES 摘要）】
- 只改任务书「范围」内的文件；`util/SafDocuments.kt` 只许调用（Lane B 在扩它）。
- RN（src/）只读对照：MyList/ListMenu.tsx、src/core/init/deeplink/**、ShareCard/。
- 按逻辑小块中途 commit，消息以 W5-laneC: 开头。

【收尾（做不完也必须走完三步，宁可少做不可不收尾）】
1. cd android-native && gradlew.bat ktlintCheck test assembleDebug 全绿
2. git add -A && git commit -m "W5-laneC: <任务名>（core X + app Y 全绿）"
3. 按 RULES 模板把 lane 报告追加到 docs/waves/w5-C.md 末尾，
   git add docs/waves && git commit
完成后停下等待集成，不要开始任何其他任务。
```

---

## 集成会话 —— 按序合并三条车道（主仓库，顺序 B → C → A）

```text
你是 Kotlin 迁移 Wave5 的集成会话。只在主仓库目录工作，不写业务功能代码，不 push（除非我要求）。

前提：三条车道都已按 RULES 收尾（各自分支最后两笔 = 成果 + lane 报告）。
先读完 docs/waves/w5-A.md / w5-B.md / w5-C.md 末尾的 lane 报告再动手。

步骤：
1. 主仓库 git status：RN 侧未提交改动保持原样（不 add、不 stash、不还原）；记下 HEAD。
2. 按 B → C → A 顺序逐条合并（本地曲库先进——C 依赖它的公开 API；A 最重最后）：
   git merge --no-ff w5/laneX -m "merge(wave5): laneX <任务名>"
   - 每并完一条立刻 cd android-native && gradlew.bat ktlintCheck test assembleDebug，
     全绿才许并下一条。
   - 已知交叉点：C 的首页长按菜单调 B 的 `LocalMusicRuntime`；B 扩了 `SafDocuments`
     而 C 只调用——若编译不过，优先在 B 侧补兼容重载/默认参数（不改语义），
     不要动 C 的业务代码。
   - 已知取舍：`ListMenuActions` 与 `ListDetailPage` 去重/导入/导出逻辑重复，
     合并**不强行统一**（统一会动两条车道的文件），记进 Wave6 待办。
   - Lane A 动了 core/player 与画像结算：合并后重点跑闪电台相关用例，
     确认「playedList 只由电台写入」这条 B2 语义没被结算闭环带歪。
3. 三条全绿后统一收尾：
   - 更新 docs/kotlin-migration-progress.md：速查表（B2/B4/B5/B6）、各批新增切片、
     遗留逐条勾销/改述（M3 简化版落地与音频特征延后、onboarding、「更多」分页、
     首页长按菜单、deeplink、系统分享、share 设置、本地文件/同步、搜索 singer/album、
     morph 评估）、验证基线数字与 APK sha256；
   - 各 lane「语义修正」并入对应批次表格；
   - git add docs && git commit -m "docs(wave5): 三车道收口，进度文档对齐"
4. 清理：git worktree remove ../music-w5/laneX --force（三条）；
   git branch -d w5/laneX（-d 失败=没并进 main，停下报告）。
5. 汇报：三条 merge 哈希、最终测试数、APK、真机清单累计数
   （Wave1~5，**强烈建议此刻安排一次真机清账**：JVM 闸门全绿 ≠ 可发版），
   并给出 Wave6（B7 收官）的立项输入清单。
```

---

## Wave 5 之后还剩什么（Wave 6 候选，此处只列不立项）

- **B7 收官（串行，不开车道）**：RN 数据一次性迁移导入、release 签名决策、R8/混淆规则、
  双通道收尾、`ListMenuActions` 与 `ListDetailPage` 逻辑统一。
- **搜索类型扩展**：`album` / `artist` 两类 × 五源解析（RN 四类，原生只有 music/songlist），
  独立 M 级任务。
- **音频相似专项评审**：拿 Lane A 的代价评估当输入，决定做/不做/永远砍掉。
- **「更多」分页 / onboarding 剩余题型 / 播放页 morph 转场**（若本波仍未收）。
- **真机清账**：Wave1~5 累计清单（发版硬项，用户本人执行）。
