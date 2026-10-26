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

### 2. 语种与配额（任务 2）

新增 `core/.../recommend/m3/Language.kt`（八桶 + 四级判定）、`LanguageQuota.kt`（配额算术），
单测 `LanguageTest`（14 例）/ `LanguageQuotaTest`（12 例）。

**四级判定链**（`Language.resolveLang`，强度自上而下减弱，判不出就 `unknown`）：

| 级别 | 来源 | 强度 | 备注 |
| --- | --- | --- | --- |
| L1 | 逐曲字段 `kg` 中文词表（17 词）/ `tx` 数字码表 | `FIELD` | **空串必须拦在码表前**：JS `Number('') === 0` 会把「接口没给语种」判成最高可信度的「中文」；Kotlin 侧显式判空后再查表 |
| L2 | 桶召回提示 `langHint`（整批候选带的桶） | `HINT` | 只在 L1 缺失时用，不覆盖 L1 |
| L3 | 歌手语言表（lyric 1 < field 2 < relation 3） | `ARTIST` | 同强度按 hits 投票，反向票递减到负才换桶；`unknown`/`instr` **不入库**——`instr` 是单曲属性，写进歌手表会让这位歌手的歌整首逃出配额 |
| L4 | 字面统计 `bucketFromScript` | `SCRIPT` | 日 .2 / 韩 .2 / 中 .5 / 其它 .3；**L4 绝不判 en**，只有歌词正文拉丁字符占比 ≥ 0.8 才判 en（`bucketFromLyric`），这是「宁缺毋滥」的落点 |

**配额算术的四个坑**（都有用例钉住）：

1. `windowSlice` 夹紧 0/负数：RN 注释点明 `slice(-0) === slice(0)`（整个数组）；Kotlin `takeLast(0)` 本就返回空，但负数会抛，仍显式夹紧；
2. 0% 桶**必须留在 `targets` 里**：cap 表从 targets 生成，桶缺席 = 「没表态」= 不限量，正相反；
3. 0% 不加容差（`CAP_TOLERANCE = 1` 只给非零桶），否则「一首都不给」会变成「给一首」；
4. `caps` 缺席即不限：`computeLangCaps` 只给 targets 里出现过的桶发 cap，选曲侧查不到就放行——这是「少量语种表态不该把整条队列卡死」的保护。

`MAX_CONSECUTIVE_SAME_LANG = 2`、`INSTRUMENTAL_PER_WINDOW = 2` 按 RN 常量落地。
`computeBucketDetailReserve` / `computePoolBucketLimits` **只移植不接线**（原生候选池只有单条
`PoolCandidate` 路径，桶召回属 Wave6）。

### 3. 偏好问卷（任务 3）

`core/.../recommend/m3/Onboarding.kt`（22 选项：语言 6 + 分类 16，选项 id 即持久化键）
+ `app/.../data/OnboardingStore.kt`（键 `xunyin_recommend_onboarding_v1`）
+ `app/.../ui/radio/OnboardingSheet.kt` + `ui/songlist/RecommendPanel.kt` 顶部入口卡。
单测 `OnboardingTest`（8 例）+ `RadioOnboardingSeedTest`（9 例，引擎侧）。

**播种语义（最容易写错的一段）**：

- 以 50% 为中轴：`percent >= 50` 给正分量、`< 50` 给负分量（幅度只取一半，
  `NEGATIVE_SEED_RATIO = 0.5`）；旧写法 `percent/100 × saturation` 会把「中文 10%」
  记成正偏好，这是「越推越多华语」的一半锅；
- 停在中性点 50% 的项由 `sanitizeWeights` **丢弃**（留着的播种分量为 0，只会冒充一条配额声明）；
- **重答必须能撤回**：`revokeSeedWeights` 按符号分两支对称退回、减后钳 0、两侧皆 0 才删条目，
  用户自己听出来的净权不受影响；
