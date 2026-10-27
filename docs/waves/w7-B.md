# Wave 7 · Lane B 任务书 —— 本地曲库三轮：兜底缓存写回 + 人工确认/歧义弹层 + 内嵌歌词补全

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（Wave6 遗留清单 W6-1~W6-5、Wave5 遗留 W5-16）与本文全文。
> 分支 `w7/laneB`，车道起点 = `main` 的 `baa4208`（core 1042 + app 122 = 1164 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | **缓存读写 API 已存在、全仓零调用**：`DataRepository.getMusicUrl/saveMusicUrl`（`MUSIC_URL_PREFIX` 键） | `core/.../core/data/DataRepository.kt:68-90`；grep `saveMusicUrl` 只有定义处 |
| 2 | 兜底链路成功后直接返回直链，不落任何缓存，下次兜底重新搜索+取链 | `app/.../data/LocalMusicRuntime.kt` 兜底阶梯（W6-1） |
| 3 | `LocalRelink.plan` 已能返回 `ambiguous: List<String>`（多候选不敢猜），UI 只做了 countStale+一键重定位，**没有候选选择弹层** | `core/.../core/local/LocalRelink.kt:46-51`（注释「`ambiguous` 是有多个候选不敢猜的——两者都不删」）、`app/.../data/LocalMusicRuntime.kt` relink 装配 |
| 4 | 内嵌歌词：MP3 ID3v2.2/2.3/2.4 USLT + MP4 `©lyr`（moov 在头）已做；**ogg/flac 恒 null、流式 m4a（moov 在尾）取不到** | `core/.../core/local/EmbeddedLyric.kt:12-15` 支持表（表格明写「ogg/flac 本波不做」「moov 在文件尾」） |
| 5 | `countStale` 逐曲 `DocumentFile` query | `app/.../data/LocalMusicRuntime.kt`（W6-5） |
| 6 | 本地扫描为**单层**（树根一层），递归扫描是产品决策（W5-16） | Wave5/6 报告两度确认 |
| 7 | deeplink 文件打开只认 `json`/`lxmc`（`SUPPORTED_FILE_EXTENSIONS`），音频文件与 `.js` 不在列 | `app/.../deeplink/DeeplinkFileHost.kt:101`；音频文件打开归 Lane C（deeplink 目录归 C） |

## 1. 背景

Wave6 让本地曲库从「能播」到「断了也能播」（重定位 + 六级兜底 + 内嵌歌词），但集成记录自己
列了五个糙点，全部是「功能在、体验糙」：兜底直链不缓存（每次断链都要重新五源搜索）、
同名不同歌手可能兜错、重定位歧义候选不敢猜也不让人猜、ogg/flac 没歌词、失效检查逐曲 query 慢。
本波把五个糙点全部磨掉，顺带把递归扫描做成可配置（可选项）。

## 2. 任务

1. **兜底/取链缓存写回**（W6-1）：`DataRepository.getMusicUrl/saveMusicUrl` 已存在（键
   `MUSIC_URL_PREFIX + "<musicId>_<type>"`），**纯接线**：
   - 在线曲目取链成功后写缓存（RN `saveMusicUrl` 等价，先读 RN `utils/data` 的调用时机实证：
     什么时机存、按什么 key、音质变化算不算同 key）；
   - 本地兜底六级阶梯的**每次成功命中**（尤其兜底直链）也写缓存，下次同曲优先读缓存直连，
     失效再走阶梯；
   - 缓存读侧要在 `UserApiRuntime` 的取链入口前拦截（**本波 `userapi/**` 归本 lane 独占**，
     改动集中、语义增量，既有签名不改）。
   缓存键若需扩展（如带音质/来源），在 `core/data/DataRepository.kt` **只新增**重载/键，
   不改既有函数语义。
2. **兜底人工确认**（W6-2）：六级阶梯的搜索命中若「同名不同歌手」（或歌手为空），
   不再静默采用——弹候选让用户挑（复用既有 Dialog 组件风格）。先实证 RN `getOtherSourceByLocal`
   的确认语义：RN 是否也静默（W6-2 说 RN 同病）——若 RN 静默，原生的确认弹层是**体验增强**，
   按「增强但可关」实现（纯规则判「是否需要确认」进 `core/local/` 配 JVM 单测）。
3. **重定位二轮**（W6-3）：
   - `ambiguous` 候选人工选择弹层（`LocalRelink.plan` 已返回候选列表，UI 列出让用户挑，
     挑完走既有换键路径）；
   - `countStale` 批量化（W6-5）：逐曲 query 改为按目录 `children` 批量比对（或缓存目录快照），
     1000 首量级耗时可测。
   - **递归扫描 / 多目录（W5-16，可选）**：做成「扫描深度/多目录列表」设置前先问协调会话
     产品口径；没拍板就只交评估（改动点：`LocalImportPlan`/`LocalSourceQuery` + SAF 遍历），
     不硬做。
