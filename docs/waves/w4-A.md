# Wave 4 · Lane A 任务书 —— S13 推荐 M2：bandit 全家桶 + 个性电台 + 不感兴趣闭环

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已复核修订**（2026-10-26 协调会话；基线 = Wave3 并入后 core 558 + app 76 = 634，
> APK 28,142,274 B）。复核结论：`@play_history` 仍无写入方
> （`core/storage/StorageKeys.kt` 只有常量，`RecommendProfileRuntime` KDoc 也标注「原生尚无写入方」），
> 任务 1 按原样从零实现；`HomeNavigator.kt` 实际路径是 `nativeapp/HomeNavigator.kt`（不在 `ui/` 下）。

## 背景与立项依据

进度文档「Wave3 推荐立项输入：引擎解耦评估」定义 M2 = **电台/探索 = `bandit +
candidate/candidatePool/queue/requestPolicy/sessionHealth/listening` 全家桶**。
M1（画像重排）已由 Wave3 Lane B 落地并有真机清单；Wave3 集成记录点名两条 M2 前置欠账：

- `@play_history` **无写入方**——listening/画像的历史输入现在是空的；
- B2 语义修正表：`playedList` 仅个性电台经 `musicToggled` 写入临时曲（RN `radio.ts:151`），
  该写入点当时明确「留给电台接入时补」。

RN 对照（worktree 内只读，先全部通读实证再动手；路径以实际为准）：
`src/core/recommend/` 的 radio.ts、bandit.ts、candidate.ts、candidatePool.ts、
queue.ts、requestPolicy.ts、sessionHealth.ts、listening.ts、tempQueueOrder.ts、
feedback.ts（除 M1 已移植的 themeNetWeight 外其余）、dislike 相关、
`src/core/dislikeList.ts`、`src/screens/Home/Views/Recommend/`（电台/探索入口 UI）、
onboarding.ts（问卷，**可选项**）。

## 任务

1. **播放历史写入方**：在播控侧补 RN `addPlayHistory` 等价（只写持久化
   `@play_history`，与内存 playedList 无关——B2 表已锁死这条语义），
   写入时机对照 RN 实证；单测锁形状与去重。
2. **`:core` M2 引擎**：bandit/candidate/candidatePool/queue/requestPolicy/
   sessionHealth/listening 纯规则移植（新子包 `recommend/radio/`），
   输入输出普通 Map/List，全 JVM 单测 + 能拿真实数据处落盘黄金 fixture；
   RNG 相关注意可注入（对照莫奈取色的教训：不可注入的 Math.random 会让用例抖动）。
3. **电台编排与接线**：`PlayerCore` 电台态写入点（playedList/tempQueueOrder）
   按 RN 语义补上；app 侧电台 runtime 组合 M1 画像 + M2 引擎 + 取链既有链路；
   **音量均衡开启时 `isEnableAudioOffload` 必须置 false 的既有约束不得被接线碰丢**。
4. **电台 UI**：发现页电台卡片/进入电台/队列反馈（喜欢/不感兴趣→dislikeList
   持久化与过滤闭环）。路由不够用许加 `HomeNavigator.Route`（本波 HomePage/HomeNavigator
   归本 lane）。**「更多」分页与 onboarding 问卷为可选项**：主线收不完就写遗留，不硬赶。
5. **OEM 保活**：输入 = `docs/waves/w3-A.md` 的「### 任务 5：OEM 保活调研（仅调研，未实现）」
   全节（现状盘点 / 系统层约束 / 厂商白名单表 / 三条建议 / 遗留 1）。复核结论：
   `PlaybackService` 已是 `MediaSessionService` 且类型与权限齐备，**本波 Manifest 无需改动**；
   `DesktopLyricService` 的 FGS 化与「后台播放帮助」页按 w3-A 建议 2/3 单独立项，
   **本波不实现**。Lane A 只需在 lane 报告「遗留问题」节登记该决议（不实现 + 理由）；
   只有电台主线确有硬需求时，才在本车道范围内做最小实现并单独记报告。