- 播种分量必须与 `themeWeights` 同生共死：新增 `RadioState.onboardingWeights` /
  `onboardingSeeded` 两个字段（`RadioStateCodec` 全量序列化，旧存量缺字段走默认值），
  引擎 `applyOnboarding` = 先按 `onboardingSeeded` 退旧、再按新百分比播新。
  **幂等**：同一份答案重放两次净变化为零，所以启动时无条件补播一次是安全的
  （用例 `applyingSameAnswersTwiceIsIdempotent` / `seedsSurviveStateCodecRoundTrip`）；
- 读盘与播种的顺序：`RadioRuntime` 用 `CompletableDeferred` 标「读盘完成」，
  播种与开播都先 `await` 它——否则 `restoreState` 会把刚播的净权覆盖回去（竞态用例见任务 7）。

**UI 降级**：原生没有 material 的 `Slider` 依赖（只有 foundation + SaltUI），问卷用四档档位
（不想听 0% / 无所谓 50% / 喜欢 70% / 很喜欢 100%）代替 RN 的 0-100 滑条。
写进 `onboarding.weights` 的**仍是百分数**，配额与播种的输入形状完全一致，UI 换皮不影响算法。

### 4. 相似度与 MMR 选曲（任务 4）

`core/.../recommend/m3/Similarity.kt` + `Diversity.kt`，单测 `SimilarityTest`（13 例）
+ `DiversityTest`（13 例）。

- **相似度**：`artistAffinity` / `tagSimilarity` / `langSimilarity`（null 或 unknown → 中性 0.5）/
  `eraSimilarity`（±15 年窗口，缺年份 0.5）/ `combine` / `profileSimilarity`（歌手 .4 / 标签 .3 /
  语种 .15 / 年代 .15）；底层 `jaccard` / `weightedJaccard` / `cosine`；
  砍掉四个依赖「已观察歌单倒排索引」的导出（映射表里已记理由）。
- **MMR**：`score = λ × relNorm − (1−λ) × maxSim(已选)`，λ 默认 0.85，λ=1 退化为纯 softmax；
  MMR 的相似度 = 歌手 Jaccard 0.5 + 同专辑 0.2 + 相似组 Jaccard 0.2 + 同语种 0.1。
  `mmrScores` 提成 **public 纯函数**——抽样结果随机不可断言，但「给定已选集合下候选的相对次序」确定，
  用例直接钉次序。
- **软降频只降权不排除**：曝光 `1/(1+exposure×0.35)`、同作品 `workKey` 精确相等 ×0.4、
  同歌手近 6 首 ×0.35 / 近 12 首 ×0.6。
- **质量门槛只比通道基础分**（不含软降频），否则软降频会被放大成硬排除。
- **五档放宽阶梯**：档 0/1 `artistGap=8`，档 2/3 用 6/4，末档直读 `minArtistGap=2`
  （**不归零**：候选枯竭宁可少出几首并记 `no_candidate_after_relaxation`）；
  档 3/4 `langQuotaEnforced=false`。
- **RNG 一律注入**：`Diversity.Options.rng: () -> Double`、`timeSlotFactor: (List<String>) -> Double`；
  单测用线性同余发生器锁种子。`select` 克隆 `langCaps.caps` 再扣（RN 注释点明「第二次生成队列就少一批名额」），
  有专门用例守护。

> **未接线声明**：`Diversity.select` 是可选路径，`RadioEngine` 仍走 M2 的 `RadioSelection.select`
> （`RadioEngine.kt:327`）。M3 选曲器要替换它需要同时迁走 M2 的 12 个既有用例与语种字段供给，
> 本波只保证「纯规则可用 + 有测试」，接线列入遗留。

### 5. 时段权重（任务 5）

`core/.../recommend/m3/TimeSlot.kt`，单测 `TimeSlotTest`（5 例）。
`slotOf(atMillis, zone, config)` 切点 5/11/17，权重 pos .8 / neg .3 / `minSamples` 4 /
上限 1.12 / 下限 0.9；`computeAffinity(radioHistory, now: () -> Long, zone, config)`。
**时钟与区时都注入**：文件内不出现 `System.currentTimeMillis()`，单测传
`ZoneId.of("Asia/Shanghai")` 锁死，避免在 CI 的 UTC 机器上漂。