4. **内嵌歌词补全**（W6-4）：
   - ogg/flac：Vorbis comment `LYRICS=`（flac 是 METADATA_BLOCK VORBIS_COMMENT，ogg 在注释头），
     纯 Kotlin 解析进 `EmbeddedLyric.kt`（扩展支持表 + 单测用真实文件头 fixture）；
   - 流式 m4a（moov 在尾）：既有实现只读前 1 MB——改为「先头后尾」两段探测或按 atom 链走到
     moov（注意大文件只读必要区间）；`MediaMetadataRetriever` 兜底路径一并评估；
   - 产出 JSON 形状不变（Wave6 的歌词三级顺序 `.lrc` → 内嵌 → 在线 不动）。
5. **给 Lane C 的公开入口确认**：C 的 deeplink「音频文件打开」要调本 lane 的公开入口
   （Wave6 已有 `LocalMusicRuntime` 导入/重定位 API）——核对签名是否够用，缺就在报告里
   写死新签名并尽早提交（先签名后实现，Wave6 纪律）。

## 3. 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/local/`
- `android-native/core/src/main/kotlin/cn/toside/music/core/data/DataRepository.kt`（只新增）
- `android-native/app/.../data/LocalMusicRuntime.kt`
- `android-native/app/.../userapi/UserApiRuntime.kt`（本波该文件归本 lane 独占；其余 `userapi/`
  文件禁触）
- `android-native/app/.../ui/list/ListDetailPage.kt`（仅弹层接线；`ListMenuActions.kt` 禁触）
- 新增测试放对应包

## 4. 禁触

- `core/recommend/**`、`ui/radio/**`、`data/{Radio,Recommend,SimilarArtist,Dislike}*.kt`（Lane A 范围）
- `lyric/**`、`ui/settings/**`、`core/setting/**`、`deeplink/**`、`MainActivity.kt`、
  `HomeNavigator.kt`、`ui/HomePage.kt`、`ui/play/**`、`ui/search/**`、`AndroidManifest.xml`、
  **gradle 与版本目录（本波 A/B 全禁）**、`.github/`
- `userapi/` 其余文件（QuickJsEngine/Http/Store 等——缓存只动 `UserApiRuntime` 一处）
- `ui/list/ListMenuActions.kt`（W5-9 统一挪 Wave8，谁都不动）

## 5. 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 缓存写回/确认判定/ambiguous 选择/Vorbis 解析/m4a 双端探测/countStale 批量，每件有 JVM 单测
  （Vorbis/m4a 用真实文件头切片 fixture 落盘）；
- 报告含：RN `saveMusicUrl` 时机实证、确认弹层的「增强 vs 对齐」定性、递归扫描评估、
  公开入口签名、真机清单：① 断网→恢复→二次播放同曲走缓存（logcat 无二次搜索）；
  ② 同名不同歌手兜底出确认弹层、选错可重挑；③ 重定位歧义候选可挑、挑完原位恢复；
  ④ ogg/flac 内嵌歌词显示、流式 m4a 歌词显示；⑤ 1000 首 countStale 耗时对照 Wave6；
  ⑥ 兜底失败提示不回退（Wave5 语义）；⑦ 全程竖屏。
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告（2026-10-27）

- **结论：完成（任务 1–5；W5-16 递归扫描按任务书只交评估，未动代码）。**
  - 任务 1 取链缓存写回：`DataRepository` 新增带时间戳的 `MusicUrlEntry` 读写
    （独立 `_c` 键，不覆盖 RN 口径的纯 url 值）+ `MusicUrlCache` 规则（默认 TTL 6 h）；
    在线取链在 `UserApiRuntime.getMusicUrl` 入口先读缓存、成功后写回；
    本地六级兜底在 `LocalMusicRuntime.fallbackUrl` 按「本地 id + `128k`」先读缓存、
    命中后写回，失效再走阶梯。
  - 任务 2 兜底人工确认：`core/local/LocalFallbackConfirm` 判「同名不同歌手/歌手为空」，
    `ListDetailPage` 出候选弹层（可重挑）；RN 实证为**静默取第一个结果**，所以这是
    「增强但可关」——开关位 `LocalMusicRuntime.fallbackConfirmEnabled` 已留，
    设置项本身见遗留。
  - 任务 3 重定位：`ambiguous` 候选弹层（`pendingAmbiguous` → `ListDetailPage` 逐条挑，
    挑完走既有换键路径）；`countStale` 改为「每个授权树根列一次 children +
    `documentId` 集合比对」，解不出 documentId/一次都没列出时退回逐曲 query。
  - 任务 4 内嵌歌词：MP3 之外补 FLAC/Ogg 的 Vorbis `LYRICS`（退 `UNSYNCEDLYRICS`）与
    流式 m4a 的尾部 `moov` 探测（回读尾部 1 MB 搜 atom 头）；`MediaMetadataRetriever`
    评估结论为**不适合取歌词**（系统 API 无歌词键，仅用于标签/封面，保持原用途）。
  - 任务 5 公开入口：新增 `LocalMusicRuntime.importFiles(context, listId, uris, locationType)`
    （单/多文件导入并返回曲目 info）。Lane C 合入后应把 deeplink 音频打开的占位曲目路径
    换成它（见遗留）。
