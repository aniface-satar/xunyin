# Wave 7 · Lane A 任务书 —— 推荐与电台收口：共现索引/相似曲来源 + 桶预算接线 + 诊断上 UI + 画像过滤 local

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（Wave6 遗留清单 W6-9/10/11、Wave5 遗留 W5-4/W5-13）与本文全文。
> 分支 `w7/laneA`，车道起点 = `main` 的 `baa4208`（core 1042 + app 122 = 1164 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | `computeCoOccurrence` 等共现小件已移植但**没有输入**：全仓无跨歌单倒排索引，RN 的来源是 `library.ts`/`libraryIndex.ts` | `core/.../recommend/m3/Similarity.kt:18-22` 注释明说「照搬会得到一组恒 0 的函数」；`m3/Discovery.kt:13-14` 明说相似曲来源不做 |
| 2 | 发现通道成新率被调用侧写死 `1.0` | `app/.../data/RadioRuntime.kt` `fetchDiscoveryPlaylist` 内 `ratio = 1.0`（带降级理由注释）；core 常量 `m3/Discovery.kt:20 NEWEST_RATIO = 0.3` |
| 3 | `computeBucketDetailReserve` / `computePoolBucketLimits` 只移植不接线 | `core/.../recommend/m3/`（W6-9）；原生没有「桶召回 + 详情预算分配」层 |
| 4 | `poolStats` 已存在但没上 UI | `core/.../recommend/radio/RadioPool.kt:390 fun poolStats(...): PoolStats`；`ui/radio` 无消费方（W6-10） |
| 5 | `prefillSimilarArtistBuffer` 无冷却 | `app/.../data/RadioRuntime.kt:216`（开播触发）、`:271`（实现）（W6-11） |
| 6 | 画像装配**不按 source 过滤**，本地曲会进画像 | `core/.../recommend/RecommendProfile*.kt`、`PlaylistRank.kt` 全文无 `"local"`（W5-13） |
| 7 | `importedOrigins` 恒空（爱心列表无 `source`/`sourceListId` 元数据） | `w4-A.md` 报告遗留 4，Wave5/6 未动 |
| 8 | gradle 里没有音频/DSP 依赖，音频特征全仓零代码 | Wave6 起草已核；`audioFeature.ts` 在 RN 侧 |

## 1. 背景

Wave6 把 M3 的规则接进了选曲主链路，但电台的「相似」还剩三个洞：共现有算法没数据、
桶预算有算式没调用方、诊断有输出没界面。本波把这三个洞补上，顺带处理「本地曲污染画像」
的产品口径，并给音频特征路线 A 一个时间盒验证机会（可砍）。

## 2. 任务

1. **跨歌单共现索引**（W5-4 前半）：对照 RN `src/core/recommend/library.ts` 与
   `libraryIndex.ts`，移植「本地歌单库 → 歌手/标题倒排索引 → 会话共现计数」的纯规则层
   （新文件建议 `core/recommend/m3/LibraryIndex.kt`），数据源用既有 `ListRuntime`/画像装配
   的歌单集合。产出：`computeCoOccurrence` 有真实输入，`Similarity` 的共现分不再恒 0。
   全 JVM 单测（构造多歌单 fixture，锁倒排与共现数值）。
2. **相似曲来源接入发现通道**：`Discovery` 的「相似曲」来源接上（共现 + 标签相似，**不含
   音频**），候选进池时带主通道归属。**成新率回调**：`ratio = 1.0` 是 Wave5 的降级
   （注释写明「原生一次只跑 1-3 步，0.3 会让 C 没货」）——先实证当前抓取预算下的 C 通道
   供给量，再决定回调到 0.3、按预算折算、或维持 1.0 但把理由更新成实证结论；改与不改都要
   在报告里给数据。**RN 0.3 的适用前提（一次刷新十几次请求）先读 RN 源码确认。**
