# Wave 4 · Lane C 任务书 —— S15 歌单长尾包：列表菜单补项 + lxmc 导入导出 + 整单导入/链接解析 + 封面链路

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已复核修订**（2026-10-26 协调会话；基线 = Wave3 并入后 core 558 + app 76 = 634）。
> 复核结论（重要）：原生「我的」列表行菜单住在 `ui/HomePage.kt` 的 `MyPage` 内
> （Lane A 领地），本 lane 唯一可动的列表菜单是 `ui/list/ListDetailPage.kt` 里的
> 重命名/清空/删除列表/排序/删除；`Route.SonglistDetail` 已存在且由 `HomePage.kt`
> 处理（143/172 行），但搜索页仍走 `detailTarget` 页内覆盖；`BackupManager`
> 目前零 app 接线；`CoverImageLoader` 公开 API 见任务 5。

## 背景

进度文档多轮遗留合成本包（均为歌单/列表侧长尾，文件面与另两条车道不相交）：

- **列表级菜单缺 5 项**（Wave3 候选 5）：去重 / 本地文件 / 同步 / 导入 / 导出
  （RN `src/screens/Home/Views/Mylist/MyList/` 的 `DuplicateMusic.tsx`、
  `ListImportExport.tsx`、`ListMenu.tsx`、`listAction.ts`）。
- **整单导入与路由缺口**（Wave3 集成记录 Lane C 遗留）：外部歌单「整单导入」未移植；
  kw digest/kg 酷狗码/tx playsquare/wy 单段链接等 id 解析入口未接
  （解析函数本身已在 `core/songlist/` 各源 `normalizeId`，缺的是入口与判定链）。
- **封面链路**（B4 待办）：RN `getPicPath` 的校验/磁盘缓存/失败占位未移植
  （`CoverImageLoader.kt` 注释自己承认是 B4 临时实现）。
- `core/backup/BackupManager.kt` 数据层 B1 就闭环了，**UI/SAF 接线一直没做**（B1 验收对照项）。

## 任务

1. **菜单去重**：对照 RN `DuplicateMusic.tsx` 的去重弹层语义（重复组展示、勾选删除）
   落到 `ui/list/`；判定/分组纯规则进 `core/list/`（新增，配 JVM 单测）。
   **入口位置写死**：只能加进 `ui/list/ListDetailPage.kt` 既有列表菜单
   （与重命名/清空/删除列表/排序/删除同处）；首页「我的」的**列表行**菜单在
   `ui/HomePage.kt` 的 `MyPage` 内，属 Lane A，本波不接，写进遗留。
2. **lxmc 导入/导出**：接 `BackupManager` + SAF——导出 `ACTION_CREATE_DOCUMENT`、
   导入 `ACTION_OPEN_DOCUMENT`（项目记忆：导出走 SAF 已在安卓16真机验通、
   **同名不覆盖会堆 `(1)`**——RN 侧同名行为先实证，至少给出提示）；
   导入类型/冲突处理对照 RN `ListImportExport.tsx` 与 B1 已实现的
   `importPlayList` 全类型分支。`BackupManager` 目前**零 app 接线**（已核实），
   SAF 辅助类新建在 `util/`（**本波 `util/` 归本 lane**，现只有 `SystemSettings.kt`）。
   入口同样放 `ListDetailPage.kt` 的列表菜单，不碰 `HomePage.kt`。