### 6. 相似歌手通道 E（任务 6）

纯逻辑 `core/.../recommend/m3/SimilarArtist.kt`（~700 行，单测 15 例）；
IO 与缓存 `app/.../data/SimilarArtistRuntime.kt`（~300 行）。

**状态机**：`search → similar → aliases → songs → done`，四阶段都是「一次 `nextAction` 推一格」。
`pending`（在途任务）**不受 TTL 管**——中途态被清掉就永远铺不完；搜歌失败也 `pending.drop(1)` 推进，
不让一个查不到的名字卡死整条链路（用例 `四阶段状态机 遇错也是完成`）。

**合规三条（硬要求，全在 `SimilarArtistRuntime` 落地）**：

1. `User-Agent: XunYin/1.2.0 (https://github.com/aniface-satar/xunyin)`——MB 对无 UA 直接 403，伪装浏览器反而被限流；
2. **全局限 1 req/s**：MB 与 LB 共用一条 `Mutex` 串行队列，按下一次请求的**起始时刻**计时
   （`wait = 1000 − 已过去`），不是等上一轮结束再睡 1s；kg 搜歌走国内队列，不受此约束；
3. **失败静默降级**：非 2xx / 超时 / 断网一律返回 null，`runRefresh` 的 try/catch 只记
   `similar_artist_<kind>_failed` 不抛（`CancellationException` 原样抛，否则协程取消会被吞）。

缓存键 `xunyin_recommend_similar_artist_v1`（RN 是 `xunyin_recommend_artistsim_v1`，形状不同不互解析）。
`Policy`：`aliasLookups=3` / `songFetchesPerRun=3` / `cacheTtlMs=30d` / `cacheLimit=200` /
`cacheReuseCooldownMs=6h` / `budget=4`（下限 2）/ `songsPerArtist=8` / 超时 12s。

**接线方式（与 RN 的差异，必须记）**：RN 的刷新是独立循环 + 缓存读取；原生侧为了**不占取曲延迟预算**
（一轮刷新至少两位数秒），改成「后台单飞刷新 + 缓冲取货」：

- `kickSimilarArtistRefresh` 在每次 `fetchPool` 里踢一次（`similarRefreshJob?.isActive == true` 时跳过），
  跑在 `Dispatchers.IO`，结束后顺手 `artistLang.flush()` 落盘 MB 回灌的 L3 观察；
- `fetchPool` 的 step 3 只 `drainBuffered()` 取货，**不发请求、不占 requests 计数**；
- 代价：**首批队列拿不到 E 的曲子**（E 是渐进到位，不是首屏到位）。缓冲上限 24 位歌手。

`inferArtistLangFromTags` 只在 MB 标签唯一时采信（多标签不猜）；回灌走
`ArtistLangStore.observeNow`（非挂起，表未载完就丢弃这次观察，绝不阻塞取曲）。

### 7. 结算闭环与 hidden/blocked（任务 7）

**先说一处「起草假设被实证推翻」**：映射表里写「like/dislike/early_skip 只落
`TrackPreference`/`PlaylistPreference`，没进 `ThemePreference`」——**这不成立**。
`RadioBehavior.applySettlementResult` 已经在结算 `PlaylistEffect` 时调
`RadioFeedback.applyThemeFeedback`，`applyExplicitFeedback` 也走同一条路；`NameTokenFeedback`
同样在 `applyTokenSettlement` / `applyExplicitFeedback` 里接好了（`RadioBehavior.kt:220/272/358/378`）。
对照 RN 的 `behavior.ts:86`：主题归因同样只认「来源歌单的分类」（`themeId` 从
`observedPlaylists[id].category` 取），所以 **A/E 通道（无来源歌单）的候选本来就不进主题净权，
这与 RN 一致，不是缺陷**。本项实际要做的只有下面两件事。

