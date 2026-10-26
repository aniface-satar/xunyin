# Wave 5 · Lane C 任务书 —— S18 入口与分享收尾：首页长按菜单 + deeplink + 系统分享

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **起草时点复核**（2026-10-26；基线 = Wave4 并入后 `f214bd8`，core 742 + app 76 = 818）。
> 已复核事实：
>
> - `ui/HomePage.kt` 共 491 行，`MyPage`（第 393 行起）的列表行是 `Item(onClick = ...)`，
>   **全工程没有任何 `combinedClickable` / `onLongClick`** —— 首页列表行长按菜单确实不存在。
> - RN 列表行菜单是 `src/screens/Home/Views/Mylist/MyList/ListMenu.tsx`，**9 项**：
>   新建 / 重命名 / 排序 / 去重 / 本地文件 / 同步 / 导入 / 导出 / 删除（带 `disabled` 规则：
>   default/love 禁重命名与删除、非用户列表禁同步）。
> - `AndroidManifest.xml` 只有 `MAIN` + `LAUNCHER` 一个 intent-filter，**没有 scheme**；
>   `MainActivity` 是 16 行空壳（`setContent { MusicApp() }`），没有 `onNewIntent`。
> - RN deeplink 在 `src/core/init/deeplink/index.ts`：`lxmusic://<type>/<action>/<paths>`，
>   type 有 `music` / `songlist` / `player`，另有文件打开（json、lxmc、js、音频）。
> - `HomeNavigator.Route` 现有 `ListDetail` / `LeaderboardDetail` / `SonglistDetail` / `Radio`。
> - `ShareCardSaver.save(...)` 返回 `ShareSaveResult.Saved(fileName)`，**没有返回 Uri**，
>   所以系统分享现在还发不出去；`DefaultSetting` 里 `common.shareType`（默认 `"system"`）、
>   `shareCard.savePath`、`shareCard.savePathName` **已经存在**，不许再重复造键。
>   **协调会话复核补充**：内部其实**已经持有** MediaStore Uri（私有
>   `writeBitmap(resolver, uri, bitmap)`，`ShareCardSaver.kt:65-80`），只是没往上抛 →
>   任务 3 属「把已有 Uri 带出来」，不需要重做保存链路。

## 背景

三件都被前几波点名留到后面：首页长按菜单（w3/w4 两次遗留）、deeplink（w4-C 明确「不本波做」）、
系统分享（w4-B 遗留 1）。它们的落点全部集中在 `HomePage` / `HomeNavigator` / `MainActivity` /
`Manifest` / `ui/share`，与另两条车道不相交，适合合成一条「入口与分享收尾」车道。

## 任务

1. **首页列表行长按菜单**：给 `MyPage` 的列表行加长按 → 弹出 RN 同构菜单（9 项，含
   `disabled` 规则：试听列表/我的收藏 禁重命名与删除；非用户列表禁同步；导入中禁本地文件）。
   菜单动作实现放**新文件** `ui/list/ListMenuActions.kt`（去重弹层复用既有
   `ui/list/DuplicateMusicDialog.kt`，导入/导出复用 `core/backup/BackupManager` +
   `util/SafDocuments`，排序复用既有排序弹层语义）。
   **`ui/list/ListDetailPage.kt` 归 Lane B（它在加「本地文件」），一个字不许改**——
   因此这里的动作实现与 `ListDetailPage` 内联逻辑短期会重复，属**已知取舍**，
   写进报告遗留（Wave6 统一收口）。
   「本地文件」项调用 Lane B 的公开入口 `LocalMusicRuntime.importTo(...)`；
   B 未落地前该项置灰并写遗留。