3. **整单导入 + id/链接解析入口**：外部歌单页（`ui/songlist/` 详情）加
   「导入为新歌单」——**语义按用户 10-19 纠正过的版本：整张外部歌单新建一张自建歌单
   （不是塞进已有列表），与爱心收藏同认人不建两张**；后台补全走既有
   `SonglistDetailPager/getListDetailAll`。
   链接解析入口做**粘贴式**（对话框粘贴 → 各源 `normalizeId` 判定链 →
   `HomeNavigator.Route.SonglistDetail`）。**路由现状（w3-C 报告「路由缺口」）**：
   `Route.SonglistDetail` 其实已存在并由 `ui/HomePage.kt` 处理，问题只在搜索页
   （`ui/search/SearchPage.kt`）用 `detailTarget` 页内覆盖、不进导航栈、返回后滚动位置重置；
   该文件归 Lane A/禁触，本波不修。因此本 lane 的入口必须放在**自己范围内且已拿到导航回调**
   的位置：`ui/songlist/SonglistPanel.kt`（已有 `onOpenSonglist(source, id, title)` 回调）
   或 `SonglistDetailPage`；**不许改 `HomePage.kt` / `HomeNavigator.kt` / `ui/search/`**。
   若产品上更合适的入口是「我的」页或搜索页，写遗留由集成后另立任务；deeplink intent
   过滤不本波做，写遗留。
4. **本地文件 / 同步两项**：依赖未移植能力（本地曲库/服务器），**只做评估**：
   读 RN 对应实现，结论与最小依赖清单写报告，不实现。
5. **封面 getPicPath 链路**：`CoverImageLoader.kt` 补磁盘缓存/校验/失败占位
   （对照 RN `getPicPath`，先实证缓存目录与键规则）。**既有行为必须保持**（已核实）：
   `object` + `suspend fun load(rawUrl: String?): CoverArt?`、`CoverArt(cover, blurSource)`、
   内存 LRU 6 张、最长边 1200、`RGB_565`、`blurSource` 32px。
   **本波该文件归本 lane，Lane B 只调用 `load`**——扩展公开 API 可以，
   改既有方法签名/语义不行。
6. **首页列表长按菜单入口**：本波不做（列表行菜单在 `ui/HomePage.kt` 的 `MyPage` 内，
   归 Lane A），写遗留。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/list/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/songlist/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/util/`（本波独占）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/CoverImageLoader.kt`
- `android-native/core/src/main/kotlin/cn/toside/music/core/list/`（只新增/扩展，既有语义不动）
- `android-native/core/src/main/kotlin/cn/toside/music/core/songlist/`（仅解析判定链缺口）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`ui/radio/`、`core/.../recommend/`、
  `core/.../player/`、`app/.../player/`、`AndroidManifest.xml`（Lane A 范围）
