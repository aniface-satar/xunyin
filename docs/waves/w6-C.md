# Wave 6 · Lane C 任务书 —— 本地曲库二轮：重定位 / 在线兜底 / 内嵌歌词 / 分享不落相册

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（Wave5 遗留 W5-7 / W5-8 / W5-11）与本文全文。
> 分支 `w6/laneC`，车道起点 = `main` 的 `1a837fd`（core 883 + app 111 = 994 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | 本地取链只有「直连 document URI」一条路，失败不兜底 | `app/.../player/PlayerRuntime.kt:210`（`localFileUri`）/ `:221`（`localMusicUrl`） |
| 2 | 本地歌词只读同目录同名 `.lrc`，读不到就 null | `app/.../data/LocalMusicRuntime.kt` `readLyricJson` |
| 3 | 没有任何「本地曲目重扫 / 重定位」入口；换机或文件移动后这些曲目直接哑 | 全仓 grep 无 relink/rescan |
| 4 | SAF 工具已具备重定位所需的原语：`documentExists` / `listChildren` / `canRead` / `siblingLyricUri` / `readText` | `app/.../util/SafDocuments.kt:182 / 117 / 193 / 168 / 152` |
| 5 | Manifest 里**没有** `FileProvider`，也没有 `res/xml/file_paths.xml` | `app/src/main/AndroidManifest.xml` 实测 |
| 6 | 分享卡的「分享」按钮复用 MediaStore 的 `content://`，所以**分享一次会在相册留一张图** | Wave5 Lane C `ui/share/ShareImageSender.kt` + `ShareCardSaver.Saved(fileName, uri)` |
| 7 | RN 的本地兜底是**六级候选阶梯**：`名称+歌手` → 名称含 `-` 时拆前后对调两次 → 文件名 stem → 文件名含 `-` 再拆对调 → 纯名称 | `src/core/music/local.ts:19` `getOtherSourceByLocal` |
| 8 | RN 兜底成功后**会回写**：`saveMusicUrl(targetMusicInfo, quality, url)`、`saveLyric(...)`、`updateListMusics` 写回 `meta.picUrl` | `src/core/music/local.ts:91-135 / 126-150 / 221-…` |
| 9 | RN 内嵌歌词走 `readLyric`（原生模块直出 USLT 文本），原生没有等价物 | `src/utils/localMediaMetadata.ts` + Wave5 Lane B 报告「内嵌歌词不做」 |
| 10 | `core/local/` 已有 5 个纯规则文件 + 33 用例，新增纯函数放这里最自然 | `core/src/main/kotlin/cn/toside/music/core/local/` |

**起草结论**：Wave5 把本地曲库做到「能导入、能播、有同名 lrc、有封面」。本车道补的是
**可用性**：曲目失效后能救、标签缺失时能借在线数据、内嵌歌词能读出来、分享不再污染相册。

## 1. 任务

### 1.1 本地曲目重定位（W5-7，先做，纯逻辑优先）

- `:core` 新增 `core/local/LocalRelink.kt`：纯函数
  - 输入：一批本地曲目的「期望标识」（`name` / `singer` / 原文件名 stem / 原 document id）、
    一批候选文件的「文件名 stem + document URI」；
  - 输出：`RelinkPlan(matched: Map<oldId, newUri>, unmatched: List<oldId>, ambiguous: List<oldId>)`；
  - 匹配规则（按优先级，**写成常量表 + 用例**）：完全同名 stem → 同名且歌手一致 →
    同名候选中唯一 → 多个候选**不猜**（进 `ambiguous`）。
  - 用例至少 8 条：唯一命中 / 多候选歧义 / 大小写与全半角归一 / `-` 分隔文件名 /
    无扩展名 / 空 stem / 候选为空 / 与既有 `LocalImportPlan` 去重键的交互。
- app 侧 `LocalMusicRuntime` 新增 `relink(listId: String): RelinkOutcome`：
  - 先对列表里每首本地曲目 `SafDocuments.documentExists` 校验；失效的收集起来；
  - 拿持久授权的树根（`contentResolver.persistedUriPermissions` 里重新遍历一次，
    `SafDocuments.listChildren` 单层，与导入同一口径），产出候选集后走 `LocalRelink.plan`；
  - 命中的用 `listMusicUpdateInfo` 换 `id` / `meta.filePath` / `meta.songId`（三处必须一起换，
    Wave5 的语义是三者同键）；**同时写进列表后要 `handleListMusicsUpdated` 让播放器刷新**；
  - 歧义/未命中的**不删**，只在结果里计数（删曲是破坏性操作，本波不做）。