2. **deeplink**：`AndroidManifest.xml` 给 `MainActivity` 加 `lxmusic` scheme 的 VIEW intent-filter
   （**禁动 `android:screenOrientation="portrait"`**，AGENTS.md 硬约束；`launchMode` 如需调整
   必须单列说明并记报告）；`MainActivity` 解析 `onCreate` + `onNewIntent`，路由到
   `HomeNavigator`（`songlist` → `Route.SonglistDetail`，`music`/`player` → 播控既有公开方法）。
   文件打开只做 `json` / `lxmc`（复用 `BackupManager`），**`js` 音源导入与音频文件不在本波**
   （前者撞 `userapi`，后者依赖 Lane B），写遗留。
   `app/player/` 归 Lane B，本 lane **只许调用既有公开方法**；若缺方法，降级该分支并记遗留。
3. **系统分享收尾**：`ShareCardSaver.save` 补返回 `uri`（扩展结果类型可以，**不许改既有语义**），
   保存成功后按 `common.shareType` 走 `ACTION_SEND`（图片 + 可选文案），取消/无应用可分享要
   有可读提示；分享类型/默认比例用既有 `DefaultSetting` 键接线（`core/setting/` 只许在表尾追加，
   不许改既有键的默认值）。`ui/share/`、`core/share/` 归本 lane 独占。
4. **播放页 morph 转场（只评估）**：Compose 侧 `SharedTransitionLayout` 与 RN reanimated 的差距、
   代价与风险，结论写报告，本波不实现。
5. **搜索「歌手/专辑」类型**：RN 有 `music/songlist/album/artist` 四类，原生只有前两类——
   属独立 M 级任务（五源 × 两类解析），**本波不做**，在报告里给立项输入（需要新增的 core 文件与
   接口清单），留给 Wave6。

## 范围（只许改这里）

- `android-native/app/.../ui/HomePage.kt`、`HomeNavigator.kt`、`MainActivity.kt`
- `android-native/app/src/main/AndroidManifest.xml`（仅 intent-filter / launchMode；
  **禁动方向属性**）
- `android-native/app/.../ui/share/`、`android-native/core/src/main/kotlin/.../core/share/`
- 新增 `android-native/app/.../ui/list/ListMenuActions.kt`（只新增文件，不改 `ListDetailPage.kt`）
- `android-native/core/.../setting/DefaultSetting.kt`（仅表尾追加）、`ui/settings/`（可选分享小节）
- 新增测试放对应包

## 禁触

- `ui/list/ListDetailPage.kt`、`core/local/`、`app/.../player/PlayerRuntime.kt`、
  `ui/play/CoverImageLoader.kt`、`util/SafDocuments.kt`（Lane B 正在改；`SafDocuments` 只许调用）
- `core/.../recommend/`、`ui/radio/`、`ui/songlist/RecommendPanel.kt`（Lane A 范围）
- `ui/search/`、`core/.../music/search/`、`userapi/`、`core/.../player/`（尽量不改）、
  `.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 菜单可用性规则（default/love/非用户列表）有纯规则单测；deeplink 解析做成可测函数
  （`lxmusic://...` 样本表进 JVM 单测），不许把解析逻辑埋在 `onCreate` 里；
- 报告含：9 项菜单的落地/置灰/遗留对照、deeplink 支持矩阵、分享类型矩阵、
  morph 评估结论、搜索类型立项输入、真机清单（长按菜单 / `adb shell am start -a VIEW -d "lxmusic://..."` /
  分享到微信与相册 / 竖屏全程）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告（2026-10-26）

- **结论**：完成（任务 1/2/3 全部落地；任务 4 morph 只评估已交结论；任务 5 搜索类型按任务书本波不做，
  已交立项输入）。
  - 任务 1：首页「我的」列表行长按 → RN 同构九项菜单，**九项全部有落点**，其中「更新」因原生没有
    `syncSourceList` 移植而**恒置灰**（见遗留 3），「添加本地歌曲」由可注入钩子驱动，
    未接入 Lane B 前置灰（见遗留 2）。
  - 任务 2：`lxmusic://` scheme + `singleTop` + `onCreate`/`onNewIntent` 双入口；
    解析全部在纯函数 `DeeplinkParser`（16 条样本表单测），`MainActivity` 里没有一行解析逻辑。
    `songlist/play`、`music/play`、`player/*`（8 个动作）全部接通；文件打开只做 json/lxmc。
  - 任务 3：`ShareCardSaver.save` 返回值扩为 `Saved(fileName, uri)`（既有语义不变），
    分享卡新增「分享卡片」按钮走 `ACTION_SEND`（图片 + 文案），失败有可读提示。
  - 未写任何 `core/` 代码（core 用例数一位没变）。