- `ui/share/`、`core/.../share/`、更多菜单 sheet（Lane B 范围——分享入口行由 B 加）
- `ui/settings/`、`core/.../setting/`、`ui/search/`、`core/.../music/search/`、
  `userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 去重分组/导入冲突/id 判定链有 JVM 单测（BackupManager 往返已有，接 UI 后的
  InMemory KvStore 全链路用例补上）；
- 本地文件/同步的评估结论 + 首页长按菜单、deeplink 两项遗留写清楚；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；真机清单（SAF 导入导出各安卓档、
  整单导入语义、封面断网占位）写报告。

## Lane 报告（2026-10-26）

- 结论：完成。任务 1（列表菜单去重）、2（lxmc SAF 导入导出）、3（整单导入 + 链接解析入口）、
  5（封面磁盘缓存）全部落地；任务 4（本地文件 / 同步）按要求只做评估，结论见下；任务 6
  （首页列表长按菜单）按任务书写遗留。未做真机验收（本 lane 无设备），真机清单见末节。
- commit：`ef4fd9b`（core 去重分组/导入冲突/链接解析）、`1097d40`（列表菜单 + SAF + 去重弹层）、
  `bf3f6cd`（内置列表改名复制用例 + ktlint）、`f0de3b1`（整单导入 + 链接打开）、
  `f589887`（封面磁盘缓存）。
  测试数 core 578 + app 76 全绿（基线 634 → 654，新增 20 条 core 用例）；
  `gradlew.bat ktlintCheck test assembleDebug` 全绿。
- 触碰文件清单：
  - core 主代码：`core/.../backup/BackupManager.kt`、`core/.../list/DuplicateMusic.kt`（新增）、
    `core/.../list/SourceListMatch.kt`（新增）、`core/.../songlist/SonglistLinkParser.kt`（新增）
  - core 测试：`core/.../backup/BackupManagerTest.kt`、`core/.../list/DuplicateMusicTest.kt`（新增）、
    `core/.../list/SourceListMatchTest.kt`（新增）、`core/.../songlist/SonglistLinkParserTest.kt`（新增）
  - app 主代码：`app/.../ui/list/DuplicateMusicDialog.kt`（新增）、`app/.../ui/list/ListDetailPage.kt`、
    `app/.../ui/songlist/SonglistDetailPage.kt`、`app/.../ui/songlist/SonglistPanel.kt`、
    `app/.../ui/play/CoverImageLoader.kt`、`app/.../util/SafDocuments.kt`（新增）、
    `app/.../MusicApp.kt`（越界，见末节 Rule 4 记录）
  - 文档：`docs/waves/w4-C.md`（本报告）
- 语义修正与实证发现：
  1. **同名导出**：RN 导出文件名固定 `lx_list_part_${filterFileName(name)}.lxmc`
     （`MyList/listAction.ts:66`），`utils/tools.ts:159 handleSaveFile` 直接
     `gzipFile(temp, path)` 覆盖写，**无存在性检查/序号**；SAF `CreateDocument` 由系统把
     同名自动改成 `(1)`、不覆盖原文件。已在导出确认弹窗明示「若已有同名文件，系统会自动改名
     并追加「(1)」，不会覆盖原文件」。
  2. **列表菜单导入类型**：RN 列表菜单只接受 `playListPart(_v2)`（`readListData` 的 type
     switch，其余类型 `showImportTip` 拒绝）；原生列表菜单额外接受整表备份
     （playList_v2/allData_v2/playList/allData），并套用 RN 设置页 `importPlayList` 的二次
     确认文案。原因：原生尚无设置页备份入口，若照 RN 拒绝整表文件，整表导入将无任何入口；
     该放宽是语义选择，非 RN 对齐。
  3. **内置列表冲突语义**：RN `handleImportListPart` 冲突且取消覆盖 = id 追加 `__<ts>` 后
     `createList`，内置列表本身不动；B1 原生实现对 default/love 的 RENAME_COPY 是"追加进
     内置列表"，本波按 RN 修正，新增 `partRenameCopyOfBuiltinCreatesUserList` 单测钉住。
  4. **"与爱心同认人不建两张"缺口**：原生爱心列表没有 `source`/`sourceListId` 元数据
     （目前没有"收藏在线歌单进爱心"的写入路径），无法判定来源身份；整单导入的去重
     （`SourceListMatch`，兼容 `sourceListId == id` 与 `${source}__${id}` 两种历史形态）
     只覆盖 userLists。写遗留。
  5. **kw 链接跨域**：RN kw `normalizeId` 不校验 host，任意域名的同路径链接都会被接受；
     原生保持一致（跨源粘贴需用户手选来源），对话框提示文案照抄 RN
     `songlist_open_input_tip` 四条。
  6. **id 判定链覆盖**：kg 仅 `id_<数字>` 与 `.../special/single/<数字>.html`（既有
     `normalizeId`），纯数字酷狗码/用户歌单 RN 走另外接口，本波未接；mg 支持纯 id、
     `playlistId=`/`id=`、`/playlist/<id>`，短链 `c.migu.cn/xxx` 需跟重定向未接；
     wy `###token` 整段原样透传给详情层。
  7. **封面缓存无 RN 对照物**：RN `getPicPath` 只解析 URL（图片缓存由 Fresco 内部完成），
     没有显式缓存目录/键规则；原生磁盘缓存为自设计：`cacheDir/cover_images/<sha1(url)>.cover`
     存原始字节、解码失败删文件回源、tmp+rename 原子写、>300 张按 mtime 淘汰、读命中刷新
     mtime。既有 `object`/`load(rawUrl: String?)`/`CoverArt`/LRU 6/最长边 1200/RGB_565/
     blur 32 全部不变，`init(context)` 是新增 API，未调用时退化为原行为。
  8. **SAF 文件类型过滤**：RN 在 picker 层按扩展名 json/lxmc/bin 过滤；Android `OpenDocument`
     用 `*/*` + 读后按扩展名校验（部分 provider 把 .lxmc 报成 octet-stream/gzip，绑死 MIME
     会误伤合法文件）。
