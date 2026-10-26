# Wave 5 · Lane B 任务书 —— S17 本地曲库：SAF 目录扫描 + 元数据 + local 直连播放 + 列表导入

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **起草时点复核**（2026-10-26；基线 = Wave4 并入后 `f214bd8`，core 742 + app 76 = 818）。
> 已复核事实：
>
> - 取链口子是 `PlayerCore.MusicUrlProvider.getUrl(info: JsonObject): String?`，
>   接线实为**两段**：`app/.../player/PlayerRuntime.kt:68-69` 的 `var urlResolver` 默认 lambda
>   **无条件**走 `userApi.getMusicUrl(info) { playQuality() }`，`PlayerCore` 在 `:91` 以
>   `PlayerCore.MusicUrlProvider { info -> urlResolver.getUrl(info) }` 绑定。**没有任何
>   `source == "local"` 分支**。
>   **协调会话复核补充**：因为 `urlResolver` 是 `var`（`RadioRuntime` 等会替换它），
>   local 分支必须写在**默认 provider 内部**（或用 `urlResolver` 包一层再装回默认值），
>   不能只改 `:91` 的绑定，否则绕过的路径会丢本地分支。
> - `core/music/MusicInfoTools.kt` 的 `sanitizeMusicInfo` 已经能兜 `local`：
>   `meta.filePath` 缺失时回填 `songId`/`id`，`meta.ext` 从 filePath 反推 —— 本地曲目**不需要**新模型。
> - `app/.../util/SafDocuments.kt` 现只有 `exportFileName / extensionOf / isSupportedImport /
>   isPlainJson / displayName / readBytes / writeBytes`（w4-C 建），**没有目录树选择与持久授权**。
> - `ui/list/ListDetailPage.kt`（876 行）的列表操作行**没有**「本地文件」项，实测为 **7 项**：
>   重命名 / 清空 / 删除列表 / 排序 / 去重 / 导入 / 导出（起草稿写的第 5 项「删除」
>   实为多选态的批量删除，不在操作行里）。
> - `AndroidManifest.xml` 里**没有** `READ_MEDIA_AUDIO` / `WRITE_EXTERNAL_STORAGE`；SAF 目录树
>   授权不需要这两个权限，**本波不改 Manifest**。

## 背景

B5 遗留自 Wave3 起挂了三波：RN 的「本地文件」整条链路（SAF 目录 → 扫描 → 读标签 → 构造
`source:'local'` + `meta.filePath` → 播放器直读文件）在原生完全缺失。w4-C 只做了评估，结论是
「预计独立 M 级任务，建议 Wave5 单列」——本波就是这一件，**只做本地曲库，不做同步**（无后端）。

RN 对照（worktree 内只读，先全部通读实证再动手）：
`src/utils/localMediaMetadata.ts`（`scanAudioFiles` / `readPic`，底层是
`react-native-local-media-metadata` 原生模块）、`src/screens/Home/Views/Mylist/MyList/listAction.ts`
的 `handleImportMediaFile` / `buildLocalMusicInfoByFilePath` / `createThrottleAddMusics`、
`src/components/MetadataEditModal/`（仅作参照，本波不实现编辑）。

## 任务

1. **语义实证 + 映射表**：把 RN 的扫描过滤、本地曲目 id 与字段形状、导入时序（节流补全 + 失败
   路径移除 + `list.addMusicLocationType` 落位）、空目录/重复导入行为逐条写进 lane 报告。
   系统能力差异（`react-native-local-media-metadata` ↔ `MediaMetadataRetriever`）单独一节。
2. **`:core` 纯规则（先做，能测的先测）**：新增 `core/local/`——
   扩展名/容器判定（mp3/flac/ogg/wav，含 RN 的 `audio/*` mime 前缀与 ogg 兜底）、
   文件名 → name/singer 解析规则、local 曲目 id 生成规则（按 RN 实证，不许自创）、
   去重键、排序；全部 JVM 单测 + 落盘 fixture（文件名样例表）。