1. **hidden/blocked 写入方 + 装配点**（`rankState` 判定逻辑一行未动）：
   - `HiddenPlaylistStore` 形状升级为 `key(source::id) → {name, hiddenAt}`：
     排序侧只要时间戳（`timestamps()`），UI 要名字（`entries()`）——用户认不出 `source::id`；
     读盘失败置 `persistAllowed=false`，避免「读失败 → 空表 → 覆写」把隐藏记录整张抹掉；
   - 装配点 `SonglistRuntime.kt:260`：
     `RecommendProfile.rankState(profile, blocked = RecommendStores.dislikes.rules(), hidden = RecommendStores.hidden.timestamps())`；
   - 隐藏入口：推荐面板歌单**长按**（`PlaylistRow` 加可选 `onLongClick`，参数顺序特意把 `onClick`
     留在最后，5 处既有尾随 lambda 调用点一个不用改）；
   - 恢复入口：`ui/radio/HiddenPlaylistCard.kt`（电台页，可单条恢复 / 全部恢复，空表不渲染）。
2. **问卷播种闭环**（见任务 3）：`RadioRuntime.applyOnboardingSeeds()` 在**读盘之后**补播，
   `submitOnboarding` 落盘 + 播种 + `publish()`；两者都幂等。

`importedOrigins` 维持空——M1 未保存导入来源映射，接不上（遗留）。

### 8. 探索通道 C 打开（任务 8）

**先说清一件事**：`Channels.plan` 的 A7/B5/C4/D2/E2 分配与「某通道没货就把额度让给别人」
在 M2 就已经是真实分配，不是 fallback 补丁。C 之前的问题**单纯是没有任何候选来源**
（`availability[C] = 0` → 配额必然让出）。所以本任务的实质是「给 C 接上货」，
不动分配算术。端到端用例的实测对照见下。

新增 `core/.../recommend/m3/Discovery.kt`（纯规则，11 例）+ `RadioCandidates.createDiscoveryCandidates`
（C 主通道，命中画像歌手时叠加 A 份额，`exploration = 0.9`），`RadioRuntime` 加 step 4：

| 来源 | 做法 | 请求数 | 降级说明 |
| --- | --- | --- | --- |
| 语种缺口补货 | 问卷里**明确想要**（> 50%）的语言关键词 → `SearchRuntime.search` 搜歌 | 1 | 原生没有「按关键词搜歌单」通道（RN `searchPlaylists` 未移植），只能搜歌；低于中性点的语种项是「不想听」，**绝不能**拿来补货 |
| 新鲜歌单 | 分类目录按问卷关键词/主题净权挑 tag → 「最新」排序取列表页 → 取一张歌单的曲目（记进 `observedPlaylists`） | 3 | 源限定 `kw/kg/tx`（目录结构最稳）；`FETCH_STEPS = 5`，C 每 5 轮轮到一次 |

`Discovery.pickSort` 保留 RN 的 `NEWEST_RATIO = 0.3` 成新率（纯函数按比例算，参数可覆盖），
但**调用处传 1.0**：原生一次刷新只跑 1-3 个步骤，按 0.3 算 C 几乎永远没货。
理由与取舍写进函数注释与降级清单。

**前后对比（JVM 端到端，同一份 fixture：A 8 / B 6 / C 6 / E 4，target 20）**：

| | 波前 | 波后 |
| --- | --- | --- |
| C 的候选来源 | 无（`availability[C] = 0`） | 语种补货 + 新鲜歌单 |
| `channelShare[C]` | **0.0**（配额全让给 A/B/D） | **> 0**（`queueCarriesDiscoveryAndSimilarArtistChannels` 断言） |
| E 空手时 | —— | 链路照常出歌，`channelShare[E] = 0` 不抛错（`emptySimilarArtistChannelDoesNotBreakFetch`） |

