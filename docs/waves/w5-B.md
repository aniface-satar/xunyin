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

## Lane 报告（待填）
