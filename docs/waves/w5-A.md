# Wave 5 · Lane A 任务书 —— S16 推荐收口包：M3 简化版（相似/MMR/语种配额/时段）+ 相似歌手通道 E + onboarding 问卷

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **起草时点复核**（2026-10-26；基线 = Wave4 并入后 `f214bd8`，core 742 + app 76 = 818，
> APK 28,860,935 B）。协调会话投用前仍要逐条复核（教训 2）。已复核事实：
>
> - `core/recommend/` 现有 **10 个 M1 文件 + `radio/` 20 个 M2 文件 = 30 个 kt 源文件**
>   （进度文档「21 文件」含测试类，实测 source 为 20）；
>   `audioEmbedding` / `audioFeature` / `melSpectrogram` / `nativeAudio` **零代码**
>   （全工程命中仅 3 处注释：`SonglistRuntime.kt:201-202`、`RadioConfig.kt:5`）。
> - RN `similarArtist.ts` 走的是 **MusicBrainz + ListenBrainz 公网接口**，不是五源歌手接口；
>   MB 强制要求 `User-Agent` 且限 1 req/s。解析 / 阶段状态机 / 预算是纯函数，网络由
>   `index.ts` 注入。
> - RN `languageQuota.ts` 的目标首数来自 `onboarding.weights`（问卷百分比），缺省是
>   `onboarding.ts` 的 `NEUTRAL_PERCENT`。**onboarding 因此从「可选项」升为必做**。
> - `rankState` 的 `blocked` / `hidden`「已预留、未接」（w3-B 报告），本波接上。
>   **协调会话复核补充**：core 侧其实**已经消费**这两个参数（`PlaylistRank.kt:117-131`
>   先按踩雷规则剔歌单、再按 `source::id` 剔隐藏 key）；真正没接的是 app 侧装配 ——
>   `SonglistRuntime.kt:257` 仍用 `RecommendProfile.rankState(profile)` 走默认 `null`。
>   所以任务 7 的活是「产出 blocked/hidden 的写入方 + 在装配点传进去」，**不要重写 PlaylistRank**。

## 背景与决议

Wave4 Lane A 落地 M2 时留下降级清单（见 `w4-A.md` 报告遗留 2/3）：探索通道 C **没有候选来源**、
无同作品软降频/分类轮换/语种硬配额、`importedOrigins` 恒空 —— 电台能跑，但「撞新」能力明显弱于 RN。

本波用**简化版 M3** 关掉这批欠账：

- **做**：`similarity`（纯标签/画像相似，不碰音频向量）、`diversity`（MMR + softmax 采样，
  RNG 注入）、`language` + `languageQuota`（八桶四层判定 + 硬配额）、`timeSlot`（时段权重）、
  `similarArtist`（MB/LB 通道 E）、onboarding 问卷、显式反馈结算与 hidden/blocked 接入。
- **不做**：音频特征三件套（`nativeAudio`/`melSpectrogram`/`audioEmbedding`）+ `audioFeature`
  离线特征。本波只在报告里交一份「原生等价实现代价评估」，供 Wave6 之后专项评审。
- **理由**：硬约束是无自建后端 + 永久免费，音频 DSP 的原生代价与收益比在 w3 评估里已经不划算；
  先用「标签相似 + MMR + 配额」验证撞新能否做到可用，再决定要不要上音频。

## 任务

1. **语义实证 + 映射表（先交文档再写代码）**：通读 RN `src/core/recommend/` 的
   `similarity.ts`、`diversity.ts`、`language.ts`、`languageQuota.ts`、`timeSlot.ts`、
   `similarArtist.ts`、`similarArtistStore.ts`、`artistLanguageStore.ts`、`onboarding.ts`、
   `feedback.ts`、`candidate.ts`（只读消费侧）。逐文件写「保留 / 降级 / 砍掉」映射表进
   lane 报告，每处降级给理由。
2. **语种与配额（纯规则）**：新增 `core/recommend/m3/Language.kt`、`LanguageQuota.kt`。
   八桶（zh/yue/en/ja/ko/other/instr/unknown）+ 四层判定（kg 中文词表 → 逐曲字段 →
   分类 L2 → 歌名/歌手启发式），**宁缺毋滥，判不出就 unknown，绝不硬判 en**。
   配额算术必须夹紧窗口 0/负数（RN `windowSlice` 注释里的 `slice(-0)` 坑）。
   JVM 单测覆盖 zh/粤/en/日/纯音乐/unknown 混合 fixture。