3. **SAF 目录选择与持久授权**：扩 `util/SafDocuments.kt`（**只新增 API，不改既有函数语义**）：
   `ACTION_OPEN_DOCUMENT_TREE` + `takePersistableUriPermission` + `DocumentFile` 遍历。
   大目录（1000+ 文件）要有进度与可取消；授权失效要能识别并给可读提示。
4. **元数据读取**：`MediaMetadataRetriever` 读 title/artist/album/duration/bitrate + 内嵌封面
   （`getEmbeddedPicture`），封面原始字节落 `cacheDir/local_cover/`（命名规则与
   `CoverImageLoader` 的磁盘缓存一致，复用其 sha1 目录约定即可，**不改 `CoverImageLoader` 语义**）。
   逐条失败降级到「文件名当歌名、空歌手」，单条失败不许中断整批。
5. **播放链路**：`PlayerRuntime` 的 `MusicUrlProvider` 增加 `source == "local"` 分支，
   直接返回 `content://` / `file://` 字符串（Media3 原生支持 content Uri），**绕开 `userApi`**。
   既有约束不许碰丢：音量均衡开启时 `isEnableAudioOffload` 必须 false；
   播放失败（授权失效/文件被删）给可读提示，不静默跳歌。
6. **列表落库与入口**：`ui/list/ListDetailPage.kt` 列表菜单加「本地文件」一项，
   弹层独立成新文件 `ui/list/LocalFileImportDialog.kt`（目录选择 / 扫描进度 / 结果汇总）。
   语义对齐 RN：**导入到当前这张列表**、按 `list.addMusicLocationType` 决定 top/bottom、
   空目录给提示、失败的路径从列表移除、导入中禁止再次触发。
7. **歌词**：同目录同名 `.lrc` 优先（UTF-8），接进既有歌词链路；内嵌歌词（ID3 USLT）与
   `MetadataEditModal` 等编辑能力**本波不做**，写遗留。
8. **给 Lane C 的公开入口**：实现前先把签名写进 lane 报告并在中途 commit 落地，供 Lane C 的
   首页长按菜单直接调用，建议形态：`LocalMusicRuntime.importTo(listId: String, listTitle: String)`
   （内部自己起目录选择）与 `LocalMusicRuntime.isImporting(listId): Boolean`。
   **这是本波唯一跨车道接口**，签名一旦提交就不许随意改（改要立刻通知集成会话）。

## 范围（只许改这里）

- 新增 `android-native/core/src/main/kotlin/cn/toside/music/core/local/` + 对应测试
- `android-native/app/.../player/PlayerRuntime.kt`（**本波该文件归本 lane 独占**）
- 新增 `android-native/app/.../data/LocalMusicRuntime.kt`
- `android-native/app/.../ui/list/ListDetailPage.kt`（只加「本地文件」菜单项与弹层接线）
  + 新增 `ui/list/LocalFileImportDialog.kt`
- `android-native/app/.../util/SafDocuments.kt`（只新增 API）
- `android-native/app/.../ui/play/CoverImageLoader.kt`（**只许新增本地封面入口，既有语义锁死**）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`、`AndroidManifest.xml`（Lane C 范围）
- `ui/share/`、`core/.../share/`、`ui/settings/`、`core/.../setting/`（Lane C 范围；
  本地曲库的偏好一律用进程级默认 + 记遗留，**不许往 DefaultSetting 加键**）
- `core/.../recommend/`、`ui/radio/`、`ui/songlist/`（Lane A 范围）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- `core/local/` 每个规则文件有 JVM 单测（文件名解析表、扩展名判定、id/去重键、排序）；
- 报告含：语义映射表、系统能力差异（Retriever ↔ RN 模块）、大目录与授权失效的处理、
  Lane C 公开 API 签名、真机清单（首次授权 / 重启后仍可播 / 拔卡或删文件 / 1000 首导入耗时 /
  封面与歌词 / 后台播放与 offload 互斥）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。
- **不做**：云同步、内嵌歌词编辑、多目录合并、`READ_MEDIA_AUDIO` 权限路线（都写遗留）。

---

## Lane 报告（2026-10-26）

- **结论：完成（代码面全落地，真机项待用户执行）。** S17 本地曲库交付：
  `core/local/` 5 个纯规则文件 + 33 用例、SAF 目录树选择与持久授权、`MediaMetadataRetriever`
  标签与内嵌封面、`source == "local"` 的 `content://` 直连取链（绕开 userApi）、同目录同名
  `.lrc` 歌词、列表操作行第 8 项「本地文件」+ 可取消的导入弹层。
  按任务书「不做」的部分未做：云同步、内嵌歌词编辑、多目录合并、`READ_MEDIA_AUDIO` 路线。