- 入口：`ui/list/ListDetailPage.kt` 现有操作行**不改**（那是 Wave5 车道的地盘语义），
  重定位入口挂在「本地文件」弹层里（`ui/list/LocalFileImportDialog.kt` 加一个
  「重新定位失效曲目（N）」按钮，N = 当前列表里失效数量；0 时按钮不渲染）。
  若判断这个入口不合适，允许改为 `LocalMusicRuntime` 的公开 API + 报告说明「暂无 UI 入口」，
  **但必须让真机验得动**。

### 1.2 在线兜底（W5-8，本车道最重的一块）

- `:core` 新增 `core/local/LocalSourceQuery.kt`（纯函数）：把 RN 的六级候选阶梯
  （见实证 7）实现成「给定本地曲目的 name/singer/文件名 stem，产出**有序的查询候选列表**」，
  每条候选包含 `(keyword, expectName, expectSinger)`。用例至少 6 条，逐级覆盖：
  含 `-` / 不含 `-` / 对调 / 文件名与 name 相同（跳过文件名那级）/ 文件名无扩展名 / 全兜底失败。
- app 侧取链改造（`PlayerRuntime.localMusicUrl`）：
  1. 直连 `content://` 成功 → 原样返回（**现有行为不许变**，这是绝大多数情况）；
  2. 直连失败（文件被删/授权失效）→ 走兜底：按 `LocalSourceQuery` 的候选顺序，
     用既有五源搜索（`data/SearchRuntime`）+ `userApi.getMusicUrl` 取直链；
  3. 拿到直链后**必须**把 `targetMusicInfo`（在线曲目）回写：至少 `saveMusicUrl` 等价物
     （工程里若有 `UserApiRuntime` 的 url 缓存则走它，没有就只在本次播放生效并记报告）；
  4. 全失败 → 保留 Wave5 的可读提示（「本地文件无法访问…」），不静默跳歌。
- 封面兜底（`getPicUrl` 等价物）：本地无内嵌封面 → 用候选阶梯搜到的在线曲目取封面；
  命中后写回 `meta.picUrl`（`listMusicUpdateInfo`）。**注意**：Wave5 是导入时落盘封面，
  本波是「没有封面时才兜底」，两条路不要互相覆盖。
- 歌词兜底（`readLyricJson`）：同名 `.lrc` 缺失 → 内嵌歌词（见 1.3）→ 在线兜底（候选阶梯 +
  `userApi.getLyric`）。三级顺序与 RN 一致（内嵌优先于在线）。
- 网络/搜索失败一律静默降级（本地曲不该因为联网失败播不了）。

### 1.3 内嵌歌词（W5-8 的另一半）

- `:core` 新增 `core/local/EmbeddedLyric.kt`：从音频文件头字节里解析内嵌歌词。
  范围**只做能测的**：
  - ID3v2.2/2.3/2.4 的 `USLT` 帧（含 unsynchronisation、UTF-8/UTF-16 with BOM、Latin-1 编码）；
  - MP4/M4A 的 `©lyr`（`moov/udta/meta/ilst`，注意 `meta` 里的 4 字节 version/flags）；
  - 其余容器（ogg/flac）**本波不做**，返回 null 并记报告。
- 纯函数签名建议：`parse(bytes: ByteArray): String?`（只读文件头，不读整个文件；
  对超过 1 MB 的输入立即返回 null 防内存问题）。
- 用例至少 10 条：ID3v2.3 UTF-16 带 BOM、ID3v2.3 Latin-1、ID3v2.4 UTF-8、多 USLT 取第一个、
  unsynchronisation、无 USLT、帧长跨界截断、MP4 `©lyr` 正常、MP4 无 `©lyr`、非音频字节给 null。
  字节 fixture 用代码内构造（`ByteArray` 拼装），不要引外部二进制文件。
- app 侧接线：`LocalMusicRuntime.readLyricJson` 的读取顺序改为
  **同名 `.lrc` → 内嵌 USLT `©lyr` → 在线兜底**，解析后仍产出与现在相同的
  `{lyric, tlyric?, rlyric?}` JSON 形状（播放器链路一行不用改）。