3. **onboarding 问卷（必做）**：`core/recommend/m3/Onboarding.kt`（选项 id = 持久化键
   `onboarding.weights`、aliases 全量归一化进 themeWeights 精确键、`NEUTRAL_PERCENT` 缺省）
   + 问卷 UI。**入口只能放本 lane 可触的位置**：`ui/songlist/RecommendPanel.kt` 顶部卡片
   （与 w4-A 的电台入口卡同处），问卷本体建 `ui/radio/OnboardingSheet.kt`。
   `ui/HomePage.kt` / `HomeNavigator.kt` 归 Lane C，**一个字不许动**。
4. **相似度与多样性**：`Similarity.kt`（歌手/标签/语种/年代的 余弦 或 Jaccard，输入普通 Map）、
   `Diversity.kt`（MMR λ 可配 + 同作品软降频 + 分类轮换 + softmax 采样）。
   RNG 一律 `rng: () -> Double` 注入，单测锁种子（项目教训：不可注入的随机源会让用例抖动）。
5. **时段权重**：`TimeSlot.kt` 对照 RN `timeSlot.ts` 的时段划分与权重曲线；
   时钟注入 `now: () -> Long`，**不读系统时间**。
6. **相似歌手通道 E**：`SimilarArtist.kt`（MB 响应解析 + 阶段状态机 + 缓存整理 + 预算调度，
   网络用注入的 `fetch`）+ app 侧 `data/SimilarArtistRuntime.kt`（用既有 HTTP 通道实现 fetch）。
   合规硬要求：**带 `User-Agent`、全局限 1 req/s、失败静默降级**（拿不到就退回 A/B/D 通道，
   不许弹错、不许卡住取曲）。缓存键另起 `xunyin_recommend_similar_artist_v1`，与 RN 同键不互解析。
7. **结算闭环与 hidden/blocked**：显式反馈（喜欢 / 不感兴趣 / 跳过 / 完播）结算进
   `ThemeFeedback` 与 `NameTokenFeedback`；`rankState` 的 blocked/hidden 接上
   （**只需补写入方 + 在 `SonglistRuntime.kt:257` 的装配点传参**，`PlaylistRank` 判定逻辑不动）；
   隐藏歌单 UI 落 `ui/radio/`。`importedOrigins` 若 M1 已补来源映射则接，否则维持空并更新遗留。
8. **探索通道 C 打开**：候选来源接上（相似歌手 + 相似曲 + 语种缺口补货），配额从
   「fallback 让位」改为真实 A/B/C/D 分配。报告给撞新真机对照点（连续 30 首陌生曲占比、语种分布）。
9. **音频特征代价评估（只写报告）**：三条候选路线（Kotlin 纯 FFT / NDK 复刻 RN mel /
   离线预计算）各自工程量、包体积、耗电与风险，结论供 Wave6 立项。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`（新代码优先放 `recommend/m3/`；
  M1 既有文件只许增量，既有函数签名不改）
- `android-native/core/src/main/kotlin/cn/toside/music/core/player/`（仅电台写入点，尽量不动）
- `android-native/app/.../data/` 的 `RadioRuntime.kt`、`RadioStateStore.kt`、`DislikeStore.kt`、
  `RecommendProfileRuntime.kt`，新增 `SimilarArtistRuntime.kt`
- `android-native/app/.../ui/radio/`、`android-native/app/.../ui/songlist/RecommendPanel.kt`（仅此一个文件）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`、`AndroidManifest.xml`（Lane C 范围）
- `ui/share/`、`core/.../share/`、`ui/settings/`、`core/.../setting/`（Lane C 分享收尾与设置小节）
- `ui/list/`、`core/local/`（新建）、`app/.../player/PlayerRuntime.kt`、`util/`（Lane B 本地曲库）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`.github/`、gradle 与版本目录
- **音频特征**：`audioEmbedding` / `audioFeature` / `melSpectrogram` / `nativeAudio` 一个字不写

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- M3 每个纯规则文件都有 JVM 单测；RNG/时钟注入的说明写进报告；
- 电台「取曲 → 播放 → 反馈 → 再取曲」有 JVM 端到端用例（FakePlatform + FakeFetcher，
  含 MB 超时/降级路径）；