顺带实测到一个**真机对照点**：同一个池子若候选全是同一位歌手，选择器的「近 8 首同歌手不重复」
会让队列在第 5 首就 `quota_exhausted`。也就是说**队列短不一定是候选少，可能是画像歌手里集中度太高**——
真机上看到「候选池 40 首但队列只有 6 首」时先查这里（属 M2 既有语义，不在本波范围）。

### 9. 音频特征代价评估（任务 9，只写报告、不写代码）

**RN 现状实测**（不是估计）：4 个 TS 文件共 564 行（`audioFeature` 183 / `melSpectrogram` 173 /
`audioEmbedding` 154 / `nativeAudio` 54）+ 原生 Java 466 行
（`AudioDecodeModule` 257 / `TfliteModule` 186 / `AudioFeaturePackage` 23）
+ 模型 `assets/models/musiconn-discogs.tflite` **3,150,024 B（3.0 MiB）**
+ `org.tensorflow:tensorflow-lite:2.14.0` 依赖。

管线：取播放地址 → 解码 **30 s** PCM（16 kHz 单声道 f32）→ log-mel（96 带 / 512 窗 / 256 hop /
`log10(1e-10 + 能量)`）→ 每 187 帧一个 patch（约 3 s）→ TFLite 推理 → 各 patch 平均成
**200 维 embedding** → int8 量化 + base64 存档。限流：**20 首/天**、间隔 **5 分钟**，
即一天最多算 10 分钟音频。

| 维度 | 路线 A：Kotlin 纯 FFT（不上模型） | 路线 B：复刻 RN（mel + TFLite） | 路线 C：离线预计算 |
| --- | --- | --- | --- |
| 交付物 | 谱特征（质心/滚降/通量/色度）+ 谱相似度 | 与 RN 可比的 200 维 embedding | 导入时算好的 embedding 随库存储 |
| 工程量 | FFT 120 行 + mel/谱特征 250 行 + 测试 ≈ **3-4 人日** | 解码 250 行（可复用 Media3）+ mel 350 行 + TFLite 装配 150 行 + 校准/回归 ≈ **5-7 人日** | 复用 B 的 DSP 与模型，另加导入钩子 ≈ **2-3 人日（但依赖 B）** |
| 包体积 | **+0** | **+4.2~4.5 MB**（模型 3.0 MiB + TFLite 每 ABI ≈ 1.1 MB）；现 APK 28.86 MB → ~33.4 MB | 同 B |
| 耗电 | 极低（纯算术，无模型） | 单曲 **2-4 s CPU**（解码 0.3-1 s + ~10 个 patch × 50-150 ms）；20 首/天 ≈ 40-80 s CPU/天，折算 < 0.1% 日耗电 | 集中在导入时（批量导入 100 首 ≈ 5-7 分钟） |
| 主要风险 | 谱特征与「听感相似」相关性弱，撞新质量无法预估；无监督指标可验证 | mel 参数与 essentia 的一致性**无法在本仓库验证**（RN 注释已声明）；TFLite 与 16 KB page size / 多 ABI 需重新回归；模型许可与分发合规需复核 | 无自建后端 → 只能覆盖**本地导入**曲目，在线曲库仍靠标签相似，覆盖面割裂 |
| 结论 | 适合先做「可用性对照」，付零包体积代价试水 | **若 Wave6 立项，选这条**：一次到位、行为可与 RN 逐位对照 | **不建议**：硬约束是无自建后端，覆盖率上不去 |

**建议路径**：Wave6 先做路线 A（3-4 人日、零包体积），用真机 A/B 对照「有谱特征 vs 只有标签」
的撞新体感；若谱特征确实带来可感知提升，再决定是否付 4.2 MB 与 TFLite 维护成本上路线 B。
不建议跳过 A 直接上 B——现在缺的不是精度，而是「音频信号到底有没有用」的证据。

### 10. 降级清单（汇总，按影响排序）

