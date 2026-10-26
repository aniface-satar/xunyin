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

## Lane 报告（待填）