- **commit**：`65e277b`（core/local 纯规则）→ `40159e4`（运行时 / 取链 / 歌词）→
  `e3a25a3`（列表入口与弹层）。**测试 core 775 + app 83 = 858 全绿**
  （基线 742 + 76；新增 core 33 + app 7），failures / errors / skipped 全 0；
  APK 28,855,991 B。
- **收尾核对**：末笔闸门 `ktlintCheck test assembleDebug` BUILD SUCCESSFUL，之后工作区只剩本报告
  改动；分支 `w5/laneB` 从 `2097867` 起共 5 笔提交，未 rebase、未 push、未跨车道改文件。
- **触碰文件清单**（供集成会话定位冲突）：
  - 新增 `android-native/core/src/main/kotlin/cn/toside/music/core/local/`：
    `LocalAudio.kt`、`LocalTrack.kt`、`LocalImportPlan.kt`、`LocalLyric.kt`、`LocalSibling.kt`
  - 新增测试 `core/src/test/.../core/local/`：`LocalAudioTest`、`LocalTrackTest`、
    `LocalImportPlanTest`、`LocalLyricTest`、`LocalSiblingTest`（33 用例）
  - 新增 `android-native/app/.../data/LocalMusicRuntime.kt`
  - 新增 `android-native/app/.../ui/list/LocalFileImportDialog.kt`
  - 新增 `app/src/test/.../ui/list/LocalFileImportDialogTextTest.kt`（7 用例）
  - 改 `android-native/app/.../util/SafDocuments.kt`（**纯新增**：持久授权 / 列目录 /
    读文本 / 同名 lrc 探测 / 可读性探测；既有 6 个函数一字未动）
  - 改 `android-native/app/.../player/PlayerRuntime.kt`（取链默认 provider 加 local 分支、
    歌词加 local 分支、本地失败 toast）
  - 改 `android-native/app/.../player/Media3PlayerPlatform.kt`（**⚠️ 超出任务书范围的最小修复**，
    见下「越界说明」）
  - 改 `android-native/app/.../ui/play/CoverImageLoader.kt`（新增 `loadLocal` / `writeLocalCover`，
    `load()` 增加 `file://` 前缀分支）
  - 改 `android-native/app/.../ui/list/ListDetailPage.kt`（操作行加第 8 项、目录选择器注册、
    导入弹层接线、进度驱动刷新）

### 语义映射表（RN → Kotlin）