### 1.4 分享不落相册（W5-11）

- 加 `FileProvider`：`AndroidManifest.xml` 增 `provider` 段 + `res/xml/file_paths.xml`
  （只暴露 `cacheDir/share_cache`），`android:authorities` 用 `${applicationId}.fileprovider`，
  `android:exported="false"`、`android:grantUriPermissions="true"`。
- `ShareImageSender` 改为「先写 `cacheDir/share_cache/<name>.png` → 用 FileProvider 的
  `content://` 分享」，**保存按钮仍走 MediaStore**（保存是用户明确要落相册）。
- 兼容：分享前先 `checkUriPermission`/`grantUriPermission` 到目标包不需要，`ACTION_SEND` 的
  `FLAG_GRANT_READ_URI_PERMISSION` + `ClipData` 足够（Wave5 已这样写，照旧）。
- cache 清理：每次分享前清掉 `share_cache` 里超过 24h 的文件（一次 3 行，别做 GC 框架）。
- 竖屏约束：不改 `screenOrientation`；分享 chooser 旋转不得出现横屏（既有行为保持）。

## 2. 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/local/**`（新增 `LocalRelink.kt`、`LocalSourceQuery.kt`、`EmbeddedLyric.kt`）
- `android-native/core/src/test/.../core/local/**`
- `android-native/app/.../data/LocalMusicRuntime.kt`
- `android-native/app/.../player/PlayerRuntime.kt`（本地取链/歌词/封面兜底，**只动 local 分支**）
- `android-native/app/.../ui/list/LocalFileImportDialog.kt`（加重定位入口）
- `android-native/app/.../ui/share/**`（`ShareImageSender.kt`、必要时 `ShareCardSaver.kt` 只加不改语义）
- `android-native/app/src/main/AndroidManifest.xml`（**只加 FileProvider 段**，不动其它）
- 新增 `android-native/app/src/main/res/xml/file_paths.xml`
- 对应测试

## 3. 禁触

- `core/recommend/**`、`app/.../data/RadioRuntime.kt`（Lane A 范围）
- `core/music/search/**`、`app/.../ui/search/**`、`app/.../data/SearchRuntime.kt`（Lane B 范围）
  —— 兜底要用五源搜索时，**只调 `SearchRuntime` 的公开方法**，不要改它
- `ui/HomePage.kt`、`MainActivity.kt`、`HomeNavigator.kt`、gradle 与版本目录、`.github/`
- `ui/list/ListDetailPage.kt` 的操作行语义（Wave5 定稿）、`ui/list/ListMenuActions.kt`
- `SafDocuments` 既有函数的语义（可新增，不许改既有行为）

## 4. 验收

- `ktlintCheck test assembleDebug` 全绿；
- 报告含：
  1. **RN ↔ Kotlin 兜底阶梯对照表**（六级 + 每级触发条件 + 失败降级）；
  2. 内嵌歌词支持的容器/编码矩阵与不支持项；
  3. 重定位的匹配规则表与歧义处理策略（为什么不猜、为什么不删）；
  4. FileProvider 的权限面（暴露了哪些路径、为什么只有 cache）；
  5. 真机清单。
- 真机清单至少覆盖：
  - 删掉本地文件后播放 → 能在线兜底播同一首（或给明确失败提示），不崩；
  - 把文件挪到另一个已授权目录后点「重新定位」→ 失效曲目恢复可播且列表不重复；
  - 内嵌歌词的 mp3/m4a 各一首 → 播放页有歌词（无同名 lrc 的情况下）；
  - 分享到微信 → 相册**没有**新增图片；点「保存图片」→ 相册有；
  - 全程竖屏 + 授权失效提示仍可读。

## 5. 已知边界（写进报告）

- 兜底依赖在线搜索，**歌词/封面兜底可能命中错版本**（同名不同歌手），RN 有同样问题；
  本波不做人工确认弹层，记遗留。
- 重定位只扫「持久授权的树根」单层（与导入同口径），递归扫描是 W5-16，不在本波。
- 内嵌歌词的 `ogg`/`flac`（Vorbis comment `LYRICS=`/`UNSYNCEDLYRICS=`）本波不做。

## Lane 报告（2026-10-26）