- **commit**：`3de6f02`（解析器+用例）→ `bcc5e58`（deeplink 落地）→ `9fce559`（长按菜单+用例）
  → `26a1e21`（系统分享）；测试数 **core 742 + app 99 = 841 全绿**（app 从 76 → 99，+23：
  deeplink 16 + 菜单规则 7）；APK **28,622,428 B**。
  > 体积比基线（28,860,935）**小了 238 KB**，本 lane 没有删任何资源/依赖，也解释不出这个方向 ——
  > 集成时请以三条车道合并后的新构建为准，若仍异常再查（怀疑是 debug 包未固定的资源顺序/压缩差）。
  分支 `w5/laneC`，工作区干净。
- **触碰文件清单**（供集成定位冲突）：
  - 改：`app/src/main/AndroidManifest.xml`（**只加** `launchMode="singleTop"` 与两个 intent-filter；
    `android:screenOrientation="portrait"` 一个字没动）
  - 改：`app/.../MainActivity.kt`、`app/.../HomeNavigator.kt`（新增 `openFromDeeplink`）、
    `app/.../ui/HomePage.kt`（长按触发 + `ListMenuHost` + `DeeplinkFileHost` + 导航器挂载）
  - 改：`app/.../ui/share/ShareCardSaver.kt`（`Saved` 增加 `uri`）、
    `app/.../ui/share/ShareCardOverlay.kt`（分享按钮 + 已存图复用）
  - 增：`app/.../deeplink/Deeplink.kt`（纯模型 + 解析器）
  - 增：`app/.../deeplink/DeeplinkRuntime.kt`（命令落地 + 冷启动排队）
  - 增：`app/.../deeplink/DeeplinkFileHost.kt`（json/lxmc 确认层）
  - 增：`app/.../ui/list/ListMenuActions.kt`（九项规则 + 菜单宿主 + 长按手势）
  - 增：`app/.../ui/share/ShareImageSender.kt`（ACTION_SEND）
  - 增：`app/src/test/.../deeplink/DeeplinkParserTest.kt`(16)、
    `app/src/test/.../ui/list/ListMenuRulesTest.kt`(7)
  - **没有碰**：`ui/list/ListDetailPage.kt`、`core/local/`、`app/player/`、`util/SafDocuments.kt`、
    `ui/play/CoverImageLoader.kt`、`core/recommend/`、`ui/radio/`、`ui/search/`、`core/setting/`、
    `gradle/`、`.github/`。

### 语义修正与实证发现