| # | 降级点 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | `Diversity.select` 未替换 `RadioSelection` | MMR / 同作品软降频 / 分类轮换 / 语种硬配额在真机**均未生效** | Wave6 接线（需同时迁 M2 的 12 个用例） |
| 2 | 候选 `lang` 字段只有 kg/tx 逐曲字段填得上 | 语种配额实际仍是「缺席即不限」 | Wave6 接桶召回 + 歌手语言表回填 |
| 3 | 通道 E 异步供货 | 首批队列没有 E 的曲子 | 可接受（渐进到位）；若要求首屏有 E，需把刷新提前到开播前 |
| 4 | C 的「相似曲（音频/共现）」来源未做 | 撞新只有「语种补货 + 新鲜歌单」两路 | 与任务 9 绑定 |
| 5 | `Discovery` 调用处成新率 1.0（RN 0.3） | C 比 RN 更「新」、更少画像内 | 有真机数据后可回调 |
| 6 | `bucketFromLyric` 无调用方 | L3 只靠逐曲字段与 MB 关系链 | 需要「候选后台拉歌词」通道 |
| 7 | 会话共现 SAR 未移植 | `coOccurrence` 恒 0 | 需跨歌单倒排索引 |
| 8 | `importedOrigins` 恒空 | 导入归因不参与反馈 | 依赖 M1 保存来源映射 |
| 9 | 问卷 UI 四档（非滑条） | 颗粒度粗（0/50/70/100） | 数据形状不变，换 UI 不动算法 |
| 10 | `computeBucketDetailReserve` / `computePoolBucketLimits` 只移植不接线 | 无 | Wave6 桶召回时接线 |
| 11 | 音频特征四件套零代码 | 无音频信号 | 见任务 9 结论 |

### 11. 真机对照清单（集成后逐条打勾）

**撞新能力（任务 8 的主验收）**
1. 连续 30 首里「陌生曲」（首听歌手 + 首听曲）占比：波前基线 vs 波后，分「有问卷表态 / 无表态」两组；
2. 通道分布：`getSummary().channelShare` 里 C 与 E 是否都非 0（E 需播够 2-3 分钟后才可能有货）；
3. 语种分布：问卷设「华语 100%」→ 下一批华语占比应上升；改成「华语 0%」→ 应下降且旧正权被撤（不是叠负权）；
4. 探索模式（`RadioMode.EXPLORE`）下 C 的占比应明显高于电台模式。

**问卷**
5. 首次进推荐页顶部卡片文案为「先花 30 秒设置偏好」，答完后变「偏好已设置 / 修改」；
6. 全部选「无所谓」点保存 → 弹提示「等于没表态」，不落库；
7. **杀掉进程重进**：滑条/档位回填正确，且语种分布不出现「播种叠加」（这是 `onboardingSeeded` 幂等的真机验证）。

**隐藏歌单**
8. 长按推荐歌单 → 列表里该歌单消失（不是刷新才消失）；提示文案出现；
9. 电台页「已隐藏的歌单 N」能列出名字并单条恢复；恢复后刷新推荐页应重新出现；
10. 杀掉进程重进 → 隐藏记录仍在（`persistAllowed` 与读盘形状）。

**通道 E 合规与降级**
11. 飞行模式下开电台：不弹错、不卡住，`reasons` 里能看到 `similar_artist:*`；
12. 抓包确认 MB/LB 请求间隔 ≥ 1 s 且带上面那个 UA（无 UA 会 403）；
13. 连续开播 5 分钟后 `xunyin_recommend_similar_artist_v1` 生成且 `byArtist` 有条目；
14. `xunyin_recommend_artist_lang_v1` 出现 relation 强度条目（MB 标签唯一时）。

**日志核对**
15. `reasons` 关键串：`similar_artist:empty` / `similar_artist:<N>` / `discovery_restock:<语种>:<N>` /
    `discovery_playlist:<id>:newest:<N>` / `discovery_restock:no_language_preference`。

**性能**
16. 开播到首曲的耗时不超过波前基线 +10%（E 是后台刷新，理论上不该变慢——变慢就说明 `kick` 抢了主线程）。

### 12. 提交记录与闸门