6. **M3 禁触**：audioEmbedding/melSpectrogram/nativeAudio/diversity/similarity
   一个字不写；发现 M2 有依赖 M3 的分支，降级处理并记报告。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`（M1 包可扩，
  既有 M1 纯规则文件的函数签名不许改——Wave 后可能另有人接画像）
- `android-native/core/src/main/kotlin/cn/toside/music/core/player/`（电台写入点，
  逐处记报告）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/player/`、
  `data/`（电台 runtime 接线）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/HomePage.kt`、
  `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/HomeNavigator.kt`
  （注意：在 `nativeapp/` 根下，不在 `ui/`）+ 新目录 `ui/radio/`
- `android-native/app/src/main/AndroidManifest.xml`（仅 OEM/FGS 相关行；禁动方向属性）
- 新增测试放对应包

## 禁触

- `ui/share/`（不存在则本波不存在，归 Lane B 新建）、`util/` 的分享保存类（Lane B）
- `ui/list/`、`core/.../list/`、`core/.../backup/`、`CoverImageLoader`（Lane C 范围）
- `ui/settings/`、`core/.../setting/`（本波无人认领，缺口记报告）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- M2 引擎每文件有 JVM 单测；RNG 注入化说明写报告；
- 电台「取曲→播放→喜欢/不感兴趣→再取曲」有 JVM 集成用例（FakePlatform/FakeEngine）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；真机清单（电台全流程、
  后台存活、dislike 过滤生效）写报告。

---

## Lane 报告（2026-10-26）

- **结论**：**主线完成**。任务 1（播放历史写入方）、任务 2（`:core` M2 引擎）、
  任务 3（电台编排与接线）、任务 4 的**电台主线部分**（发现页入口卡 + 电台页 +
  喜欢/不感兴趣闭环）已收口；任务 6（M3 禁触）零触碰。任务 4 的两个**可选项未做**：
  onboarding 问卷、「更多」分页 —— 按任务书「赶不上就写遗留，不许砍质量赶进度」处理。
  任务 5（OEM 保活）按复核结论**不实现**，只登记决议，见遗留问题 1。
- **commit**：`3ed26f7`（播放历史写入方，会话前段）/ `a1b6ec2`（电台引擎核心移植）/
  `9d7e23d`（接线与 UI）/ `265faed`（单测与正则修复）。
  闸门：`ktlintCheck test assembleDebug` **BUILD SUCCESSFUL**，
  **测试数 core 661 + app 76 = 737 全绿**（基线 634 → 本车道净增 core 103，无删除），
  APK 28,425,078 B（基线 28,142,274 B）。
- **触碰文件清单**（逐文件，供集成会话定位冲突）：
  - `core/.../recommend/radio/` 全 21 个文件（新增子包）：`RadioEngine.kt`、
    `RadioBehavior.kt`、`RadioFeedback.kt`、`RadioPool.kt`、`RadioCandidates.kt`、
    `RadioSelection.kt`、`Channels.kt`、`Bandit.kt`、`RadioQueue.kt`、`RadioFilter.kt`、
    `RadioListening.kt`、`RadioDeferral.kt`、`TempQueueOrder.kt`、`SessionHealthLogic.kt`、
    `RadioState.kt`、`RadioStateCodec.kt`、`RadioModels.kt`、`RadioConfig.kt`、
    `RadioTrackKeys.kt`、`RadioRequestPolicy.kt`
  - `core/.../recommend/RecommendSignals.kt`（M1 文件，**只在 `DislikeRulesParser` 内新增**
    `normalize/appendRule` 两个函数，既有签名未改）
  - `core/.../player/PlayerCore.kt`（新增 `onMusicToggled` 回调 + `setPlayMusicInfo` 尾部发事件）
  - `core/.../player/PlayHistory.kt`（前段会话已提交，播放历史解析）
  - `app/.../data/RadioRuntime.kt`、`RadioStateStore.kt`、`DislikeStore.kt`、
    `PlayHistoryStore.kt`（前段会话）
  - `app/.../player/PlayerRuntime.kt`（`radio` 实例 + `onMusicToggled`/`dislikeInfoProvider` 接线）
  - `app/.../HomeNavigator.kt`（新增 `Route.Radio`）、`app/.../ui/HomePage.kt`（路由分发）
  - `app/.../ui/radio/RadioPage.kt`（新目录）、`app/.../ui/songlist/RecommendPanel.kt`（电台入口卡）
  - 测试：`core/.../recommend/radio/{RadioFixtures,BanditTest,ChannelsTest,RadioQueueTest,
    RadioSelectionTest,RadioPoolTest,RadioFilterTest,RadioListeningTest,SessionHealthTest,
    TempQueueOrderTest,RadioEngineTest}.kt`、`core/.../recommend/DislikeRulesWriteTest.kt`、
    `core/.../player/PlayHistoryTest.kt`
- **语义修正与实证发现**（参照 B2 表格式）：

  | 主题 | RN 实证 | Kotlin 落地 |
  |:--|:--|:--|
  | `playedList` 唯一写入方 | `radio.ts:141-153`：`musicToggled` 里仅当「`isTempPlay` 且属于电台队列」才 `addPlayedList`；普通切歌不写 | `PlayerCore` 只发 `onMusicToggled` 事件（`setPlayMusicInfo` 尾部，清空音轨不发）；`RadioRuntime.onMusicToggled` 判定后写 `playedList`，B2 表「B6 电台接入时补写点」正式落地 |
  | 电台让位停播 | `radio.ts:146-149`：切到「非临时曲且有 listId」的列表即 `stopRadio()` | 同一判据在 `RadioRuntime.onMusicToggled` 内，停播会撤队并清掉电台写入的播放历史 |
  | 停播清历史 | `radio.ts:88-96` `clearRadioPlayHistory` 只删 `isTempPlay` 且属于电台队列的项 | `RadioRuntime.clearRadioPlayHistory` 同判据，从尾向前删避免索引漂移 |
  | 开播起播 | `radio.ts:187-192` 分 `playNext()` / `playTempPlayList(0)` 两支 | 原生 `playNext()` 在 `tempPlayList` 非空时优先消费队首，两支等价 → 统一走 `playNext()`，仅在临时队列非空时调用 |
  | JS 正则不能直接搬 | `trackKey.ts:52` 的 `/[([][^)\]]*[)\]]/g` | **移植版原样照抄会抛 `PatternSyntaxException`**（Java 字符类里裸 `[` 非法），对象初始化失败导致整个 `radio` 包 `NoClassDefFoundError`；已改为 `[\\[(][^)\\]]*[)\\]]`。教训：只编译不跑测试的移植等于没移植 |
  | 踩雷规则写侧 | `dislikeManage.updateDislikeInfo` 逐行归一化、去重、`@`→`#` 转义后整体重写 `rules` | `DislikeRulesParser.normalize/appendRule` 同语义（以首个 `@` 切分；其后 `@` 转义为 `#`，RN `split` 只取前两段会丢弃多段，这里保留并转义） |
  | RNG 注入化 | RN 用 `Math.random()`（bandit 抽样、softmax 抽样、曲目间隔） | 全部经 `rng: () -> Double` 参数注入：core 侧单测用 `RadioFixtures.seededRandom(seed)` 的 LCG 锁种子；app 侧 `RadioRuntime` 持 `Random(seed)` 实例并注入，`sameSeedProducesSameMultiplier` / `seededPlanIsReproducible` / `sameSeedPicksSameTracks` 三条用例守住可复现性 |
  | 存储键位 | RN 整个 `RecommendationState` 存 `xunyin_recommend_state_v2` | 形状不同（M2 子集 + `JsonObject` 曲目表），另起 `xunyin_recommend_radio_state_v1`，不与 RN/M1 互解析；1500ms 防抖落盘 |