- 报告含：映射表、降级清单、探索通道 C 前后对比、音频特征代价评估、真机清单
  （撞新占比、语种分布、问卷生效、隐藏歌单、MB 断网不崩）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告

### 1. 语义实证与映射表（任务 1，先文档后代码）

复核基线：`w5/laneA` 起点 `2097867`（= Wave4 并入后 `f214bd8` + 一份文档提交）。
RN 侧逐文件通读 `src/core/recommend/` 的 11 个文件，调用图（`grep` 实测，不是记忆）：

- `index.ts` 消费 `language.ts` / `languageQuota.ts` / `onboarding.ts` / `timeSlot.ts` /
  `similarity.ts`（`buildTrackPlaylistIndex` / `buildSessionCoOccurrence`）/ `diversity.ts`
  （`selectFinalQueue`）/ `similarArtist.ts`（`inferArtistLangFromTags` / `runSimilarArtistRefresh`）；
- `candidatePool.ts` 消费 `language.ts` 的 `resolveLang` / `bucketFromLangField`；
- `candidate.ts` 消费 `similarity.ts` 的 `computeCandidateCoOccurrence` /
  `computeProfileAffinity` / `groupSimilarPlaylists` / `buildTrackPlaylistIndex`，
  以及 `languageQuota.ts` 的 `countPoolLang` / `computeBucketDetailReserve`。

