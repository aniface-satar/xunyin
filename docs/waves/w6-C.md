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