| RN 实现 | Kotlin 落地 | 结论 |
|:--|:--|:--|
| `localMediaMetadata.ts#scanAudioFiles`：`mime.startsWith('audio/')` 或 `ext === 'ogg'` | `core/local/LocalAudio.isAudio` 同判据同顺序 | 保留（SAF 侧加「mime 什么都没说」时的扩展名白名单，见下） |
| `FileSystem.ls(dirPath)` 单层扫描 | `SafDocuments.listChildren`：`DocumentsContract` 取直接子项，跳过目录 | 保留（同为单层，不递归） |
| `buildLocalMusicInfoByFilePath`：`id = file.path`、`name = 文件名去扩展名`、`singer=''`、`interval=null`、`meta.filePath=songId=id`、`picUrl=''`、`ext` 取自文件名 | `LocalTrack.buildPlaceholder` 逐字段对齐，**`id` 换成 document URI 字符串** | 保留（唯一改动是 id 载体，见语义修正 1） |
| `buildLocalMusicInfo`：`name/singer/albumName/interval/ext` 来自元数据，`interval = formatPlayTime2` | `LocalTrack.buildInfo` + `formatPlayTime2`（`trunc` + 两位补零、分钟不封顶） | 保留（空标题退回文件名，见语义修正 4） |
| `createLocalMusicInfos`：`Promise.all` 五个一批 | `LocalImportPlan.METADATA_CONCURRENCY = 5`，批内 `async` 5 并发 | 保留 |
| `handleUpdateMusics`：`slice(index+1, index+11)` 递归 | `LocalImportPlan.batches`（10 条/批） | 保留 |
| `createThrottleAddMusics`：`BackgroundTimer.setTimeout(…, 1000)` 合并落库 | 每批（10 条）落一次 `listMusicUpdateInfo` | **降级**（无独立定时器，见语义修正 5） |
| 读失败路径 → `removeListMusics(listId, errorPath)` | `ListStore.listMusicRemove(listId, failedIds)` | 保留 |
| `setFetchingListStatus(id, true/false)` 禁重复触发 | `LocalMusicRuntime.importingListId: StateFlow<String?>` | 保留 |
| 空目录 → `list_select_local_file_empty_tip` | 弹层空态文案同句 | 保留 |
| `ChoosePath({dirOnly:true, isPersist:true})` | `ActivityResultContracts.OpenDocumentTree` + `takePersistableUriPermission` | 等价替换（见语义修正 2） |
| `setting['list.addMusicLocationType']` 决定 top/bottom | 同一个键，`listMusicAdd` 的 `addMusicLocationType` | 保留 |
| `getMusicUrl`：先本地路径，**失败再走在线搜同源** | 只做本地 `content://` 直连，不接在线兜底 | **降级**（见遗留 1） |
| `getPicUrl`：`readPic(filePath)` 播放时按需导临时目录 | 导入时把内嵌图写 `cacheDir/local_cover/<sha1>.cover`，`meta.picUrl = file://…` | 等值（时机前移，见语义修正 6） |
| `getLyricInfo`：文件内嵌 → 本地缓存 → 在线兜底 | 只读同目录同名 `.lrc`（含 `[awlrc:base64]` 汇总标签解析） | **降级**（见遗留 1） |
| `listAction.ts#handleImportMediaFile` 五步时序 | `LocalMusicRuntime.runImport` 同五步 | 保留 |

### 系统能力差异（`react-native-local-media-metadata` ↔ `MediaMetadataRetriever`）

- Retriever 能给的：`title` / `artist` / `album` / `duration` / `bitrate` / 内嵌图
  （`getEmbeddedPicture`）。RN 模块另外返回 `type` / `size`，但 `buildLocalMusicInfo`
  一个都没用，故不取。
- **内嵌歌词不做**：RN 的 `readLyric` 直接吐文件里的 USLT 歌词，原生要自己解析 ID3/MP4 box，
  本波按任务书只做同名 `.lrc`。
- **路径模型不同**：RN 有真实路径（可 `stat`、可拼 `.lrc` 路径）；SAF 只有 document URI 与
  document id，`.lrc` 靠 `DocumentsContract.buildDocumentUriUsingTree` + 改名推导，
  非 `DocumentsProvider` 的目录树（部分第三方网盘）推不出来 —— 表现为「没歌词」，不报错。
- 任务书写 `DocumentFile`，但工程没有 `androidx.documentfile` 依赖且 gradle/版本目录禁触，
  改用 `DocumentsContract` 原生 API（能力等价，零新依赖）。