3. **桶召回 + 详情预算分配接线**（W6-9）：`computePoolBucketLimits`（池子按语种桶的容量上限）
   与 `computeBucketDetailReserve`（详情页/逐曲元数据的预算预留）接到池子 merge 与补货路径；
   接线位置与 RN `candidatePool.ts` 的消费点一一对应，逐处记报告。
4. **诊断上 UI**（W6-10）：`PoolStats` 与 `RadioStatus.reasons` 在电台页给一个**开发者入口**
   （建议：电台页长按标题或「更多」里的隐藏开关，落 `ui/radio/`，不许进 `ui/settings/`），
   展示池子构成/通道占比/最近 reasons 滚动。形态从简，能看数据就行。
5. **prefill 冷却**（W6-11）：`prefillSimilarArtistBuffer` 加冷却（建议 ≥ 60 s 或按会话内次数上限，
   取 RN `similarArtistStore` 的节奏语义实证），防频繁停播→开播时每轮 kg 搜歌堆叠。
6. **画像过滤 local 曲目**（W5-13，产品口径默认「过滤」，若协调会话拍板相反则改任务）：
   画像装配（收藏/自建歌单/`@play_history` 三路输入）按 `source == "local"` 剔除；
   `themeWeights` 不吃本地曲词面。**`importedOrigins` 映射只评估**：要补
   「收藏在线歌单进爱心」的来源元数据需动 `core/list` schema（本波 `core/list` 禁触），
   给出最小改动清单写报告，留给 Wave8。
7. **音频特征路线 A（W5-5，时间盒可选任务）**：主线收完且还有余力才做。先写**评测口径**
   （同曲不同版本/翻唱/完全不同曲三组样本的区分度标准，怎么算「有用」），再做纯 Kotlin
   FFT 纯谱特征（零包体积、零新依赖，`core/recommend/m3/` 内，JVM 可测），与标签相似做
   一组对照。**评测口径没定就不许写特征代码**；时间盒到了就写遗留，不许拖慢主线 1-6。

## 3. 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/recommend/`（`m3/`、`radio/`、
  画像装配文件；既有 M1/M2/M3 函数签名不改，只许增量）
- `android-native/app/.../ui/radio/`
- `android-native/app/.../data/` 的 `RadioRuntime.kt`、`RadioStateStore.kt`、
  `RecommendProfileRuntime.kt`、`SimilarArtistRuntime.kt`、`DislikeStore.kt`
- 新增测试放对应包

## 4. 禁触

- `core/local/`、`data/LocalMusicRuntime.kt`、`userapi/**`、`core/data/**`（Lane B 范围）
- `lyric/**`、`ui/settings/**`、`core/setting/**`、`deeplink/**`、`MainActivity.kt`、
  `HomeNavigator.kt`、`ui/HomePage.kt`、`ui/play/**`、`ui/search/**`（Lane C 范围）
- `ui/list/**`、`AndroidManifest.xml`、**gradle 与版本目录（本波 A/B 全禁，缺依赖就降级）**、
  `.github/`、`userapi/`

## 5. 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 共现索引/桶预算/画像过滤每个纯规则文件有 JVM 单测；`poolStats` 上 UI 的入口写进报告；
- 报告含：成新率的实证数据与决定（改/不改 + 理由）、桶预算接线点清单、prefill 冷却参数、
  （若做）音频特征评测口径与对照结果、（若没做）音频特征与 importedOrigins 的遗留；
- 真机清单：① 相似曲来源生效——`channelShare.C` 里出现共现/标签相似候选、
  `reasons` 出现相似曲关键串；② 桶预算生效——`lang_unmet` 与池子构成变化；
  ③ 开播抖动——频繁停播/开播下 MB/kg 请求频次（对照 W6-11）；④ 本地曲导入后
  `themeWeights`/画像不变化；⑤ 电台页开发者入口可看 poolStats；⑥ 起播耗时无回退。
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告（待填）