| # | 位置 | 起草稿/直觉 | 实证（RN 源码） | 本 lane 的处理 |
|:--|:--|:--|:--|:--|
| 1 | `ListMenu.tsx:75` | 菜单项文案「本地文件」「同步」 | i18n 实为 `list_select_local_file`=**「添加本地歌曲」**、`list_sync`=**「更新」** | UI 按 i18n 文案 |
| 2 | `ListMenu.tsx:94-95` | 「非用户列表禁本地文件」 | `local_file` 的开关是 `listState.fetchingListStatus[id]`（**导入进行中**），与列表身份无关 | 规则改为 `localFileReady && !importing` |
| 3 | `ListMenu.tsx:85` | 「非用户列表禁同步」 | `sync = !!(userList.source && musicSdk[source].songList)`，再 `disabled: !sync \|\| !local_file` | 规则含 source 判定；`syncSupported` 原生恒 false |
| 4 | `songlistAction.js:60` | deeplink `paths[1]` 是歌单 id | 是 **url**（`songlistInfo.url = paths[1]`），id 只来自 `?data=` | 命令模型分开 `id`/`url` 两个字段 |
| 5 | `deeplink/index.ts:23` | query 正常按 `=` 切 | `const [key, value] = param.split('=')` 解构 → 值在**第二个 `=`** 处截断 | 逐位照抄并写进单测 |
| 6 | `deeplink/index.ts:28` | `decodeURIComponent` ≈ `URLDecoder` | 前者**不**把 `+` 当空格，后者会 | 先把 `+` 转义成 `%2B` 再解 |
| 7 | 任务书 §3 | 「保存成功后按 `common.shareType` 走 ACTION_SEND」 | `common.shareType`(`system\|clipboard`) 在 RN 里**只管文字分享**（`tools.ts#shareMusic/shareSonglist`）；分享卡是「保存」「分享」两个独立按钮，分享无条件走 `shareImage`（`ShareCardModal.tsx:126-130`） | 分享按钮直接 ACTION_SEND，不看 shareType（见遗留 7） |
| 8 | `saveCard.ts` | 分享卡存到 `shareCard.savePath`（用户选目录） | W4 已改成 MediaStore `Pictures/寻音`；分享复用同一 `content://`，**不需要 FileProvider** | 分享用 MediaStore Uri + `ClipData` + `FLAG_GRANT_READ_URI_PERMISSION` |
| 9 | `playerAction.ts:collect` | 收藏 = 电台点赞 | RN `collectMusic` 是往 **LOVE 列表**增删；原生 `RadioRuntime.like` 语义是电台反馈 | deeplink 收藏走 `ListStore` 的 LOVE，`dislike` 走 `RadioRuntime.dislike` |
| 10 | `musicAction.js:filterInfoByPlayMusic` | 逐源 `dataVerify` + `qualityFilter` | 五源字段差异极大（kw/kg/tx/wy 要 `songmid`，mg 要 `copyrightId`，kg 还要 `hash`） | 只校验 name/singer/source/id，其余字段整体搬进 `meta` 再过 `MusicInfoTools.sanitizeMusicInfo`（取链脚本要的键都在） |
| 11 | Compose 手势 | 外层 `combinedClickable` 可以覆盖 `Item` 的点击 | `Item` 自带 `clickable`，Main pass 由内向外 → 按下事件被内层消费，外层长按**永不触发** | 自定义 `Modifier.onListLongPress`：Initial 阶段观察，正常路径零消费（点击/水波纹原样），长按成立后才吞掉后续事件避免二次点击 |

### 九项菜单落地对照

| # | 菜单项 | 状态 | 落点 / 置灰条件 |
|:--|:--|:--|:--|
| 1 | 新建列表 | ✅ | 复用首页既有 `InputDialog`（`onCreateList` 回调） |
| 2 | 重命名 | ✅ / 置灰 | `ListStore.renameUserList`；试听列表、我的收藏置灰 |
| 3 | 排序歌曲 | ✅ | 9 档规则排序 `MusicSort` + `listMusicUpdatePosition`；「自定义排序」跳列表详情页（拖拽只在那儿） |
| 4 | 重复歌曲 | ✅ | 复用 `DuplicateMusicDialog`（`core/list/DuplicateMusic`） |
| 5 | 添加本地歌曲 | ⏸ 钩子 / 置灰 | `LocalFileImport.importTo`（见遗留 2）；未注入或导入中置灰 |
| 6 | 更新（同步） | ❌ 恒置灰 | 原生无 `syncSourceList` 移植（见遗留 3） |
| 7 | 导入 | ✅ | SAF `OpenDocument` + `BackupManager`（单列表冲突两按钮、整表二次确认同 RN 文案） |
| 8 | 导出 | ✅ | SAF `CreateDocument` + `exportSingleList` + 同名自动改号提示 |
| 9 | 删除 | ✅ / 置灰 | `userListsRemove` + 活动列表回落到试听列表；内置列表置灰 |