### 语义修正与实证发现

| 编号 | 主题 | 实证 / 修正 |
|:--:|:--|:--|
| 1 | `id` 载体 | RN `id = file.path`；SAF 无路径 → `id = meta.filePath = meta.songId = document URI 字符串`。去重（`listMusicAdd` 按 id）、覆盖（`listMusicUpdateInfo` 按 id）、失败移除（按 id）全部沿用同一键，语义与「路径」一致。**换设备/重装后旧 id 失效**（同 RN 换机后旧路径失效）。 |
| 2 | 持久授权 | `takePersistableUriPermission` 之后再 `persistedUriPermissions` 复查；失败给可读提示。不持久化的话重启后所有本地曲目一起变哑巴 —— 真机清单第 2 条专测这个。 |
| 3 | mime 缺失 | RN 桌面侧 `FileSystem.ls` 总能拿到真实 mime；SAF 的 `getType()` 对不少 provider 返回 `application/octet-stream`/null。此时退回 `mp3/flac/ogg/wav` 扩展名白名单；**mime 明确说了不是音频（如 `video/mp4`）就尊重它、不当音频收**。 |
| 4 | 空标题 | RN 直接 `metadata.name`，空名会被 `filterMusicList` 丢掉（表现为「导入后歌凭空消失」）→ 原生退回文件名 stem，并在用例里锁死。 |
| 5 | 节流 | RN 用 1 秒定时器合并落库；原生按「批」落库（10 条一次），`FLUSH_DELAY_MS` 常量保留但未起定时器。1000 首 = 100 次写库，与 RN 的 1 秒节流次数同量级。 |
| 6 | 封面时机 | RN 播放时按需 `readPic`（每次播放都导一次临时文件）；原生导入时落一次盘并写进 `meta.picUrl`，播放页/迷你条/分享卡都能直接用（`CoverImageLoader.load` 新增 `file://` 分支，4 个调用点零改动）。 |
| 7 | 无扩展名文件 | RN `buildLocalMusicInfoByFilePath` 的 `lastIndexOf('.')` 在无点时 `substring(0,-1)` 归一为 `""` → 歌名空 → 被 `filterMusicList` 丢弃；`extname` 另有 `lastIndexOf > 0` 守卫。两套规则不同、各照各的抄，用例 `split name and extension follows lastIndexOf dot` 锁住。 |
| 8 | RN 的「怪癖」保留 | 文件名 `a-b-c` 只在「在线搜同源」时按前两段切歌名/歌手（本波不做在线兜底，故 `splitArtist` 只有单测、无调用方）。 |

### 越界说明（`Media3PlayerPlatform.kt`，请集成会话重点看）

RULES 第 4 条允许「编译/测试必需的最小修复」，但这一处属**功能必需**，单列声明：

- 现状：`ensurePlayer` 的 `DataSource.Factory` 上游是 `DefaultHttpDataSource`。
  本地曲目的 `content://…` 交给它会直接抛 `Unsupported scheme`，**local 直连播放根本起不来**。
- 改动：新增 `SchemeRoutingDataSourceFactory`（文件末尾，private），按 scheme 分流 ——
  http(s) 走原来的「`CacheDataSource` + `DefaultHttpDataSource`（UA/超时/跨协议重定向不变）」，
  其余 scheme 走 `DefaultDataSource`（Media3 内置 `ContentDataSource`/`FileDataSource`）。
- 影响面：http 分支的缓存键、UA、超时、offload 全部未变；本地文件**不进磁盘缓存**
  （不会把本地曲库复制进 1GB 的 `TrackPlayer` 缓存）。预取/`CacheWriter` 那条路径未动。
- 备选方案与为什么没选：给 `CacheDataSource` 传返回 null 的 `CacheKeyFactory`
  （Media3 1.11.1 的该接口在 Kotlin 侧是非空 `String`，无法表达「跳过缓存」）；
  或全局 `DefaultDataSource` 兜住所有 scheme（会让本地文件也被缓存一份）。