- **遗留问题与对后续波次的建议**：
  1. **OEM 保活（任务 5）决议：本波不实现**。`PlaybackService` 已是 `MediaSessionService`
     且类型/权限齐备，电台主线没有硬需求，**Manifest 未改动**（方向属性自然未动）；
     `DesktopLyricService` 的 FGS 化与「后台播放帮助」页按 `w3-A.md` 建议 2/3 单独立项。
  2. **M3 退化清单**（M2 分支一律降级，未写任何 M3 代码）：`RadioPool` 的画像亲和度用
     「种子重合归一 + 弱主题加成」替代 `similarity.ts`；`RadioSelection` 不做同作品软降频/
     分类轮换/语种硬配额；`RadioModels` 无 `langHint`。**探索通道 C 没有候选来源**
     （依赖 M3 的相似度/语种），配额按 `Channels` 的 fallback 规则自动让给 A/B/D —— 电台能跑，
     但「撞新」能力弱于 RN。
  3. **候选抓取为三路降级版**：画像歌手直采（A，五源搜索）+ 榜单轮换（D/A，`LeaderboardRuntime`）
     + 推荐歌单（B，`RecommendRuntime` + `SonglistRuntime`）。相似歌手（E）与种子搜索属 M3/后续。
     抓取预算按 `budget/4` 折算步数（1~3 步），未接 `RadioRequestPolicy` 的超时/退避包装。
  4. **`importedOrigins` 恒返回空**：M1 未保存「本地收藏来自哪个网络歌单」的映射，
     导入归因（`creditImportedOrigins`）当前不生效，需数据层补映射后再接。
  5. **观察歌单 id 形状**：app 侧用 `${source}__${id}`（跨源防撞），RN 用纯 `id`。
     若集成会话要统一（例如与 M1 画像的歌单 id 对齐），改 `RadioRuntime.fetchPlaylist` 一处即可。
  6. **M1 踩雷解析的别名差异**：`DislikeRulesParser.parse` 未做 `@`→`#` 归一，而
     `PlayerCore.DislikeInfo.key` 的 `norm` 做了；歌名/歌手中含 `@` 时两处判重会不一致
     （RN 两侧都归一）。属 M1 文件行为差异，本波未改（只新增写侧函数），建议后续统一。
  7. **`RadioRequestPolicy` / `RadioCandidates.createSimilarArtistCandidates` 暂无调用方**：
     前者服务抓取重试（app 侧尚未包装），后者服务相似歌手通道（M3）。保留为 M3 接入点，
     已有单测覆盖的纯函数不会腐烂。
  8. 未做可选项：onboarding 问卷（`onboarding.ts`）、推荐区「更多」分页。
     电台页目前只展示 6 首队列预览，队列全量查看建议随「更多」分页一起做。

- **真机验收清单**（JVM 闸门一律测不到，需用户在真机执行）：
  1. 发现 → 推荐 → 「个性电台」卡片 → 电台页，点「开始电台」10 秒内起播；
  2. 连播 5 首后「接下来」列表非空，且补位曲出现在用户手动「稍后播放」的歌**之后**；
  3. 点「不感兴趣」→ 当前曲立刻跳下一首，且重新进入电台后该曲不再出现；
  4. 重启进程后「不感兴趣」仍生效（`@dislike_list` 与 RN 同键同格式，
     可用 RN 版/旧版验证互读）；
  5. 点「喜欢」后下一批候选里同歌手/同歌单占比上升（画像补池生效）；
  6. 连续 2 首 20 秒内切歌 → 状态卡出现「安全模式」提示，队列里同歌手曲被撤下；
  7. 电台播放中手动进某个歌单点歌 → 电台自动停播、临时队列里的电台补位曲被清掉；
  8. 后台播放（锁屏/切后台 10 分钟）电台继续自动补位，通知栏切歌后仍能续播；
  9. 音量均衡开启时音量正常（`isEnableAudioOffload` 互斥约束未被接线碰丢）。