- **结论：完成**。1.1/1.2/1.3/1.4 四块全部落地（前段会话完成 :core 三件套后中断，本会话接手完成全部 app 侧装配与收尾）。
- **commit**：`8ce24d0`（1.1 重定位装配）→ `ea2dd1d`（1.2+1.3 在线兜底与内嵌歌词）→ `a04335b`（1.4 FileProvider 分享）；测试数 **core 918 + app 116 = 1034 全绿**（基线 883+111，本车道新增 core 35：LocalRelink 12 / LocalSourceQuery 9 / EmbeddedLyric 14；app 5：重定位文案）。APK **30,388,004 B**（sha256 `ff4ca006…`，见「语义修正」第 6 条的基线对照说明）。
- **触碰文件清单**：
  - `core/src/main/kotlin/…/core/local/LocalRelink.kt`、`LocalSourceQuery.kt`、`EmbeddedLyric.kt`（前段会话）
  - `core/src/test/…/core/local/LocalRelinkTest.kt`、`LocalSourceQueryTest.kt`、`EmbeddedLyricTest.kt`（前段会话）
  - `app/…/data/LocalMusicRuntime.kt`（relink/countStale/readLyricJson 三级歌词/内嵌歌词接入）
  - `app/…/player/PlayerRuntime.kt`（仅 local 分支：localMusicUrl 兜底、searchOnlineTargets、封面写回、onlineLyricFallback）
  - `app/…/util/SafDocuments.kt`（**新增** readHeader，既有函数未动）
  - `app/…/ui/list/LocalFileImportDialog.kt`（重定位入口 + 文案）
  - `app/…/ui/list/ListDetailPage.kt`（**只动弹层接线**：新增 staleCount/relink 状态与两个 LaunchedEffect，操作行语义未碰）
  - `app/…/ui/share/ShareImageSender.kt`（新增 sendCard/sendCardWithToast + 清缓存；send 原样保留）
  - `app/…/ui/share/ShareCardOverlay.kt`（分享分支改走 sendCard；保存分支照旧 MediaStore）
  - `app/src/main/AndroidManifest.xml`（**只加 provider 段**，其余未动）
  - `app/src/main/res/xml/file_paths.xml`（新增）
  - `app/src/test/…/ui/list/LocalFileImportDialogTextTest.kt`（+5 用例）

### 1. RN ↔ Kotlin 兜底阶梯对照表

| 级 | RN（`getOtherSourceByLocal`） | Kotlin（`LocalSourceQuery.candidates` + `PlayerRuntime.searchOnlineTargets`） | 触发条件 | 失败降级 |
|:--:|:--|:--|:--|:--|
| 0 | 直连本地路径（`getLocalFilePath`） | `SafDocuments.canRead` 通过即返回 document URI | 恒先走 | 文件不存在 → 进阶梯 |
| 0.5 | `getOnlineOtherSourceMusicUrlByLocal`（**url 缓存**） | **无等价物**（工程无 url 缓存），跳过 | —— | 进阶梯 |
| 1 | `getOtherSource`：`name`+`singer` 原样 | `keyword = "name singer".trim()`，五源各搜第 1 页 | 恒有 | 进下一级 |
| 2 | `name` 含 `-` 拆（歌名，歌手） | 同拆法，`expectName=前段, expectSinger=后段` | name 含 `-` | 进下一级 |
| 3 | 前后对调再搜 | `expectName=后段, expectSinger=前段` | 同上 | 进下一级 |
| 4 | 文件名 stem ≠ name 且含 `-` 拆 | 同（stem 经 DocumentsContract 解码取真名） | stem 存在且 ≠ name | 进下一级 |
| 5 | 同上对调 | 同 | 同上 | 进下一级 |
| 6 | stem 不含 `-` 纯名称 | `expectName=stem, expectSinger=""`（matches 放行歌手） | 同上 | 全失败 → 可读提示（不静默跳歌） |

- 每级内部：五源（kw/kg/tx/wy/mg）并发口径改串行逐源（RN `Promise.all`），命中过滤同用 `LocalSourceQuery.matches`（filterStr 归一化 + 全半角/小写补强）；某级有命中即停。
- 匹配成功的在线曲目：`userApi.getMusicUrl(target){quality}` 取直链，成功即返回（本次播放生效，无 url 缓存可写回，见遗留）；网络/搜索失败一律静默降级。