- **commit：`790dfea`；测试数 core 1079 + app 122 = 1201 全绿**（基线 1164，新增 37 条；
  `assembleDebug` 产出 29,032,439 B，sha256 `22c25220…`）。
- **触碰文件清单**：
  - core main：`core/data/DataRepository.kt`（只新增）、`core/local/EmbeddedLyric.kt`、
    `core/local/LocalFallbackConfirm.kt`（新）、`core/local/LocalRelink.kt`、
    `core/local/LocalStaleScan.kt`（新）
  - core test：`core/data/MusicUrlCacheTest.kt`（新）、`core/local/EmbeddedLyricTest.kt`、
    `core/local/LocalFallbackConfirmTest.kt`（新）、`core/local/LocalRelinkTest.kt`、
    `core/local/LocalStaleScanTest.kt`（新）；`core/src/test/resources/embedded-lyric/`
    7 个真实文件头切片 fixture（flac×3 / ogg×2 / m4a 头尾×2）
  - app：`data/LocalMusicRuntime.kt`、`userapi/UserApiRuntime.kt`、`ui/list/ListDetailPage.kt`
  - **范围外最小改动（记报告）**：`player/PlayerRuntime.kt` —— `getMusicUrl` 新增
    `qualityProvider` 形参后，尾随 lambda 会被解析成 `refresh`，必须改成具名实参；
    本地兜底改调 `LocalMusicRuntime.fallbackUrl`（缓存+确认都在那里）。无行为变更。
  - docs：`docs/waves/w7-B.md`
- **语义修正与实证发现**：
  1. RN `saveMusicUrl` 时机（`online.ts:56-61`、`local.ts:79-94`、`utils.ts:159-263`）：
     读侧只在 `!isRefresh` 时用缓存；写侧成功后覆盖，**音质入键**、换源另存目标曲目键；
     本地兜底固定 `128k`；六级阶梯命中后 RN 自己还留着 `// TODO: save url ?` 未写缓存
     —— 原生这次把这条 TODO 补上了。原生唯一增强是 TTL（RN 无过期，直链 403 后只能靠用户重试）。
  2. 兜底确认在 RN 是**静默**的（`getOtherSourceByLocal` 只按搜索顺序取第一个结果），
     原生弹层属体验增强；默认开启，但本轮没有用户开关（`DefaultSetting` 归 Lane C，禁触）。
  3. `countStale` 批量化的键选 `documentId` 而非 URI：URI 的编码/authority 会随 provider 变，
     documentId 在同一树根单层内稳定，且与 `SafDocuments.listChildren` 返回同一命名空间。
  4. 内嵌歌词尾部探测不按 atom 链走：尾部起点不是 atom 边界，改为在回读窗口里按
     `moov` 类型搜原子头（大文件只多读 1 MB）。
- **遗留问题与对后续波次的建议**：
  - **兜底确认开关未上设置页**：`local.fallbackConfirm` 键名已定、注入点已留，
    Wave8 在 `DefaultSetting` 表尾加键 + 设置页加开关即可（一行默认值 + 一个 Switch）。
  - **递归扫描/多目录（W5-16）**：只评估。改动点：`LocalImportPlan` 增加 `maxDepth`
    与「多树根列表」；`LocalSourceQuery`/SAF 遍历按深度递归（注意同一文件被多个树根
    覆盖时的去重，用 documentId 判重）；设置 UI 需要「扫描深度 / 已授权目录管理」两项。
    产品口径（默认深度、是否跨目录）未拍板前不做，建议 Wave8 与数据迁移一起定。
  - **1000 首 `countStale` 耗时未实测**：纯规则与回退路径有单测，真机耗时对照 Wave6
    放在真机清单第 ⑤ 条。
  - **deeplink 音频打开仍是占位曲目**：Lane C 的 `playLocalFile` 因单文件入口未暴露，
    用 `LocalTrack.buildPlaceholder` 造曲（歌名取文件名、歌手空）。本 lane 已补
    `importFiles`，**合入后由集成会话把 deeplink 分支改调它**（读标签后入库再起播），
    消除这条降级。
  - **真机清单（Wave7 合入后统一清账）**：
    ① 断网→恢复→二次播放同曲走缓存（logcat 无二次搜索；对照 `music url cache hit`）；
    ② 同名不同歌手兜底出确认弹层、选错可重挑；
    ③ 重定位歧义候选可挑、挑完原位恢复；
    ④ ogg/flac 内嵌歌词显示、流式 m4a（moov 在尾）歌词显示；
    ⑤ 1000 首 `countStale` 耗时对照 Wave6；
    ⑥ 兜底失败提示不回退（Wave5 语义）；
    ⑦ 全程竖屏。