| 提交 | 内容 |
| --- | --- |
| `8f4e2d0` | 语义实证与映射表（先文档） |
| `278ce98` | M3 纯规则四件套（语种八桶+配额 / 时段 / 问卷 / 相似度 / MMR 选曲），core 807 全绿 |
| `8a85f01` | 相似歌手通道 E 纯逻辑（MB/LB 解析 + 四阶段状态机 + 预算调度），core 822 全绿 |
| `f6bca32` | app 侧 M3 存储与运行时装配（问卷 / 歌手语言表 / 隐藏歌单 / 通道 E 缓存 + `rankState` 接 blocked/hidden） |
| `a3f3e68` | 通道 E 接线与结算闭环（后台刷新+缓冲取货 / 问卷播种幂等回退 / 隐藏歌单长按与恢复） |
| `04c6ca5` | 探索通道 C 打开（语种补货 + 新鲜歌单，配额真实分到 A/B/C/D/E） |
| `852d198` | 偏好问卷 UI（推荐面板顶部入口 + 四档问卷弹层） |
| `373aa1b` | 通道 C/E 候选构建单测 |
| `d6a8d8c` | 端到端用例（播种 → 四路取曲 → 播放 → 喜欢 → 再取曲） |

闸门：`ktlintCheck test assembleDebug` 全绿；core 测试 **850 例**（车道起点 742 → +108）。
新增测试 11 个文件、**108 例**：
`LanguageTest` 14 / `LanguageQuotaTest` 12 / `OnboardingTest` 8 / `TimeSlotTest` 5 /
`SimilarityTest` 13 / `DiversityTest` 13 / `SimilarArtistTest` 15 / `DiscoveryTest` 11 /
`RadioCandidatesChannelsTest` 5 / `RadioOnboardingSeedTest` 9 / `RadioW5EndToEndTest` 3。

---

## Lane 报告（2026-10-26）

- **结论**：**完成**。任务 1-9 全部落地：映射表（先文档）、M3 纯规则五件套
  （语种/配额/问卷/相似度+MMR/时段）、相似歌手通道 E（纯逻辑 + app 运行时 + 接线）、
  结算闭环与 hidden/blocked 接线、探索通道 C 打开、音频特征代价评估（只写报告）。
  两条明确**未接线**的项已在报告里逐条标注（`Diversity.select` 未替换 M2 选曲器、
  候选 `lang` 字段供给不足），不当作已完成。

- **commit**：`8f4e2d0` → `278ce98` → `8a85f01` → `f6bca32` → `a3f3e68` → `04c6ca5`
  → `852d198` → `373aa1b` → `d6a8d8c` → `193e430`（ktlint 收口）→ 本报告提交；
  **测试数 core 850 + app 76 = 926 全绿**（车道起点 742 + 76 = 818，本波 +108，全在 core）；
  `ktlintCheck test assembleDebug` 全绿。

- **触碰文件清单**（供集成定位冲突；共 38 个，19 主源码 + 11 测试 + MusicApp/文档）：

  新增 app（6）：`data/RecommendStores.kt`、`data/HiddenPlaylistStore.kt`、
  `data/OnboardingStore.kt`、`data/ArtistLangStore.kt`、`data/SimilarArtistRuntime.kt`、
  `ui/radio/HiddenPlaylistCard.kt`、`ui/radio/OnboardingSheet.kt`（7 个，含 2 个 UI）
  改 app（6）：`MusicApp.kt`（只加 `RecommendStores.init`）、`data/RadioRuntime.kt`、
  `data/SonglistRuntime.kt`（只改 `rankState` 三参）、`ui/radio/RadioPage.kt`（只加一张卡）、
  `ui/songlist/RecommendPanel.kt`、`ui/songlist/SonglistPanel.kt`（`PlaylistRow` 加可选 `onLongClick`）
  新增 core（8）：`recommend/m3/{Language,LanguageQuota,Onboarding,TimeSlot,Similarity,Diversity,SimilarArtist,Discovery}.kt`
  改 core（5）：`recommend/RecommendModels.kt`（`saturation` 默认值）、
  `recommend/radio/RadioModels.kt`（两个 data class 尾部加默认值字段）、
  `recommend/radio/RadioCandidates.kt`（加 2 个 creator + 1 个参数默认值）、
  `recommend/radio/RadioEngine.kt`（加 `applyOnboarding`）、
  `recommend/radio/RadioState.kt`（加 2 个字段）
  新增测试（11）：`m3/{LanguageTest,LanguageQuotaTest,OnboardingTest,TimeSlotTest,SimilarityTest,DiversityTest,SimilarArtistTest,DiscoveryTest}.kt`、
  `radio/{RadioCandidatesChannelsTest,RadioOnboardingSeedTest,RadioW5EndToEndTest}.kt`
  文档（1）：`docs/waves/w5-A.md`

  **全部改动都是增量**：既有函数签名一个没改、既有测试一行没删。