### 2. 内嵌歌词容器/编码矩阵（`EmbeddedLyric`，14 用例）

| 容器 | 帧原子 | 版本/编码 | 支持 |
|:--|:--|:--|:--:|
| MP3 ID3v2.2 | `ULT`（6 字节帧头） | 编码 0 Latin-1 / 1 UTF-16 带 BOM | ✅ |
| MP3 ID3v2.3 | `USLT`（10 字节帧头） | 编码 0/1/3；全局 unsynchronisation（`FF 00`→`FF`） | ✅ |
| MP3 ID3v2.4 | `USLT` | 编码 0/1/2/3；帧级 unsynchronisation + data-length | ✅ |
| MP4/M4A | `©lyr` → `data`（`moov/udta/meta/ilst`，meta 跳 4 字节 version/flags） | UTF-8 | ✅ |
| ogg / flac | Vorbis comment `LYRICS=`/`UNSYNCEDLYRICS=` | —— | ❌ 本波不做，恒 null |

- 边界行为（有用例锁定）：多 USLT 取第一个；帧长跨界截断返回 null；压缩/加密帧跳过；>1 MB 输入立即 null；app 侧只读文件头 1 MB（`SafDocuments.readHeader` 新增）。
- 接线顺序 `readLyricJson`：**同名 `.lrc` → 内嵌 → null**（在线兜底由 PlayerRuntime 接在后面），产出 `{lyric, tlyric?, rlyric?}` 形状不变，播放器链路零改动。

### 3. 重定位匹配规则表与歧义策略（`LocalRelink`，12 用例）

| 级 | 规则 | 命中条件 | 多候选 |
|:--:|:--|:--|:--|
| R1 | 完全同名 stem | 归一化（小写+全角→半角）后 stem 相同 | 进 `ambiguous` |
| R2 | 同名且歌手一致 | 候选 stem 按 `-` 拆（歌名，歌手）两段都对上 | 进 `ambiguous` |
| R3 | 同名候选中唯一 | 归一化 stem == 歌名 | 进 `ambiguous` |
| R4 | 不猜 | 以上皆未唯一命中 | 进 `unmatched` |

- **为什么不猜**：换错文件（听错歌/歌词错位）的代价远大于保持失效让用户手动处理。
- **为什么不删**：删曲是破坏性操作（可能只是暂时拔 U 盘），歧义/未命中只计数保留在列表。
- 候选池 = 持久授权树根单层扫描（`persistedUriPermissions` 去重后逐树 `listChildren`，与导入同口径）；已占用 URI（未失效曲目）与已被认领的 URI 从池中剔除，防重复。
- **装配语义修正**：`listMusicUpdateInfo` 以 `id` 定位且**不更新 id 字段**（ListStore.kt:302），「换 id」走 `listMusicRemove → listMusicAdd(bottom) → listMusicUpdatePosition 按原索引升序逐个回位`，等效原位换 id，列表不重复不重排；`id`/`meta.filePath`/`meta.songId` 三键始终一起换（`relinkedInfo`）。
- 入口：`LocalFileImportDialog` 底部「重新定位失效曲目（N）」，N = `countStale`（逐曲 `documentExists`），0 时不渲染；弹层完成后刷新列表与失效数。

### 4. FileProvider 权限面

- Manifest 仅新增 provider：`androidx.core.content.FileProvider`，authorities `${applicationId}.fileprovider`，`exported=false`，`grantUriPermissions=true`，paths 指向 `@xml/file_paths`。
- `file_paths.xml` **只暴露 `cache-dir/share_cache/` 一层**：分享卡是可再生的临时产物，暴露 cache 子目录即使被滥用也不泄露用户数据；外部存储/MediaStore 路径一律不经 provider。
- 分享链：位图写 `cacheDir/share_cache/<name>_<ts>.png` → `FileProvider.getUriForFile` → `ACTION_SEND`（`FLAG_GRANT_READ_URI_PERMISSION` + `ClipData`，Wave5 的 ROM 兼容写法照旧）。**保存按钮仍走 MediaStore**（用户明确要落相册）。
- 缓存清理：每次分享前删 `share_cache` 内 >24h 文件（3 行，无 GC 框架）。

### 5. 真机清单（至少覆盖任务书 5 项）