### deeplink 支持矩阵

| type / action | 参数形态 | 状态 | 落地 |
|:--|:--|:--|:--|
| `songlist/play` | `/source/url[/index]` 或 `?data={source,id,index}` | ✅ | `HomeNavigator.openFromDeeplink(Route.SonglistDetail)`（切到「发现」再压栈） |
| `music/play` | `?data={name,singer,source,...}` | ✅ | `core.addTempPlayList(top)`；正在播时 `playNext()`（与 RN 一致，空闲时只入队） |
| `music/searchPlay` | `/歌名-歌手` | ❌ | 跨源搜索未移植（见遗留 4） |
| `player/play`、`pause`、`skipNext`、`skipPrev`、`togglePlay` | 无 | ✅ | `PlayerCore` 既有公开方法 |
| `player/collect`、`uncollect` | 无 | ✅ | LOVE 列表增删 + `handleListMusicsUpdated` |
| `player/dislike` | 无 | ✅ | `RadioRuntime.dislike`（落规则 + 跳下一首，与 RN `dislikeMusic` 同语义） |
| 未知 type / action | — | ⚠️ toast | `调用失败：<reason>`（对齐 `deep_link__handle_error_tip`） |
| 文件 `content://…json` | — | ✅ | Manifest 广告 + `DeeplinkFileHost` 确认 → `BackupManager.importJson` |
| 文件 `…lxmc` | — | ✅（应用内） | 同上，但 Manifest 不广告（无标准 MIME，见遗留 5） |
| 文件 `.js` / 音频 | — | ❌ | 本波不做（`js` 撞 `userapi`，音频依赖 Lane B），解析层直接给可读拒绝 |

`launchMode` 调整说明：改为 `singleTop`。本应用只有一个 Activity，`singleTop` 即可保证运行中
再次收到链接走 `onNewIntent`，且没有 `singleTask` 的清栈副作用（后台时不会把播放页栈打散）。
manifest 里**没有**新增 provider / permission，竖屏属性未改。

### 分享类型矩阵

| 动作 | 行为 | 文案/参数 | 失败提示 |
|:--|:--|:--|:--|
| 保存图片 | MediaStore 写 `Pictures/寻音/`（W4 原逻辑不变） | `已保存：<文件名>` | `保存失败，请稍后重试`；API 26–28 给版本提示 |
| 分享卡片 | `ACTION_SEND` `image/png` + `EXTRA_STREAM`(content uri) + `ClipData` + `FLAG_GRANT_READ_URI_PERMISSION` | chooser `将「歌名」分享到...` / SUBJECT `歌曲分享` / TEXT `歌名 - 歌手`（与 RN 逐位对齐） | `没有找到可以分享的应用` / `分享失败，请稍后重试` |
| 同一预览内重复分享 | 复用首次落盘的 Uri，不再往相册堆图 | — | — |
| `common.shareType` | **未参与**（实证见语义修正 7）；设置页也没有分享小节 | — | 见遗留 7 |

### 任务 4：播放页 morph 转场（只评估）

- **结论：本波不实现，且实现前必须先动 gradle（本波禁触），Wave6 单独立项。**
- **硬依赖缺口**：`SharedTransitionLayout` / `Modifier.sharedElement` 在
  `androidx.compose.animation:animation` 里。`app/build.gradle.kts` 只显式依赖
  foundation / foundation-layout / ui / ui-text / ui-graphics / runtime，
  `androidx.compose.animation` **只有 `animation-core` 是传递进来的**（`LyricView` 用的
  `animateFloatAsState` 属 animation-core，不是 animation）。补依赖要改
  `app/build.gradle.kts` + `libs.versions.toml`，两条都是本波禁触。