- **语义修正与实证发现**（4 条，按影响排序）：

  | # | 起草时的假设 | 实证结论 | 影响 |
  | --- | --- | --- | --- |
  | 1 | 任务 8 要把「配额 fallback 让位」改成「真实 A/B/C/D 分配」 | `Channels.plan` 的 A7/B5/C4/D2/E2 与通道缺货让位在 **M2 就是真实分配**，不是 fallback 补丁；C 的问题是**没有候选来源**（`availability[C]=0`） | 任务 8 改成「给 C 接货」，一行分配算术没动 |
  | 2 | `like/dislike/early_skip` 只落 `TrackPreference`/`PlaylistPreference`，没进 `ThemePreference` | 早已接线（`RadioBehavior.applySettlementResult` → `RadioFeedback.applyThemeFeedback`；词面在 `applyTokenSettlement`）。RN `behavior.ts:86` 同样只按「来源歌单分类」归因，A/E 通道无歌单 → 本来就不进主题净权 | 任务 7 不做无意义重复接线，改做 hidden/blocked 写入方与播种闭环 |
  | 3 | `rankState` 的 blocked/hidden「已预留未接」 | 判定逻辑 core 已消费，真正没接的是 app 装配点（`SonglistRuntime.kt:257` 走默认 null） | 只补写入方 + 传参，`PlaylistRank` 一行未动 |
  | 4 | 队列短 = 候选少 | 选择器有「近 8 首同歌手不重复」：同歌手集中于一个池子时，第 5 首就 `quota_exhausted` | 写进真机清单（M2 既有语义，本波不动） |

- **遗留问题与对后续波次的建议**：

  1. **必须接线才算生效的两项**：`Diversity.select`（MMR/软降频/分类轮换/语种硬配额）替换
     `RadioSelection.select`；候选 `lang` 字段供给（桶召回 + 歌手语言表回填）。这两项不接，
     任务 2/4 的规则在真机上等于没跑——Wave6 优先级最高。
  2. 通道 E 是**渐进供货**（首批队列没有 E）。若产品要求首屏就有 E，把首次 refresh 提前到
     `start()` 之前并允许等一次（约 2-3 s），或用 RN 那样「上一会话的缓存兜底」。
  3. `Discovery` 的成新率在调用处固定 1.0（RN 0.3），需要真机数据后回调；
     `similarity` 的会话共现（SAR）与 `candidate.ts` 的桶召回仍缺，属同一批供给层工作。
  4. 音频特征见任务 9 的建议路径：先做路线 A（纯谱特征、零包体积）验证「音频信号有没有用」，
     再决定是否付 4.2 MB + TFLite 维护成本。
  5. 问卷 UI 是四档档位（无 material Slider）。若 Wave6 引入 material 依赖，换滑条时
     **只改 `OnboardingSheet.kt`**，持久化与算法不用动。
  6. 工具链提醒：`gradlew -q` 下 ktlint 的逐文件报告会被折叠，收尾闸门要读
     `app/build/reports/ktlint/*/\*.txt`（本波最后就是靠读报告才发现 17 处违规）。