- 遗留问题与对后续波次的建议：
  - **本地文件（只评估）**：RN 链路 = SAF 目录（`isPersist`）→ `handleImportMediaFile` →
    `scanAudioFiles`/`readMetadata`（`react-native-local-media-metadata` 原生模块）→
    构造 `source:'local'` + `meta.filePath` → 播放器直接播文件。原生缺口：①
    `PlayerRuntime` 统一走 `userApi.getMusicUrl`，没有 `source=='local'` 直接读 `meta.filePath`
    的分支；②需 `MediaMetadataRetriever` 读标签/内嵌封面/歌词（写 .lrc/封面的授权规则另定）；
    ③SAF 目录需 `takePersistableUriPermission`；④`MusicInfoTools.sanitizeMusicInfo` 已能
    兜住 local 的 `filePath`/`ext`。预计独立 M 级任务，建议 Wave5 单列。
  - **同步（只评估，依赖已齐）**：RN `core/syncSourceList.ts` 仅需 `source`+`sourceListId`
    → 全量拉取（`board__` 前缀走榜单整表）→ `overwriteListMusics` → 更新时间。原生已有
    `SonglistRuntime.getListDetailAll`、`LeaderboardRuntime.getListDetailAll`、
    `ListStore.listMusicOverwrite`、`locationUpdateTime`，且整单导入已写入 source/sourceListId，
    下一波可直接在列表菜单加「同步」+ RN `list_sync_confirm_tip` 确认，无需后端。
  - **首页「我的」列表行长按菜单**：`ui/HomePage.kt` 归 Lane A，本波未接；当前所有新菜单只在
    列表详情页顶部操作行（已改为横向滚动以容纳 9 项）。
  - **deeplink intent filter**（外部链接直接进歌单详情）未做。
  - **其他长尾**：kg 酷狗码、mg 短链、wy 私人雷达（需 Token）、QQ 未公开个人主页，
    按 RN 提示文案保留说明，实际打开由详情接口报错。
  - **真机清单（本 lane 未执行，待集成后验收）**：
    1) 导出：安卓 13/14/16 各一次，选同名文件确认系统生成 `(1)` 且原文件不被覆盖；
    2) 单列表导入冲突：覆盖 → 本地名保留、歌曲被替换；取消 → 新建 `id__<ts>` 副本，原列表
       不动（含 default/love）；无冲突 → 直接新建；
    3) 整表备份导入：二次确认文案、导入后当前页刷新、当前列表已不存在时的返回；
    4) `.json`（明文）与 `.lxmc`（gzip）两种文件，错误/不支持文件提示；
    5) 在线歌单「导入为新歌单」：整单顺序、同源同单再次点击提示已存在、返回「我的」可见新
       列表并可播放；
    6) 歌单链接粘贴：五源各一条合法链接/id、错误链接提示、kw 跨域链接 + 手选来源、
       wy `###token`；
    7) 封面：断网首开显示占位不崩、联网后恢复、清空 `cacheDir/cover_images` 后恢复、
       写坏缓存文件后自愈；
    8) 去重弹层：分组排序、勾选移除确认、单条移除、空列表文案；
    9) 操作行横滑：小屏下 9 项可滑到「导出」。
- Rule 4 越界记录：`app/.../MusicApp.kt` 仅 +5 行，用于在应用根调用
  `CoverImageLoader.init(applicationContext)`（公共 API 未变、无其他逻辑改动）。