- **结构障碍**：首页/详情/播放页靠 `RetainedContent`（自定义 `Layout`，**只 measure 可见那一页**）
  保活三页。共享元素动画要求起始页与目标页在同一帧都完成 measure/place，
  而 `RetainedContent` 恰恰不 measure 非可见页 → 现状下 `sharedElement` 拿不到目标几何。
  要做得把 `RetainedContent` 换成 `AnimatedContent`/`AnimatedVisibility` 或加一层 overlay，
  影响面覆盖 `MusicApp.kt` / `HomePage.kt` / `NavStack.kt`（后两个本波归 C，但改法属结构重构）。
- **RN 侧参照**：`reanimated` 的 morph 是「测量源视图 → 绝对定位克隆 → 插值」，没有 Compose
  的 key-based 共享元素那么"约束式"；我们的封面是 `CoverImageLoader`（Bitmap）而不是 Image 组件，
  播放页封面还有圆角/阴影差分。等价度尚可，但要逐元素标 key（封面、标题、歌手、播放条）。
- **代价估算**：依赖 +1、结构重构 2 个文件、逐元素 key 与退场顺序调参、三页保活策略重写，
  再加真机验收；属于**独立 M 级任务**，不适合塞进收尾车道。
- **建议**：Wave6 与「更多分页」一起做，先做「播放条→播放页」单元素 morph 验证，
  不要一次上整页。

### 任务 5：搜索「歌手 / 专辑」类型（立项输入，本波不做）

- 现状：`core/music/search/` 有 16 个文件 = 五源音乐搜索（5）+ 五源歌单搜索（5）+ 4 个编排/模型
  （`SearchAggregator`/`SearchCoordinator`/`SearchModels`/`SonglistSearch*`）。RN 是四类
  （`music`/`songlist`/`album`/`artist`），原生缺后两类。
- 需要新增（按源 × 类型，共 10 个解析器 + 1 套模型 + 1 套编排）：
  - `core/music/search/album/`：`KwAlbumSearch.kt`、`KgAlbumSearch.kt`、`TxAlbumSearch.kt`、
    `WyAlbumSearch.kt`、`MgAlbumSearch.kt`
  - `core/music/search/artist/`：同上五源
  - `core/music/search/AlbumSearchCoordinator.kt`、`ArtistSearchCoordinator.kt`
  - `core/music/search/SearchModels.kt` 追加 `AlbumItem(id, name, singer, img, publishTime,
    songCount, source)`、`ArtistItem(id, name, img, alias, albumCount, source)`
- 每个解析器都要 fixtures 黄金用例（RN 侧五源返回结构互不相同：kw 用 `albumid`、kg 用
  `album_id` + `publish_time`、tx 用 `albumMid`、wy 用 `album.id`、mg 用 `albumId`；歌手侧
  kw 是 `artistid` + `musicNum`、wy 是 `artist.id` + `albumSize`）。
- app 侧：`SearchRuntime.SOURCES` 加类型维度、`SearchPage` 加四个二级 tab（**归搜索车道，非本 lane**）、
  专辑/歌手详情页（RN `AlbumDetail`/`ArtistDetail` 两张页，原生均无）。
- 量级：独立 M 级任务，建议 Wave6 单开车道；与 B7 收官并行不冲突（只碰 `core/music/search/`
  与 `ui/search/`）。

### 真机清单（本 lane 归属项）

- [ ] `adb shell am start -a android.intent.action.VIEW -d "lxmusic://songlist/play/kw/<id>"`
      冷启动 → 直接落在该歌单详情；再按返回能回到发现页
- [ ] 应用在前台时同一条命令 → 走 `onNewIntent`，不新开 Activity（`adb shell dumpsys activity
      activities | grep MainActivity` 只有一个实例）
- [ ] `am start -d "lxmusic://player/togglePlay"` / `pause` / `skipNext` / `skipPrev` 各一次
- [ ] `am start -d "lxmusic://player/collect"` → 「我的收藏」多一首；`uncollect` → 少一首
- [ ] `am start -d "lxmusic://music/play?data=<URL 编码后的 JSON>"`：正在播放时立刻切到该曲；
      停播状态只入队（与 RN 一致）