1. **删文件后播放**：删除某本地曲目文件 → 播放 → 直连失败自动走六级阶梯在线兜底；命中则正常出声（通知栏/播放页信息不崩）；五源全无则 toast「本地文件无法访问…（在线兜底也未找到可用音源）」，**不静默跳歌**。
2. **挪目录后重定位**：文件挪到另一已授权目录 → 列表详情页打开「添加本地歌曲」弹层 → 按钮「重新定位失效曲目（N）」出现 → 点击 → 恢复的曲目原位可播、列表**不重复**、未恢复的仍保留并显示计数。
3. **内嵌歌词**：无同名 lrc 的 mp3（ID3v2.3 USLT）与 m4a（©lyr）各一首 → 播放页出歌词；有同名 lrc 时 lrc 优先。
4. **分享不落相册**：分享卡「分享卡片」到微信 → 相册**无**新增图片、微信收图正常；「保存图片」→ 相册有（Pictures/寻音）；二次分享旧缓存被清理。
5. **全程竖屏**：分享 chooser 旋转不出现横屏布局；授权失效提示文案完整可读。

### 语义修正与实证发现

1. `listMusicUpdateInfo` 不换 id（ListStore.kt:302 以 id 定位）→ 重定位按 §3 的 remove+add+position 装配，等效三键同换。
2. document URI 的 document id 是百分号编码（`primary%3AMusic%2Fsong.mp3`），文件名 stem 提取必须经 `DocumentsContract.getDocumentId` 解码，直接 `substringAfterLast('/')` 会拿到乱码 stem（影响重定位 R1 与兜底第 4~6 级，已修）。
3. RN 兜底第 0.5 级 `getOnlineOtherSourceMusicUrlByLocal`（缓存 url）无 Kotlin 等价物：工程没有 UserApi 的 url 缓存，跳过该级；兜底成功的直链**仅本次播放生效**（任务书 1.2 第 3 条允许的降级，记遗留）。
4. 搜索条数口径：RN 兜底 `searchMusic` limit=25，Kotlin `SearchCoordinator` limit 固定 30（B5 定稿，未改它）——候选集比 RN 略大，方向安全。
5. 封面兜底触发点与 RN 不同：RN 在展示层调 `getPicUrl`；Kotlin 挂在取链成功路径（直连成功也异步补）与兜底命中后写回，判据 `meta.picUrl` 非空即跳过，与 Wave5「导入时落盘内嵌封面」不互踩。
6. **基线 APK 对照异常（供集成会话复核）**：主仓现存 app-debug.apk（28,925,062 B，sha256 与进度文档记录一致）内嵌 `lx-sources/moxi_cloud.js` 为 187,866 B，而 `1a837fd`/`a4f714b` 的 git blob 是 192,454 B（本 worktree 与主仓 blob 哈希相同 `6ed3ea7f`）——即「基线 APK」与当前源码在源脚本上本就不一致，本车道 APK 增量（+1,462,942 B）主体是 dex 重排（classes24~28 重新分布）+ 源脚本差量，本车道实际代码增量约 615 行 + 1 个 xml。
7. 触碰范围说明：`ListDetailPage.kt` 在禁触清单里是「操作行语义」；本次只在其弹层调用点加了 4 个参数与 2 个 LaunchedEffect（重定位入口必须真机验得动），操作行/菜单语义零改动。`HomePage.kt` 的常驻弹层因默认参数（staleCount=0）不需要改动，重定位入口自然不渲染。

### 遗留问题与对后续波次的建议

- 兜底命中的直链无 url 缓存可写回（每次兜底都重新搜索+取链）；建议后续波次给 `UserApiRuntime` 加 RN `saveMusicUrl` 等价的缓存层后，把第 0.5 级接回来。
- 歌词/封面兜底可能命中同名不同歌手的错版本（RN 同病）；本波无人工确认弹层。
- 重定位只扫树根单层；递归扫描与「歧义候选人工选择弹层」是天然的后续项（`LocalRelink.plan` 已能返回 ambiguous，UI 只需列出候选让用户挑）。
- 内嵌歌词 ogg/flac（Vorbis comment）未做；`EmbeddedLyric` 的 MP4 路径假设 `moov` 在文件头（流式写出的 m4a moov 在尾部，会取不到，有用例注释声明）。
- `countStale` 对大列表逐曲 query（无并发上限问题但慢），如需可换成批量 children 比对。