### 真机清单（需用户执行；本地直连单列一节）

**A. 本地曲目直连播放（本次改动，别和既有缺陷混账）**

1. 选一个含 mp3/flac/ogg/wav + 1 个 txt + 1 个 jpg 的目录 → 只收 4 个音频，弹层进度到结束。
2. 重启应用后**不重新选目录**，直接播本地曲 → 能播（持久授权生效）；若出现「本地文件无法访问」
   提示，说明授权没持久化，属本车道缺陷。
3. 标签齐全的曲目：歌名/歌手/专辑/时长正确；**删掉标签**的曲目：歌名=文件名、歌手空、不丢歌。
4. 有内嵌封面的曲目：播放页/迷你条显示封面；无内嵌封面：显示占位不崩。
5. 同目录放 `song.lrc`：播放页有歌词；删掉 lrc：无歌词、不崩、不卡。
6. 拔卡 / 在文件管理器删掉文件中后播放该曲 → toast「本地文件无法访问，可能已删除或授权失效」，
   应用不崩（随后是否跳下一首由既有失败链路决定，本波未改）。
7. 拖动进度条、后台播放 10 分钟、通知栏切歌：本地曲全部正常（content URI 要支持 seek）。

**B. 导入流程与既有约束**

8. 1000 首目录：导入耗时可接受、进度在动、点「取消」能停（已入库的占位曲保留）。
9. 导入中再点「本地文件」是灰的；导入完再点可再来一次（同目录重复导入不会产生重复曲目）。
10. 空目录 → 「没有在当前文件夹中发现歌曲」。
11. 音量均衡开启时播本地曲：音量正常、无报错（`isEnableAudioOffload` 互斥约束未丢）。

### 遗留问题与对后续波次的建议

1. **RN 的在线兜底没做**：`getMusicUrl`/`getPicUrl`/`getLyricInfo` 在本地文件缺标签时会去在线搜
   「同名同歌手」再取直链/封面/歌词（`getOtherSourceByLocal`）。原生目前本地失败就失败。
   建议 Wave6 与「相似歌曲 / 标签补全」一起做，因为它要复用五源搜索与画像。
2. **内嵌歌词（ID3 USLT / MP4 内嵌）未做**：需要自写 ID3/MP4 解析，独立小任务。
3. **单层扫描**：与 RN 一致（`readDir`/`ls` 单层），用户选上层目录会漏子目录；
   要不要递归是**产品决策**（递归会改变「这一层」的含义），建议随「同步/多目录合并」一起定。
4. **节流未做真实定时器**：见语义修正 5；若真机上 1000 首导入时写库抖动，再补 1 秒合并。
5. **本地曲目会进推荐画像**：本地大批导入会像 RN 一样影响 `themeWeights`/歌手先验。
   若觉得不合适，需要在 `RecommendProfileRuntime` 的装配里按 `source == "local"` 过滤，
   属 Lane A 的地盘，我不动。
6. **备份/导出会带上 content URI**：换设备/重装后这些曲目无法播放，且**没有重定位入口**
   （RN 也没有）。建议 Wave6 做「本地曲目重扫/重定位」或导出时剥离 local 曲目。
7. **Lane C 接「本地文件」的方式**：目录选择器必须由带 Activity 的界面注册
   （`LocalMusicRuntime.registerPicker(owner, handler)`）；HomePage 若不注册，
   `importTo(listId, listTitle)` 会返回 `false`，此时菜单项应**置灰**而不是静默失败。
   `ListDetailPage` 已注册，可作为照抄模板（`DisposableEffect` + `unregisterPicker`）。
8. **集成时重点回归**：`Media3PlayerPlatform` 的 scheme 分流改了播放器的数据源工厂，
   合并后务必跑一遍「在线曲取链 → 播放 → 缓存命中」与「电台自动补位」两条链路。