- [ ] 非法链接（`lxmusic://songlist/play/local/x`）→ toast「调用失败：Source no match」
- [ ] 长按「试听列表」「我的收藏」「自建列表」各一次 → 九项菜单弹出；**普通点击仍进详情页**
      （验证手势没有抢点击）
- [ ] 菜单置灰：试听/收藏的「重命名」「删除」灰；导入中的「添加本地歌曲」「更新」灰
- [ ] 菜单功能：重命名 / 排序（含「自定义排序」跳详情）/ 重复歌曲 / 导入（选 .lxmc 走冲突两按钮）/
      导出（同名自动改号）/ 删除（活动列表回落到试听列表）
- [ ] 分享卡「分享图片」→ 微信 → 图片能正常预览；「保存图片」仍进相册
- [ ] 分享到相册后杀进程重进 → 图仍在（MediaStore 已 `IS_PENDING=0`）
- [ ] 全程竖屏（长短按、菜单、分享 chooser 旋转设备都不出现横屏）

### 遗留问题与对后续波次的建议

1. **`ListMenuActions` 与 `ListDetailPage` 逻辑重复**（导入/导出/排序）：任务书约定的已知取舍，
   `ListDetailPage.kt` 归 Lane B 一个字不能改。建议 Wave6 把导入/导出/排序抽成
   `ui/list/ListFileActions.kt`，两处都调。
2. **「添加本地歌曲」的装配（集成会话必做）**：菜单项读 `LocalFileImport.importTo`，
   集成时（B 已并入 main）把
   `LocalFileImport.importTo = { id, title -> LocalMusicRuntime.importTo(id, title) }`
   放到 `HomePage` 的 `remember` 里即可解锁。另需注意：Lane B 的 `importTo` 依赖
   `LocalMusicRuntime.registerPicker(owner, handler)`，**首页不注册 picker 时会返回 false**，
   此时菜单项应保持可点但给提示，或由集成会话在 `HomePage` 一并注册一个 `OpenDocumentTree`
   launcher。
3. **同步（更新）未移植**：RN `core/syncSourceList` 依赖各源 `songList` 能力与 `sourceListId`，
   原生 `ListStore.UserListInfo` 已有 `source/sourceListId` 字段但无消费方。属独立任务。
4. **`music/searchPlay`、`.js` 音源导入、音频文件打开**：分别依赖跨源搜索、`userapi` 校验链、
   Lane B 的本地曲库，本波不做。
5. **lxmc 没有标准 MIME**：Manifest 只广告了 `content://` + `application/json`。
   要让文件管理器能"用寻音打开 .lxmc"，需要自定义 MIME 类型 + 后缀过滤（Wave6 与 B7 一起做）。
6. **分享图片先落相册再分享**：`EXTRA_STREAM` 目前复用 MediaStore 的 `content://`
   （Manifest 本波只许 intent-filter，加不了 FileProvider）。副作用是"分享"也会在相册留一张图
   （同一预览内已做复用缓解）。Wave6 接 `FileProvider` 后可改成"先写 cache 再分享、相册只在点保存时写"。
7. **`common.shareType` 仍是死键**：它只管文字分享（歌曲/歌单链接），而文字分享原生还没有入口；
   `SettingsPage` 也没有分享小节。等文字分享落地后再补设置项，现在加只会让用户改了没效果。
8. **排序档位里 `add_time` / `play_count`**：`ListStore` 侧无写入方，取值恒 0，排序结果等于原序
   （与 `ListDetailPage` 现状一致，W4 已记遗留，本波未恶化）。
9. **`Item(enabled = false)` 的视觉**：置灰沿用 SaltUI 的禁用配色，真机上要确认对比度是否可读
   （清单第 8 项）。