| RN 文件 | 结论 | 原生落点 | 理由 |
| --- | --- | --- | --- |
| `language.ts`（278） | **保留**（1 处降级） | `core/.../recommend/m3/Language.kt` | 八桶 + 四级判定是纯字符串/数值规则，零 IO。`ArtistLangTable` 用 `MutableMap` 就地合并即可，RN 的「脏条目补数字」防御在 Kotlin 里由类型系统兜一半，但 `table` 来自 JSON 反序列化，仍保留 bucket 合法性校验（L3 分支）。**降级**：`bucketFromLyric` 的调用方（歌词拉取）本波不接——原生侧没有「取到候选后异步拉歌词」的通道，L3 只由 `field` 与 `relation` 两个来源喂；`lyric` 强度常量保留以备 Wave6。 |
| `languageQuota.ts`（223） | **保留** | `core/.../recommend/m3/LanguageQuota.kt` | 纯算术，`windowSlice` 的 `slice(-0)` 坑在 Kotlin `takeLast(0)` 上是空列表（不会退化成全量），但仍显式夹紧，理由写进函数注释。`computePoolBucketLimits` / `computeBucketDetailReserve` 属供给侧（`candidate.ts`），本波候选池只有单条 `PoolCandidate` 路径，**只移植这两个函数但暂不接线**，留给 Wave6 桶召回。 |
| `onboarding.ts`（155） | **保留** | `core/.../recommend/m3/Onboarding.kt` | 选项表 + 三条纯函数（`sanitizeWeights` / `computeSeedWeights` / `computePreferenceKeywords`）。`applySeedWeights` / `revokeSeedWeights` 直接改传进来的 `MutableMap<String, ThemePreference>`，与 RN 的「共享引用」语义一致。`normalizeText` 复用既有 `TrackKeys.normalizeText`，不复制第二份归一化。 |
| `timeSlot.ts`（72） | **保留**（时钟与区时注入） | `core/.../recommend/m3/TimeSlot.kt` | RN 用 `new Date(now).getHours()`（本地时区）。原生用 `java.time` 显式注入 `ZoneId`，默认参数取系统时区，单测传 `ZoneId.of("Asia/Shanghai")` 锁死。时钟一律 `now: () -> Long`，文件内不出现 `System.currentTimeMillis()`。**降级**：无。 |
| `similarity.ts`（262） | **降级** | `core/.../recommend/m3/Similarity.kt` | 原文件 12 个导出里，`buildSessionCoOccurrence` / `computeCandidateCoOccurrence` / `groupSimilarPlaylists` / `buildTrackPlaylistIndex` 全部依赖「已观察歌单」这套数据（`ObservedPlaylist` + 倒排索引 + 覆盖率），原生 M2 的候选池没有多歌单观察链路，照搬会得到一个恒 0 的函数。**保留**：`computeCoOccurrence` / `computePlaylistAffinity` / `decayWeight` / `computeFeedbackQuality` / `computeExposureScore` / `computePopularityDamping` / `computePlaylistSimilarity`（Jaccard），全部纯算术。**新增**（任务书要求「歌手/标签/语种/年代的 余弦 或 Jaccard」）：`artistCosine` / `tagCosine` / `langSimilarity` / `eraSimilarity` 四个面向「普通 Map」的相似度，输入是 `Map<String, Double>` 而非 RN 的固定画像结构。**砍掉**：SAR 会话共现（`buildSessionCoOccurrence`）——它要 `radioHistory` 带 `coverage` + `startedAt` 的会话切分，原生 `RadioPlayRecord` 字段齐备但候选打分入口在 `RadioScoring`（M2 文件，本波只许增量），接线收益低于改动风险，列入遗留。 |
| `diversity.ts`（389） | **降级** | `core/.../recommend/m3/Diversity.kt` | 保留骨架：五档放宽阶梯、`checkItemConstraints` 的语种/歌手/歌单/专辑/种子/榜单/相似组七类约束、`softmaxSample`（温度夹紧 + 质量门槛）、探索间隔让位、`no_candidate_after_relaxation` / `fallback_channel` / `lang_consecutive_relaxed` / `lang_quota_relaxed` 四条降级原因。**降级三处**：① MMR 用「λ 加权的相关性-多样性折中」简化版（RN 侧 MMR 在 `mmr` 模块，本波按任务书要求放进 `Diversity.kt` 自成一体）；② 同作品软降频用 `workKey` 精确相等（RN 同）；③ 分类轮换退化为「同 groupIds 在窗口内出现次数超比例即降权」，不做 RN 的滑动轮换位。**砍掉**：`countFinalChannels`（原生 `Channels.countChannels` 已有等价物）。 |
| `similarArtist.ts`（579） | **保留** | `core/.../recommend/m3/SimilarArtist.kt` | 解析（MB search / MB lookup / LB similar）、四阶段状态机、缓存整理（TTL + 容量 + pending 不受 TTL）、预算调度、种子轮换、`inferArtistLangFromTags` 全部是纯函数，网络靠注入的 `suspend` 函数——与 RN 的 `SimilarArtistIo` 一一对应。**降级**：`runSimilarArtistRefresh` 的 `Promise` 串行改 `suspend` 顺序执行（原生本来就跑在协程里，不需要手动队列）。 |
| `similarArtistStore.ts`（179） | **降级** | `app/.../data/SimilarArtistRuntime.kt` | 存储形状、TTL、容量、防抖落盘、`persistAllowed` 降级策略全部照搬；HTTP 层重写为 `HttpURLConnection` + **全局限 1 req/s 的串行队列** + MB 强制 `User-Agent`。**缓存键另起** `xunyin_recommend_similar_artist_v1`（RN 是 `xunyin_recommend_artistsim_v1`）——形状不同不互解析，任务书硬要求。 |
| `artistLanguageStore.ts`（122） | **保留** | `app/.../data/ArtistLangStore.kt` | 三个观察入口（`lyric` / `field` / `relation`）+ 防抖落盘 + 读盘失败不落盘。键沿用 RN 的 `xunyin_recommend_artist_lang_v1`（形状一致，可互读）。 |
| `feedback.ts`（494） | **增量接线，不新增文件** | 既有 `core/.../recommend/ThemeFeedback.kt` / `NameTokenFeedback.kt` + `app/.../data/RadioRuntime.kt` | RN 的 `settlePlayRecord` / `settleExplicitFeedback` 在 M2 已有等价物（`RadioBehavior` / `RadioSettlement`）。本波只补「显式反馈结算进主题与词面」这一段：`like` / `dislike` / `early_skip` 三类目前只落 `TrackPreference` 与 `PlaylistPreference`，没有进 `ThemePreference`（分类）与 `TokenPreference`（词面）。 |
| `candidate.ts`（698） | **只读消费侧**（不移植） | —— | 候选抓取（`sdkCatalog` 分页 / 桶召回 / 详情预算 / `knownExternalPlaylists`）是 RN 侧的数据供给层，原生对应的是 `RadioRuntime` 的 `VoiceFetcher` / `RelatedFetcher`（M2 已有）。本波只按任务 8 给通道 C 补**一个**真实候选来源（相似歌手），不重写候选抓取。`computeBucketDetailReserve` / `computePoolBucketLimits` 因此只移植、不接线。 |
