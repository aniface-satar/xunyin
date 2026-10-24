# Kotlin + SaltUI 迁移进度

> 跟踪 `kotlin-saltui-migration-feasibility.md` §七 分批次方案的执行状态。
> 每批一节，含完成项、遗留项、验收边界。

## 批次状态速查（更新于 2026-10-24）

| 批次 | 状态 | 备注 |
|:--:|:--|:--|
| B0 工程骨架 | ✅ 完成 | 本地构建全绿；真机装包抽查待用户 |
| B1 数据与领域层 | ✅ 完成 | lxmc 导入导出数据层闭环；63 用例 |
| B2 播放内核与原生桥 | 🔄 进行中 | 决策层+Media3 平台+crypto+预热+状态同步/通知栏命令+实例接线/失败重试/加载超时/音量均衡已完成（116 + 13 用例全绿）；**B2 代码项收口，剩余真机验收** |
| B3 音源生态 QuickJS | 🔄 进行中 | QuickJS 桥 + 原生 HTTP + 内置源运行时 + 取链 + **更新流全链路（调度/解析/语法闸门/写入回滚/启动检查/updateAlert）** 已完成；剩余真机取链验收、自定义源管理（见下方 B3 节） |
| B4 全屏播控页 | 🔄 进行中 | 首版骨架完成：LRC 解析、歌词加载、模糊封面、封面/歌词翻页、播控与列表 sheet；真机视觉验收与其余弹层待做（见下方 B4 节） |
| B5 主界面与列表 | 🔄 进行中 | 第一切片：ListStore→播放器接线、歌单页、首页列表入口；第二切片：酷我搜索→试听列表→播放；第三切片：新建/重命名/删除/清空列表、单曲移除、搜索结果加入指定歌单；第四切片：设置存储与设置页（音质/歌词开关/音量均衡/加歌位置）；第五切片：首页迷你播放条、歌单多选批量删除/移动、长按拖拽排序；第六切片：三一级 tab/独立详情栈/发现二级 tab 导航壳与搜索一级 tab 嵌入；第七切片：五源搜索核心与全源聚合规则（app 层尚未接线）；第八切片：五源搜索 app 接线（transport/并发/代次/缓存/源选择/翻页 UI）；第九切片：排行榜内容（五源榜单清单 + kw/kg 榜单详情 + 30 条本地分页 + 临时列表起播，tx/wy/mg 详情未接） |
| B6 长尾屏幕与桌面歌词 | ⬜ 未开始 | — |
| B7 收官 | ⬜ 未开始 | — |

**验证基线**：`cd android-native && gradlew.bat ktlintCheck test assembleDebug`
→ 当前应为 `:core` 309 + `:app` 19（合计 328）全绿，APK 27,589,564 B（QuickJS 四 ABI + 9 个内置源脚本）。
> 2026-10-25：Wave1 波前快照前置修复——上一被叫停会话留下的半成品
> `TxLeaderboard.kt`/`WyLeaderboard.kt`/`WyWeapi.kt` 有两处编译错误
> （`size ?: JsonNull` 推断为 `Any`，已包 `JsonPrimitive`）+ ktlintFormat 通过；
> 三源**接线与测试仍未做**，归 Wave1 Lane A 收口。APK 体积随之略增。
ktlint 已升级到 **14.2.0**（12.2.0 在 AGP 9 内建 Kotlin 下只检查 `.kts`，app 的 Kotlin 源码此前实际未被 lint）；
全工程统一为 ktlint official 4 空格缩进（`android-native/.editorconfig`）。

## B4 全屏播控页

**状态：进行中（首版骨架）**（2026-10-24；`:core` 251/251 + `:app` 13/13 全绿，APK ≈ 27.2 MB）

### 已完成（B4 首版）

- [x] **LRC 解析器**（`:core/lyric/LyricParser.kt`，17 用例）：`lrc-file-parser@2.4.2`
      的静态解析语义逐条移植——标签（ti/ar/al/by/offset）、一行多时间戳、同时间戳
      文字并入 `extendedLyrics`、翻译/音译只挂到匹配时间点、`[mm:ss.xxx]` 存在时
      全曲按毫秒解释小数、`[1.00]` 按秒而非分、无小数标签整行丢弃、空白行剔除；
      行号 `indexAt` 对齐库的 `_findCurLineNum`（含插件固定 100ms 与 `[offset:]`）
- [x] **歌词加载**（`PlayerRuntime.observeLyrics`）：当前曲变化时走
      `UserApiRuntime.getLyric` 取 `lyric/tlyric/rlyric`，旧曲结果按 musicKey 丢弃；
      保留原文，翻译/音译开关只重解析不重下载（`refreshLyrics`）
- [x] **播放页骨架**（`app/.../ui/play/`）：
      - 背景：封面模糊 + 压暗渐变；API 31+ 用 `Modifier.blur`（RenderEffect），
        低版本用 32px 小图放大 + `FilterQuality.Low` 近似
      - 封面台 / 歌词台左右翻页（foundation `HorizontalPager` + 页码点）
      - 歌词列：逐帧按播放位置算当前行、自动居中、用户拖动期间不抢滚动、
        点击行 seek；翻译行缩字号跟随
      - 播控：进度条（点按/拖动 seek，拖动中本地预览）、上一首/播放暂停/下一首、
        时间标签、播放模式轮转、译文开关、歌词字号增减
      - 播放列表 sheet：读取 `PlayerRuntime.playerList()`，当前曲高亮、点击切曲
      - 封面直取 `meta.picUrl`（`CoverImageLoader`，内存 LRU 6 张）
- [x] **播放模式状态**：`PlayerState.playMethod` + `toggleNextPlayMethod`（轮转顺序
      对照 RN `MUSIC_TOGGLE_MODE_LIST`，1 用例）；`PlayerRuntime` 把决策读取器指到
      状态本身，保证按钮与切歌逻辑同源
- [x] 首页临时「打开播放页」入口已移除，改由 B5 第五切片的迷你播放条进入播放页
      （B0「进入组件抽查页」已在 B5 第六切片移除）

### 待办（B4 剩余）

- [ ] 真机视觉验收：背景模糊观感、歌词滚动流畅度、翻页/切歌无闪烁（需用户）
- [ ] 播放列表 sheet 接真实列表（依赖 B5 的 `listResolver`）
      → **已于 B5 第一切片接通**（`ListRuntime`，2026-10-24）
- [ ] 其余弹层：分享卡、定时关闭、音质/音量/倍速、更多菜单、歌词设置持久化
- [ ] 封面链路补齐：RN `getPicPath` 的校验/磁盘缓存/失败占位尚未移植
- [ ] 歌词增强：逐字歌词（lxlyric）、繁简转换、歌词搜索换源、工具模式（B6 一起）
- [ ] 播放页与迷你播放条/详情页的共享转场（morph）留到 B5 导航接线后评估

### 续接点（下一会话从这里开始）

**B4 首版骨架完成；B5 第一~九切片已完成（列表读取/歌单页 + 酷我搜索起播 + 列表管理 + 设置存储/设置页 + 迷你播放条/多选批量/拖拽排序 + 首页导航壳 + 五源搜索核心/全源聚合规则 + 五源搜索 app 接线 + 排行榜内容第一批）。
下一步：排行榜 tx/wy/mg 榜单详情 → 推荐内容/在线歌单 → 设置页扩展（自定义源/缓存清理）→ B4 剩余弹层 → B6。**

1. B3 仍欠真机取链/更新流验收；B2 仍欠通知栏/后台存活/缓存清理入口验收；B4 欠视觉验收（均需用户）。
2. B4 弹层可先做纯 UI（音量/倍速直接调 `PlayerRuntime.setVolume/setRate`），
   分享卡与定时关闭分别在 B6/设置层接线后补。
3. B5 接线时保持竖屏约束；音量均衡开启时 `isEnableAudioOffload` 必须置 false。
4. B5 搜索已接线完成（第八切片）：`SearchRuntime` → `SearchCoordinator` 五源并发/聚合；
   真机验收五源取链与聚合翻页手感（尤其 tx/wy 签名请求与 kg/mg 的实际响应）。
5. 排行榜（第九切片）：kw 用 wbd 加密（AES-ECB-PKCS5 + MD5 签名——RN 的
   `ECB_128_NoPadding` 枚举实际映射 Android `Cipher.getInstance("AES")` 即 PKCS5，
   已实证并在测试中锁定）；kg 走 v3 rank API；tx/wy/mg 榜单详情未实现（tx 需 HTML
   period 抓取、wy 需 weapi+musicDetail 链、mg 需 filterMusicInfoList），点击提示未接入。
   排行榜播放走临时列表：`listMusicOverwrite(TEMP)` → `playListById(TEMP)` →
   后台 `getListDetailAll` 补全（对照 RN `Leaderboard.listAction.handlePlay`）。

## B5 主界面与列表

**状态：进行中（第一~九切片完成）**（2026-10-24；`:core` 309/309 + `:app` 19/19 全绿，APK 27,542,810 B）

### 已完成（B5 第一切片）

- [x] **列表运行时**（`app/.../data/ListRuntime.kt`）：DataStore → ShardedKvStore →
      DataRepository → ListStore 单例接线；`ensureLoaded` 用互斥锁保证用户歌单只加载一次
- [x] **播放列表接线**：`PlayerRuntime.listResolver` 改为读取 `ListRuntime.musics(listId)`，
      播放页的列表 sheet / 切歌决策与歌单页共用同一份 ListStore 缓存
- [x] **导航支持参数路由**：`NavStack.Route` 由 enum 改为 sealed interface，
      新增 `ListDetail(listId, title)`（data class 按值相等，回退/去重语义不变；
      第六切片已迁移为 `HomeNavigator.Route.ListDetail`）
- [x] **歌单详情页**（`app/.../ui/list/ListDetailPage.kt`）：读取列表歌曲、当前曲高亮、
      「播放全部」整表起播、点行从所点歌曲起播并进入播放页；空列表有占位文案
- [x] **首页列表入口**：试听列表 / 我的收藏 + 用户自建歌单（ListStore.state 驱动，加载后自动出现）

### 已完成（B5 第二切片：搜索起播）

- [x] **酷我搜索移植**（`core/.../music/search/KwSearch.kt`）：对照 RN
      `musicSearch.js` + `toNewMusicInfo`，输出同形状 MusicInfo（`kw_<rid>`、
      albumName/picUrl/albumId/qualitys/_qualitys）；`SHOW=0` 限流与空结果按 RN 规则重试，
      最多 3 次；HTTP 由调用方注入，解析可在纯 JVM 测
- [x] **真实响应金标测试**（`core/src/test/.../KwSearchTest.kt` + `kw-search.json`）：
      2026-10-24 抓取的「周杰伦」真实响应落盘，锁定 id/时长/封面/音质顺序与大小写
- [x] **搜索运行时**（`app/.../data/SearchRuntime.kt`）：`HttpURLConnection` + UA/超时，
      IO 线程执行；网络错误以异常上抛给 UI
- [x] **搜索页**（`app/.../ui/search/SearchPage.kt`）：输入框 + 搜索按钮、加载/空结果/错误三态；
      点结果 = 写入试听列表（`listMusicAdd`）→ `playListById` → 进播放页
- [x] **明文 HTTP 放行**：`AndroidManifest` 加 `usesCleartextTraffic="true"`，
      与 RN 的 `network_security_config` 对齐（酷我搜索 + 自定义源更新地址都走 HTTP）

### 已完成（B5 第三切片：列表管理）

- [x] **列表管理核心**（`core/.../list/ListStore.kt`）：`normalizeListName`（trim + 100 字符截断）、
      `hasUserListNamed`、`createUserList`（`userlist_<时间戳>`，空名不建）、
      `renameUserList`（内置列表拒绝）——语义对齐 RN `ListNameEdit` / `core/list.ts#createList`
- [x] **核心用例**（`ListStoreTest` +3）：命名规范化、空名拒绝与 id/时间戳落库、改名与内置列表拒绝
- [x] **首页新建列表**：SaltUI `InputDialog` 输入 + 同名时 `YesNoDialog` 二次确认
- [x] **歌单页编辑**：用户歌单「重命名/删除列表」，任意列表「清空」；单曲「移除」无二次确认
      （对齐 RN 单曲移除语义）；删除当前活跃列表时回退到试听列表
- [x] **列表变更同步随机队列**：增删/清空/删除后调用 `PlayerCore.handleListMusicsUpdated`
- [x] **搜索页加入指定歌单**：每条结果「加入」→ 列表选择弹层（试听/收藏/用户歌单），
      重复时 toast「该列表已经有这首歌啦」，否则「添加成功」

### 已完成（B5 第四切片：设置存储与设置页）

- [x] **设置核心**（`core/.../setting/SettingsStore.kt`）：默认表 + 持久层覆盖，
      只接受已知键且按默认值类型解析（布尔/整数/小数/字符串），未知键与 null 忽略；
      `version` 每次写回都对齐 `DefaultSetting.SETTING_VERSION`（对齐 RN 设置合并语义）
- [x] **核心用例**（`SettingsStoreTest` +3）：无存储时取默认值、覆盖值生效且脏数据忽略、
      `set` 跨实例持久化并保持 version
- [x] **设置运行时**（`app/.../data/SettingsRuntime.kt`）：DataStore → ShardedKvStore →
      DataRepository → SettingsStore 进程级单例，与 ListStore 共用 `@setting_v1`
- [x] **播放运行时接线**：`PlayerRuntime` 的音质/歌词翻译/歌词音译/音量均衡开关与档位
      全部改为读设置；启动时先加载设置再按开关挂均衡
- [x] **设置页**（`app/.../ui/settings/SettingsPage.kt`，首页「设置」入口）：
      音质四档选择（128k/320k/flac/flac24bit）、歌词翻译与罗马音开关、音量均衡开关
      + 轻/中/强档位（立即重挂音效，设备不支持时 toast）、加歌位置顶部/底部
- [x] **加歌位置生效**：搜索页「点歌起播」与「加入指定歌单」都按设置写入列表
      （不再固定顶部）
- [x] **歌词开关双向持久化**：播放页与设置页的翻译开关写同一份设置，切页后状态一致

### 已完成（B5 第五切片：迷你播放条与歌单编辑）

- [x] **首页迷你播放条**（`app/.../ui/MiniPlayer.kt`）：订阅 `PlayerRuntime.core.state`，
      显示封面/歌名/歌手 + 播放暂停（Canvas 绘制，无额外图标依赖），点条进入播放页；
      首页底部预留高度，滚动内容不会被遮住
- [x] **歌单多选模式**：列表页「多选」进入编辑态，行点击切换选中、圆形勾选标记
      （Canvas 绘制），支持全选/取消全选与已选数量提示
- [x] **批量删除**：选中后二次确认，一次 `listMusicRemove` 落库并同步随机队列
- [x] **批量移动**：选中后选择目标列表（试听/收藏/用户歌单，排除当前列表），
      走 `listMusicMove`（先删后加，加歌位置遵循设置），完成后 toast 提示
- [x] **长按拖拽排序**：编辑态行尾拖拽手柄（Canvas 三横线），
      `detectDragGesturesAfterLongPress` + LazyColumn 稳定 key 实时让位，
      靠近上下边缘自动滚动；松手用 `listMusicUpdatePosition` 落库
- [ ] **真机验收**：迷你播放条、多选批量、拖拽手感与自动滚动尚未在真机上跑过

### 已完成（B5 第六切片：首页正式版导航壳）

- [x] **三个一级 tab 与独立详情栈**：底部顺序固定为「发现 / 我的 / 搜索」；`HomeNavigator`
      为每个 tab 保存详情栈，切 tab 不清栈，重复选择清空当前栈，根页面 back 返回 false 且不跳回发现
      （`HomeNavigatorTest` 6 用例）
- [x] **发现二级导航壳**：顺序固定为「推荐 / 排行榜 / 歌单」，默认推荐；重复选择底部发现会回到推荐。
      三项当前仅导航与空态入口壳，推荐算法/内容、排行榜及在线歌单数据均未移植
- [x] **我的与歌单详情接线**：保留新建列表、试听列表、我的收藏、用户歌单和设置入口；
      原歌单详情复用 `ListDetailPage` 并改走 `HomeNavigator.Route.ListDetail`
- [x] **搜索成为第三个一级 tab**：直接嵌入现有 `SearchPage`，嵌入态不显示返回按钮；
      保留酷我搜索、写入试听列表起播与加入指定歌单，不再 push 全局搜索详情路由
- [x] **状态与播放条保留**：三个一级页面保持组合状态；设置与全屏播放仍为全局覆盖页，
      返回后保留进入前的 tab/详情状态；迷你播放条在三个一级页面与首页详情页均可见，全屏播放页不显示
- [x] **B0 首页内容清理**：移除版本/颜色 token 调试文案与组件抽查入口；全局 `NavStack`
      仅保留 Home/Settings/PlayDetail，设置不是第四个 tab

### 已完成（B5 第七切片：五源搜索核心与聚合规则）

- [x] **传输中立的搜索模型**（`core/.../music/search/SearchModels.kt`）：
      `SearchRequest`（url/method/headers/body/form）与 `SearchPage`
      （list/total/allPage/limit/source）；core 不依赖 Android 或具体网络库，
      各源注入 `suspend` fetch，解析逻辑可在纯 JVM 测
- [x] **tx 单曲搜索**（`TxSearch.kt`）：RPC body 与 `zzcSign`（SHA1 → 固定索引拼段 →
      20 字节 XOR → Base64 去 `/\\+=` → 小写）；保留 strMediaMid/albumMid/数值 id；
      默认 limit 50，响应不合法最多重试 6 次
- [x] **wy 单曲搜索**（`WySearch.kt`）：eapi batch，MD5 摘要 + AES-128-ECB；
      默认 limit 30，最多 3 次
- [x] **kg 单曲搜索**（`KgSearch.kt`）：`song_search_v2`，保留 hash/各音质 hash/lang；
      默认 limit 30，最多 3 次；Grp 子项按 RN 父 key 去重语义跳过
- [x] **mg 单曲搜索**（`MgSearch.kt`）：`searchAll` + MD5 签名；嵌套 resultList 展平、
      copyrightId 去重、相对图片补全、lrc/mrc/trc 字段；默认 limit 20，
      非 `000000` 立即失败不重试
- [x] **全源聚合**（`SearchAggregator.kt`）：无状态纯规则——`allPage >= page` 过滤、
      RN 同款相似度排序与 `sortInsert` 同分稳定顺序、失败源空页、
      跨页 id 稳定去重、maxPage/total 回退
- [x] **黄金测试与真实响应 fixture**：五源 2026-10-24 公开接口「周杰伦」响应原样落盘；
      签名黄金值（tx zzc、wy eapi 密文、mg MD5）；搜索相关 30 用例
      （kw 11 / tx 4 / wy 4 / kg 4 / mg 4 / 聚合 3）
- [x] **审查修复**：kw 单项缺 `N_MINFO` 改为整页重试；kw 缺/`null` `abslist` 与
      tx 缺 `song.list` 视为合法空页不重试；错误 JSON 类型的 `abslist`
      仍返回 null 触发重试
- [x] **wy 填充方式差异（已实证）**：RN 的 `AES/ECB/NoPadding` 对真实搜索明文
      （195 字节，非 16 字节对齐）会抛 `IllegalBlockSizeException`；公开 eapi
      接受 PKCS#7，因此只在 eapi 调用点用 `AES/ECB/PKCS5Padding`
      （AES 下与 PKCS#7 等价），未改全局 `Crypto` 的既有模式

### 已完成（B5 第八切片：五源搜索 app 接线与分页）

- [x] **搜索编排进 core**（`core/.../search/SearchCoordinator.kt`，8 用例）：
      对照 RN `core/search/music.ts` + `store/search/music/action.ts` 的搜索侧——
      每源一个 `listInfos` 缓存槽（list/total/maxPage/page/key）、
      同 `page__text` key 命中直接复用不发请求、发请求前抢占 key（并发重复提交
      由首个完成者落缓存）、翻页用 `<page>__<keyword>` 后缀匹配判定同关键词累计、
      「全部」五源**并发**（coroutineScope + async，对照 RN `Promise.all(task)`）、
      失败源转 `emptyPage` 继续聚合（对照 RN catch 的 allPage=1 空结果）、
      关键词代次（generation）在返回前校验——旧关键词的迟到响应返回 null 且不落缓存、
      `reachedEnd`（maxPage<=page 到底）与 `clearListInfo` 语义、
      limit 固定 30（RN 各源与 all 的 listInfos 初始值）
- [x] **app 传输层**（`SearchHttpTransport`）：`HttpURLConnection` 执行
      `SearchRequest`（GET/POST/body/form 编码、请求头优先缺省补桌面 UA、
      IO 线程、连接 10s/读 15s 超时）；kw 走纯 GET、其余四源按各自
      `buildRequest` 描述执行
- [x] **SearchRuntime 重组装**：注入 `SearchHttpTransport` + 五个 `:core` 搜索器
      （自带签名与重试）到 `SearchCoordinator`；对外暴露
      `search/reachedEnd/clear` 与源表（`SOURCES`：kw/kg/tx/wy/mg/all 顺序与
      RN `musicSdk/index.js` 一致，展示名对齐 `source_real_*` 文案）
- [x] **搜索页 UI 扩展**（`SearchPage.kt`）：
      - 源选择横滑条（五个单源 + 「聚合搜索」），换源立即按当前关键词重查
        （对照 RN `handleSourceChange` → `loadList`；缓存命中不发请求）
      - 翻页/加载更多：接近列表尾（最后 6 项内）自动取下一页并累计
        （对照 RN OnlineList `onEndReached`），尾部「加载中…」与「到底啦~」
        态（对照 `list_loading`/`list_end` 文案）
      - 迟到响应（`search` 返回 null）直接丢弃不刷列表
- [x] **测试**：`SearchCoordinatorTest` 8 用例（单源缓存复用/翻页累计与
      total 回退/换关键词不串页/全部聚合失败转空页/allPage 过滤/代次丢弃/
      reachedEnd 与 clear/空关键词）
- [ ] **真机验收**：五源实际取数（tx/wy 签名请求、kg/mg 响应）、聚合搜索排序
      观感、翻页加载更多手感、换源即时切换——需用户配合

### 已完成（B5 第九切片：排行榜内容第一批）

- [x] **五源榜单静态清单**（`core/.../leaderboard/Leaderboards*`）：对照 RN
      各源 leaderboard.js 的 boardList 逐项录入（kw 43 / kg 51 / tx 25 / wy 42 /
      mg 18），RN 的 getBoards 已固定为本地清单、这里同样不发请求
- [x] **kw 榜单详情**（`KwLeaderboard.kt`，4 用例）：wbd 加密链——JSON →
      Base64 → AES-128-ECB（实证 RN `AES_MODE.ECB_128_NoPadding='AES'` 在
      Android `Cipher.getInstance("AES")` 下是 ECB/PKCS5Padding，非 NoPadding）
      → Base64 → `data&time&appId&sign`（MD5 大写签名）；响应 percent 解码后
      AES 解密；musiclist 映射对齐 RN filterData（n_minfo 音质 Set 去重 +
      档位升序、artist `&`→`、`、实体解码）；失败重试 3 次
- [x] **kg 榜单详情**（`KgLeaderboard.kt`，4 用例）：`api/v3/rank/song`（rn=100），
      filesize/320filesize/sqfilesize/filesize_high → 128k/320k/flac/flac24bit
      各带 hash；authors[].author_name 拼接歌手；errcode 门禁 + 重试 3 次
- [x] **榜单本地分页**（`BoardPager.kt`，5 用例）：RN `core/leaderboard.ts`
      getListLimit 的纯规则移植——源页 100 条按 30 切展示页、尾段不足 30 且源
      还有下一页时暂存 tempList 与下一源页拼满、展示页缓存命中不重发、
      isRefresh 清缓存、getListDetailAll 拉全整表、去重发生在切分之前
- [x] **ListStore.listMusicOverwrite**（+1 用例）：RN `list_music_overwrite`
      整表覆盖（临时列表/排行榜播放入口），覆盖后旧歌清除、持久层同步
- [x] **LeaderboardRuntime**（app 组装层）：boards/board 查表、每榜一个
      BoardPager、`getListDetail/getListDetailAll/reachedEnd/isDetailSupported`；
      HttpURLConnection 传输（10s/15s 超时、桌面 UA）
- [x] **发现页排行榜面板 + 详情页 UI**：源选择横滑条 + 榜单列表（SaltUI Item）；
      `HomeNavigator.Route.LeaderboardDetail` 路由进详情栈；详情页含
      「播放全部」、30 条展示页接近尾部自动加载、错误重试、前三名序号高亮
- [x] **排行榜播放入口**（对照 RN `Leaderboard.listAction.handlePlay`）：
      点歌/播放全部 → `listMusicOverwrite(TEMP, 当前页)` → `playListById(TEMP)`
      → 进播放页 → 后台 `getListDetailAll` 补全临时列表并同步随机队列
- [ ] tx/wy/mg 榜单详情：tx 需 HTML period 抓取（`c.y.qq.com` 正则）、
      wy 需 weapi + musicDetail 两段链、mg 需 filterMusicInfoList——
      当前点击提示「该源的榜单详情暂未接入」
- [ ] 真机验收：kw wbd 接口实际加解密往返、kg 榜单取数、分页与起播链路

### 待办（B5 剩余）

- [ ] 默认列表的「随机播放/收藏全部」等批量操作与排序菜单
- [ ] 排行榜 tx/wy/mg 榜单详情（第九切片遗留，见上方说明）
- [ ] 推荐算法与内容、在线歌单数据（第六切片仅提供导航/入口空态壳）
- [ ] 设置页继续接：自定义源管理（B3）、缓存清理与缓存大小、倍速/音量偏好、播放进度记忆
- [ ] **首页导航壳真机验收**：三 tab 切换/重复选择、各栈系统返回、设置/播放返回状态保留、
      迷你播放条，以及搜索起播/加入列表尚未在真机上验收
- [ ] **五源搜索真机验收**（第八切片代码完成）：五源取数、聚合排序、翻页加载更多、
      换源即时切换
- [ ] **排行榜真机验收**（第九切片代码完成）：kw 加密链路、kg 取数、分页、起播

## B1 数据与领域层移植

**状态：已完成**（2026-10-24；`:core` 63/63 + `:app` 9/9 全绿，DataStore 接线完成）

### 已完成（B1）

- [x] `:core` 纯 Kotlin JVM 模块（kotlin-jvm 2.4.20 + serialization 插件 +
      kotlinx-serialization-json 1.12.0 + coroutines 1.11.0），独立于 Android 平台
- [x] **主题表生成器迁移**：`theme/` 三件套——createThemes.js/utils.js/colorUtils.js
      的精确 Kotlin 移植，17 个内置主题配置全量录入，黄金测试对照 RN 生成物
      themes.ts 逐值锁死（含 JS 拼接怪癖、parseInt 截断、暗色 c-theme 规则）
- [x] **AsyncStorage 分片编解码 + 存储抽象**：`storage/PartStore.kt`（v1/v2 双格式）、
      `storage/KvStore.kt`（接口 + InMemory 测试实现）、
      `storage/ShardedKvStore.kt`（RN saveData/getData 全协议兼容门面）、
      `storage/StorageKeys.kt`（storageDataPrefix 全表 40+ 键）
- [x] **KvStore 的 DataStore 实现**（app 模块）：`data/DataStoreKvStore.kt`
      （androidx.datastore-preferences 1.3.0）；`:core` 经由 app 依赖接入
- [x] **持久化数据仓库**：`data/DataRepository.kt`（utils/data.ts 核心：设置、
      用户列表含 PC 数字 id ".0" 修复、列表歌曲、歌词、音乐 URL、其他源、
      滚动位置、临时列表元信息）
- [x] **列表状态层（Redux slice → StateFlow/MVI 定调）**：`list/ListStore.kt`
      ——RN list slice（state+action+事件）合并为单 store，StateFlow 驱动，
      Mutex 串行替代事件时序；listManage.ts 全操作移植：
      listDataOverwrite/userListCreate(重复 no-op)/userListsRemove/userListsUpdate/
      userListsUpdatePosition/listMusicAdd(top/bottom 去重)/Remove/Move/
      UpdateInfo/UpdatePosition/Clear
- [x] **.lxmc 备份导入导出**：`backup/BackupManager.kt`——gzip(JSON) 编解码
      + importPlayList 全类型 switch（playList_v2/playList/allData_v2/allData/
      playListPart_v2/playListPart），v1→v2 旧格式自动转换、flac32bit 修复、
      冲突 id 追加时间戳；导出固定 playList_v2
- [x] **设置层**：`setting/DefaultSetting.kt`（80 键默认表+新年皮肤）+
      `setting/SettingMerger.kt`（mergeSetting 算法+compareVer+版本迁移钩子）

### B1 验收对照（评估文档 §七）

- [x] 「单测覆盖核心 reducer/state 迁移」→ **`:core` 63 用例**（主题黄金对照 9、
      分片 6、gzip 3、ShardedKvStore 8、音乐工具 11、设置 8、ListStore 13、
      BackupManager 8）
- [x] 「数据导入（lxmc 备份文件）在原生壳里跑通」→ BackupManagerTest 覆盖：
      导出→导入往返、v1 旧格式转换（kg hash id）、Part 冲突改名、音质修复、
      坏档报错；**文件选择器/确认对话框属 UI 层留 B5 接入**，数据层链路已闭环
- [x] Redux → MVI 映射定调：slice 边界 = Store 边界（ListStore 先行示范，
      B5 的其余 slice 沿用此模式）
- [x] 最终构建：`ktlintCheck` + `test`（72/72）+ `assembleDebug`（20.16 MB）
      全绿；`./gradlew test` 聚合双模块，CI 无需改动

### B1 决策记录

| 决策 | 理由 |
|:--|:--|
| MusicInfo 用 JsonElement 动态模型而非强类型 data class | LX.Music.MusicInfo 的 meta 按源形状多变（kg hash/tx strMediaMid/local filePath），备份导入导出只需结构级操作；与 JS 动态对象行为一致 |
| `:core` 纯 JVM 模块 + KvStore 接口抽象 | 领域逻辑零 Android 依赖，JVM 单测秒级反馈；DataStore 实现留在 app 模块，`:core` 可测可复用（B3 QuickJS 桥直接受益） |
| DataStore 文件独立于 RN AsyncStorage（不共享） | 双版本并行期各管各的存储更安全；B7 收官批做一次性迁移导入（用 ShardedKvStore 兼容层读 RN 分片格式） |
| 黄金值对照法移植主题生成器 | 不抄 4,289 行生成物，移植生成逻辑 + 用 themes.ts 抽值锁等价——生成器改动（B4 主题定制）有测试兜底 |
| ListStore 用 Mutex 串行 + 写穿 | RN 靠全局事件时序保证一致性；StateFlow/MVI 下用锁+同步持久化最直接，B5 大列表时可加节流 |

### 下一批（B2 播放内核与原生桥）

Media3 ExoPlayer + MediaSessionService、rn-track-player 定制对照、
缓存/文件/电池优化等 48 个 Java 文件的等价物拆解。

## B2 播放内核与原生桥

**状态：进行中**（2026-10-24 起；决策层 + Media3 平台 + crypto + cacheTrack 预热 + 状态同步/通知栏命令 + 实例接线/失败重试/加载超时/音量均衡完成，`:core` 111/111 + `:app` 13/13 全绿）

### 已完成（B2）

- [x] **播放决策核心**：`player/PlayerCore.kt`——RN src/core/player
  （player.ts + utils.ts filterList + randomList.ts + prevHistory.ts）的
  切歌编排移植：playNext/playPrev（listLoop wrap、list 保持、random、
  singleLoop；手动切歌对 list/singleLoop/none 按 listLoop 处理）、
  playListById、togglePlay、tempPlayList 优先、playedList 历史回退
  （含临时曲锚点 resolvePrevAnchor、stale 条目清理）、不喜欢过滤、
  随机队列全生命周期（生成/同步/取上下曲回绕/列表增删同步）
- [x] **PlayerPlatform 抽象**：Media3 由 app/android 层实现，`:core`
  决策逻辑全部可 JVM 单测（FakePlatform 注入）；12 用例锁死切歌语义
- [x] **Media3 平台实现**（app 模块）：`player/Media3PlayerPlatform.kt`
  （media3 1.11.1）——对照 rn-track-player fork（LocalPlayback/MusicManager，
  fork 基于 1.8.0）的定制点：LRU 音频缓存（SimpleCache +
  LeastRecentlyUsedCacheEvictor，filesDir/TrackPlayer）、audioOffload 开关
  （AudioOffloadPreferences + gapless 必需）、handleAudioFocus
  （setAudioAttributes 第二参）、C.WAKE_MODE_NONE + 自管 wakeLock、
  CONTENT_TYPE_MUSIC + USAGE_MEDIA、DefaultHttpDataSource（默认超时 +
  跨协议重定向 + 移动 UA，与 fork Track.java 播放路径一致）、
  FLAG_IGNORE_CACHE_ON_ERROR；播放事件回调（Playing/Paused/Ended/Error）
- [x] **播放服务**：`player/PlaybackService.kt`（MediaSessionService，
  manifest 已注册 foregroundServiceType=mediaPlayback + 权限）
- [x] **crypto/ 等价物**（`:core`）：`crypto/Crypto.kt`——RSA.java
  （2048 X509/PKCS8、可配 padding）+ AES.java（CBC/ECB、短 IV 补零 16 字节、
  Base64 串接口）+ SHA1 的精确移植，7 用例（含 RSA/AES 往返、错误密钥空串、
  SHA1 黄金值）；B3 音源脚本加密直接受益
- [x] **下一首预热纯表**（`:core`）：`player/PreloadPlan.kt`——RN
  `src/core/player/preloadPlan.ts` 的逐条移植：60s 解析门限 / 10s 时长下界 /
  3s 反悔窗口 / 8MB head 档 / 缓存装得下前缀才发音频字节；`doneSteps` 集合
  替代 RN 的 Record，16 用例逐条对照 `tests/preload-next-music-plan.mts`
- [x] **缓存预热与缓存管理**：`player/PlayerCache.kt` 接口 +
  `Media3PlayerPlatform` 实现（对照 fork LocalPlayback.java:72-200）：
  `cacheTrack`（复用播放器同一份 SimpleCache、与播放路径同一套请求头
  ——UA 走 setUserAgent、其余进 defaultRequestProperties、maxBytes<=0 →
  C.LENGTH_UNSET、token→CacheWriter 注册表**在调用线程登记**再起 worker、
  读循环结束 token 仍在表内才算成功）、`cancelCacheTrack`、`isCached`、
  `getCacheSize`、`clearCache`；`release()` 先取消在途预热再放缓存
- [x] **应用缓存大小/清理**：`cache/AppCache.kt`（CacheModule.java 等价物）——
  cacheDir + externalCacheDir 求和、清 WebView 库与两个缓存目录；
  设置页入口已建（B5 第四切片），缓存大小/清理入口待接
- [x] **状态同步**：`PlayerPlatform` 增加 `positionMs/durationMs`（未知长度归一化为 0，
  不把 `C.TIME_UNSET` 漏给上层）；`PlayerCore` 增加 `syncProgress/setVolume/setRate/seekTo`；
  `player/PlaybackCoordinator.kt` 移植 RN `player.ts` 事件映射与 `playProgress.ts` 轮询：
  Playing→isPlay=true+立即取一次进度、每 `1000/playRate` ms 再取（息屏停更）、
  Paused→停表、Ended→进度归零+自动下一首、Failed→置暂停并报错
- [x] **通知栏元数据**：`updateMetadata` 支持封面 URL（`setArtworkUri`，
  media3 session 自带 http BitmapLoader）
- [x] **通知栏/耳机键切歌**：`PlaybackCommands` 接口 + `CorePlaybackCommands`
  （转发 PlayerCore）；Media3 侧用 `ForwardingPlayer` 把
  COMMAND_SEEK_TO_NEXT/PREVIOUS 加进可用命令并转发给 PlayerCore
  （media3 1.11 已废弃 `onPlayerCommandRequest`，官方替代即此法）
- [x] **系统设置能力**：`util/SystemSettings.kt`（BatteryOptimizationUtil +
  NotificationPermissionUtil 等价物）——电池优化豁免查询/申请、
  通知权限（含通道 IMPORTANCE_NONE 检查）/跳设置页；设置页已建（B5 第四切片），这两个入口待接
- [x] **实例接线**：`app/.../player/PlayerRuntime.kt`——PlayerCore +
  Media3PlayerPlatform + PlaybackCoordinator + CorePlaybackCommands 组装成
  进程级单例（服务与 UI 共用，避免第二份 ExoPlayer/SimpleCache）；
  `PlaybackService` 改用 runtime 挂 MediaSession；切歌时从状态流同步通知栏
  元数据（name/singer/meta.albumName/meta.picUrl）；通知栏 play/pause 也转给
  PlayerCore（空播放器时重新取链，对照 service.ts RemotePlay/RemotePause）
- [x] **取链失败与重试**（对照 playerEvent.ts:91-118 + player.ts:140-161）：
  播放错误先刷新 URL 两次（计数按曲重置、刷新前 `syncProgress` 保住位置；
  第二次刷新失败或第三次仍错 → 停播并报错）；前台 5 秒后、后台立即
  `playNext(true)`；取链失败（RN setMusicUrl catch）同样 5 秒后自动下一首；
  到点时已停播/已换曲则不再跳
- [x] **加载超时**（对照 playerEvent.ts:17-43）：`PlaybackEvent.LoadStarted`
  （平台 setResource 后发出，不用语义更宽的 media3 STATE_BUFFERING）起
  25 秒计时；同一首第一次超时刷新 URL，第二次超时直接 `playNext(true)`；
  `Playing`/`Ended`/`Failed`/`stop` 清表；换曲清掉「上次超时曲目」
- [x] **音量均衡**（VolumeBalancerModule.java + volumeBalancer.ts 等价物）：
  `app/.../player/VolumeBalancer.kt`——DynamicsProcessing MBC 三档
  （low/mid/high：ratio 2/4/8、threshold -12/-18/-24dB、postGain 0/1/2dB）、
  limiter 只开不改参；`PlayerRuntime` 在 `isPlay` 变 true 时对齐 session
  （NO_SESSION 5×600ms 重试，失败一次提示后本进程不再试）；三档纯参数有
  JVM 单测。audioOffload 互斥规则（RN player.ts:251）留给 B5 设置层接线

### B2 语义修正记录（对照 RN 源码实证）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| `playedList` 仅个性电台经 musicToggled 写入临时曲（radio.ts:151）；普通切歌**不写** playedList | handlePlay 不写 playedList；历史回退读 playedList（B6 电台接入时补写点） |
| `playerPlayIndex` 在 setPlayMusicInfo 时按 getPlayIndex 计算（非播放事件回调） | setPlayMusicInfo 内同步计算（含 playIndex<0 时 playerPlayIndex-1 回退语义） |
| list 模式播完最后一首：playNext 直接 return，**不停播**，当前曲保持 | nextIndex<0 时 return（不 handleToggleStop） |
| addPlayHistory 只写持久化 play_history 存储，与内存 playedList 无关 | 移除二者耦合；持久化播放历史由 B2 后续接入 |
| RSA/AES decrypt 返回**明文串**（非 Base64 回编码） | Crypto 保持同语义（测试期望曾写错，已修） |
| media3 1.11 的 WAKE_MODE 常量在 `C.WAKE_MODE_NONE`（Player 接口已移除，setWakeMode 移至 ExoPlayer.Builder） | javap 实证后使用 C.WAKE_MODE_NONE |
| 刷新 URL 途中若取链本身失败，RN 也直接 5 秒后跳下一首（不会用满两次播放错误重试） | `onLoadFailed` 与播放错误重试分开：取链失败只排「跳下一首」 |
| RN RemotePlay/RemotePause 走 core.play/pause（空播放器会重新取链），不是直接操作播放器 | ForwardingPlayer 覆盖 play()/pause() 转发 PlayerCore |

### 待办（B2 剩余）

- [x] rn-track-player fork 定制对照（cacheTrack 路径已逐行对照；
      LocalPlayback/MusicManager 的其余定制点见上方平台实现清单）
- [x] 原生模块等价物：cache/（AppCache）、utils/ 的电池优化+通知权限（SystemSettings）
- [x] 音量/倍速/进度状态同步 + 通知栏元数据（含封面）
- [x] 实例接线：PlayerRuntime + PlaybackService
- [x] 取链失败重试（对照 player.ts / playerEvent.ts 的失败计数 + 自动跳下一首）
- [x] 加载超时（RN handleLoadstart 25 秒：同曲第二次超时跳下一首，第一次刷新 URL）
- [x] 原生模块等价物：volumeBalancer/（三档 MBC + limiter；audioOffload 由调用方在
      开启均衡时关掉，对照 player.ts:251）；island/ 归 B6
- [ ] 验收：通知栏播放/暂停/切歌、后台播放存活、缓存清理入口

## B3 音源生态 QuickJS

**状态：进行中**（2026-10-24；QuickJS 桥、取链链路、更新流全链路完成，`:core` 264/264 + `:app` 13/13 全绿）

### 已完成（B3）

- [x] **QuickJS 引擎桥**（`app/.../userapi/QuickJsEngine.kt`）：RN `QuickJS.java` +
      `JavaScriptThread.java` 的 Kotlin 移植——独立 HandlerThread、preload 注入、
      `__lx_load_seq__`、key 门禁的 `__lx_native_call__`、六个 native 工具
      （base64 双向/MD5/AES/RSA/setTimeout）、`__run_error__` 收尾、换脚本时
      `stopped` 丢弃旧实例事件；引擎来自 `wang.harlon.quickjs:wrapper-android:2.4.0`
      （与 RN 同一个包）
- [x] **preload 原样随包**：`assets/script/user-api-preload.js` 与 RN 同一份，
      沙箱限制（eval/Function 禁用、属性冻结、输入长度上限）全部保留
- [x] **内置源资产化**：`tools/export-builtin-sources.mjs` 从 RN
      `src/config/builtinSources/scripts.ts` 导出 9 个脚本 + `manifest.json`
      （id/名称/版本/更新地址）；脚本零改动，运行在 QuickJS 里
- [x] **原生 HTTP 执行器**（`UserApiHttp.kt`）：对照 RN `init/userApi/request.js`——
      默认 UA/Accept、自定义头、body/form 编码、13s 默认超时、响应 JSON.parse、
      取消/abort、状态码与响应头透传
- [x] **音源运行时**（`UserApiRuntime.kt`）：对照 RN `init/userApi/index.ts` 的音源侧——
      init 事件解析 `sources[source].actions/qualitys`、requestKey→Deferred、
      20s 请求超时、`request/cancelRequest/response/log/showUpdateAlert` 路由、
      默认源 `builtin_xinghai`（与 RN defaultSetting 一致）
- [x] **取链接线**：`PlayerRuntime.urlResolver` 改为走 `userApi.getMusicUrl`；
      `:core` 新增 `PlayQuality`（RN `getPlayQuality` 的 flac24bit→flac→320k→128k
      降级，5 用例）
- [x] **crypto 补丁**：RSA 公钥允许 PEM 换行（对齐 RN Android `Base64.DEFAULT`）
- [x] **更新流纯规则**（`:core/userapi/`，对照 RN `src/core/userApiUpdate` 可测部分）：
      `VersionCompare`（点/横线/下划线混合分隔、`MAX_SAFE_INTEGER`、无法解析返回 null）、
      `UpdateAlerts`（自动更新与弹窗两个开关组合出的 Silent/Toast/Confirm/Tip 决策表）、
      `VerifyLoad`（更新后的验证加载不结算全局 init、失败不弹窗）；
      共 24 个 JVM 用例逐条对齐 RN 的 `user-api-update-*` 测试
- [x] **更新地址调度**（`:core/userapi/UpdateSchedule.kt`，19 用例）：检查频率
      （每次启动/每天/每周/关闭、时间回拨放行）、jsDelivr 三镜像与 GitHub raw→
      jsDelivr 展开、用户地址 > 脚本上报 > 头部地址的优先级、目录备用线路、
      本地源只试脚本地址、名字不匹配地址拉黑；逐条对齐 RN
      `user-api-update-schedule.mts`
- [x] **更新预览编排**（`:core/userapi/UpdateCheck.kt`，12 用例）：多地址顺序尝试、
      确认可升级即停、主地址全失败才走备用线路、`no_update` 归「已最新」、
      只给版本号的网页归「手动打开」、语法闸门注入；逐条对齐 RN
      `previewUserApiUpdateOnce`
- [x] **更新执行层（app 侧）**：
      `UserApiSourceStore.kt`（KvStore 优先、assets 兜底；脚本/备份/头部/用户地址/
      拉黑/待验证/上次检查时间七个键）、`NativeScriptFetcher.kt`（桌面 Chrome UA、
      不取缓存、15s 超时）、`QuickJsSyntaxChecker.kt`（QuickJS 只编译不执行，
      独立线程 + 20s 超时）、`UserApiUpdater.kt`（全入口 Mutex 串行、预览→落盘→
      验证加载→失败回滚、非当前源写 `verifyPending`、启动检查、`showUpdateAlert`
      接两个开关）；`UserApiRuntime.setSource(verify)` 区分验证加载，
      普通加载遇到 `verifyPending` 先回滚再重试一次；`PlayerRuntime` 启动时
      等默认源就绪后跑首次检查
- [x] **内置源清单扩展**：导出器补 `scriptUpdateUrl / legacyUpdateUrls /
      fallbackUpdateUrls / checkUpdateUrls / autoCheck`，manifest 已重新生成

### 已知差异（收尾前确认是否需要补）

- `formData`（multipart）未实现，脚本用到会直接报错；内置 9 源未使用
- binary 响应给 Base64 字符串（RN 给 Buffer）；内置源取链均为文本响应
- 自定义源尚未接入存储/列表（目前 `UserApiSourceStore` 只读内置源清单）
- 更新检查的设置（频率/自动更新/弹窗）暂用 RN defaultSetting 默认值
  （每天、开、关），设置页接线时替换 `UserApiRuntime.updaterSettings`

### 待办（B3）

- [ ] 真机验收：2–3 个内置源 init 成功并取到可播直链（需用户配合；
      当前没有列表 UI，可用 B5 前的临时入口或原生日志触发）
- [x] 音源更新流执行层：地址解析、语法闸门、写入存储与失败回滚、
      `updateAlert` 事件接到两个全局开关
- [ ] 真机验收更新流：启动检查、脚本上报新版本、镜像回退、语法闸门拒绝、
      验证失败回滚（看 `UserApiUpdate` 日志与 `userapi.*` 键）
- [ ] 自定义源导入/管理（列表、启停、更新地址编辑、日志页）
- [ ] 真机播放链路：取链 → ExoPlayer 播放/暂停/切歌（依赖上面第一条）

### 续接点（下一会话从这里开始）

**B3 更新流执行层已完成（调度/解析/语法闸门/写入回滚/启动检查/updateAlert）。
下一步：自定义源管理（列表、启停、更新地址编辑、日志页）→ 真机取链与更新验收 → B4。**

1. **真机验收清单**（需要用户配合）：
   - 装 debug APK，触发一次播放/取链，看日志 `UserApi [builtin_xinghai]`
     是否 init 成功、`request` 是否返回 URL；
   - 等启动检查跑完，看 `UserApiUpdate` 日志与 KvStore 的 `userapi.lastCheckAt.*`；
   - 用一个脚本上报 `showUpdateAlert` 的源验证自动更新/弹窗开关组合；
   - 通知栏播放/暂停/切歌、后台存活（锁屏 5 分钟）；
   - 缓存清理入口与 AppCache 数值（设置页已建，入口待接）；
   - 音量均衡：设置页可直接开关与换档，验证轻/中/强三档与释放。
2. **B3 剩余**：自定义源导入属于 B5 设置页，可一起接；接入时把源清单从
   `BuiltinSourceRepository` 抽象成可写目录，并让 `UserApiSourceStore` 的
   `list/find/scriptOf` 走同一份数据。
3. **B5 接线时的两条约束**：
   - 音量均衡开启时 `isEnableAudioOffload` 必须置 false（RN player.ts:251）；
   - `PlayerRuntime.setVolumeBalancer(enabled, level)` / `onVolumeBalancerFailed`
     / `setVolume/setRate` 是设置层的入口。

**验证基线**（每次续接后先跑）：
```bash
cd android-native
gradlew.bat ktlintCheck test assembleDebug   # 当前应为 :core 309 + :app 19 全绿，APK 27,542,810 B
```

**全局待办提醒**：真机装包抽查（B0/B2 验收的硬性项，需用户配合）、
CI 首跑（push dev 后）、release 签名密钥决策（沿用现 keystore 还是新建，B1 前定）。

## B0 工程骨架

**状态：本地构建全绿，待真机验收**（2026-10-24）

### 已完成

- [x] 工具链定版并逐一验证镜像可拉取。**注意：最终版本与初版计划不同**——
      SaltUI 3.0.0-beta03 的传递依赖（haze 2.0.1 / androidx.compose 1.12.1 /
      core 1.19.1）AAR metadata 硬性要求 compileSdk ≥ 37 且 AGP ≥ 9.1.0：
      - Gradle **9.3.1**（原计划 8.14.3，AGP 9 要求）
      - AGP **9.1.1**（原计划 8.13.2；9.1.1 为满足元数据的最低稳定版）
      - Kotlin 2.4.20 + compose 插件 2.4.20（不变）
      - compileSdk **37** / targetSdk 36（原计划 compileSdk 36）
      - android-37.0 平台已装入本机 SDK
- [x] SaltUI 公共 API 一手核实（官方 sources jar）：SaltTheme/SaltConfigs/Button/Text/
      ItemSlider/Switcher/Item 全家族/BasicScreen 签名，骨架页代码一次写对。
      **实证 SaltUI `Slider` 为 internal**，公开入口是 `ItemSlider`。
- [x] `android-native/` 工程落盘：settings（Central 前置 + 镜像兜底）、版本目录、
      app 模块、manifest（竖屏）、资源（自适应图标/主题/strings）、MainActivity、
      MusicApp、NavStack、HomePage、ComponentsPage
- [x] NavStack 9 用例单测全通过（对齐 SaltNavigator 语义）
- [x] AGP 9 内建 Kotlin 适配：移除 `org.jetbrains.kotlin.android` 插件
      （AGP 9.0+ 禁用，内建 Kotlin 支撑），保留 compose 编译器插件
- [x] SaltUI Compose 依赖不传递的适配：app 模块显式声明 androidx.compose
      foundation/ui/runtime 1.12.1
- [x] CI workflow（`.github/workflows/native-build.yml`）：JDK 21，test + ktlintCheck +
      assembleDebug + assembleRelease + artifact，`paths: android-native/**`
- [x] hiddenapibypass 坑落实：`dependenciesInfo.includeInApk/Bundle = false`
- [x] ktlint 接入（`org.jlleitschuh.gradle.ktlint` 12.2.0 + ktlint 1.5.0），
      marker 组名核实为 `org.jlleitschuh.gradle.ktlint`；`ktlintFormat` 已跑
- [x] **本地构建全绿**：`test ktlintCheck assembleDebug assembleRelease`
      - 测试：NavStackTest 9/9 通过
      - debug APK：`app-debug.apk` 16.1 MB
      - release APK：`app-release-unsigned.apk` 12.0 MB（未签名，R8 未启用）

### 待办（本批收尾）

- [ ] 真机装包 + SaltUI 组件渲染抽查（Button/Text/ItemSlider/ItemSwitcher/Switcher/
      BasicScreen + 深浅色联动）——需真机，用户执行
- [ ] CI 首跑绿（push 后自动验证）

### 决策记录（影响后续批次）

| 决策 | 理由 |
|:--|:--|
| AGP 9.1.1 + Gradle 9.3.1 + compileSdk 37 | SaltUI 传递依赖 AAR metadata 硬性要求；AGP 9.1.1 为最低满足版本，减少 API 漂移面 |
| AGP 9 内建 Kotlin，不应用 kotlin-android 插件 | AGP 9.0 起强制；Kotlin 2.4.20 由 SaltUI 对齐要求保持 |
| 不接 `salt-ui-navigation`，自写 NavStack | 其依赖 navigation3 alpha + kotlinx-serialization；NavStack 接口对齐 SaltNavigator，B5 评估换回 |
| applicationId `cn.toside.music.mobile.native` | 与 RN 版双装并存，服务 B7 双通道并行 |
| release 不启 R8、暂不签名 | beta 库混淆规则 B7 补齐；签名密钥待用户决策（沿用现 keystore 或新建） |
| Maven Central 前置的仓库顺序 | SaltUI 根 jar 在阿里云镜像缺失（KMP 元数据包装），Central 必须能兜底 |
| minSdk 26 / targetSdk 36 | 文档 B0 要求 / targetSdk 36 保持与 RN 版一致 |

### B0 构建期实证发现（后续批次必读）

1. AGP 9.0+ 禁用 `org.jetbrains.kotlin.android` 插件（内建 Kotlin/Iskra）。
2. SaltUI 3.0.0-beta03 传递依赖要求 compileSdk ≥ 37、AGP ≥ 9.1.0——评估文档 §五
   “Compose 1.12 + KMP 对 Windows 构建环境要求高”已实证，且比预估更严。
3. SaltUI 的 Compose 依赖（implementation）不向下游传递，直接 import 的库要显式声明。
4. SaltUI `Slider` 是 internal；公开 API 为 `ItemSlider`。
5. 阿里云镜像缺 SaltUI 根 jar，依赖解析必须 Central 前置。

### 下一批（B1 数据与领域层移植）

映射表见评估文档 §七 B1：Redux store → StateFlow/MVI、AsyncStorage → DataStore、
musicSdk → Ktor、theme 表生成器双目标输出。Redux slice 边界 = ViewModel 边界的映射需在 B1 一次性定调。

## Wave 并行机制记录（2026-10-24 深夜会话）

**状态：已中止（用户叫停）；未做任何代码改动，本节是纯流程记录。**

- **本会话做了什么**：为 Wave 1 三车道并行（S1 搜索聚合 / S5 设置扩展+自定义源 /
  S10 桌面歌词）做启动准备——写好四份 `docs/waves/` 协作文件（RULES.md 通用规则 +
  w1-A/B/C 三份任务书），跑了两次主仓库基线构建（21:28 一次绿、23:29 一次**失败**），
  搭建期间同时存在另一会话在主仓库推进 B5 第八/九切片。**未创建任何 worktree、
  分支或提交；无代码改动。**
- **教训 1——`gradlew test` 失败≠基线坏**：23:29 的 `BUILD FAILED in 24s` 并非基线
  问题——当时排行榜会话正在主仓库工作区写 `WyWeapi.kt`/`TxLeaderboard.kt`/
  `WyLeaderboard.kt`，构建撞上在途半成品文件。它自己 23:09 的完整跑是
  `:core` 309 + `:app` 19 全绿（测试 XML 与 APK 时间戳 23:09:29/23:09:33 为证）。
  **并行会话共享同一主仓库工作区时，`test` 不可能稳定**——这是同目录并行的
  又一实证（此前仅理论推演），worktree 隔离不是可选项，是硬前提。
- **教训 2——任务书会过期**：w1-A 任务书（S1 搜索聚合）写于排行榜会话开工前，
  几小时后它的第八切片恰好把 S1 做完了。**lane 任务书必须在波前快照提交之后、
  从快照状态重写**，不能提前几天预写后直接用。
- **教训 3——并行前必须做撞文件审计**：本次幸而发现及时（grep SearchRuntime 发现
  五源已接线），否则 Lane A 会话会拿着过期任务书把已有实现重写一遍。
- **后续重启波次时**：① 先确认无其他会话在主仓库工作；② 波前快照提交后重写任务书
  （S1 已完成 → Lane A 改派 S4 B5 收尾）；③ 三份任务书 + RULES.md 已就位，可复用，
  只需按快照状态修订任务段；④ 严格执行「快照 → 切 worktree → lane 会话自检 →
  集成」顺序，lane 会话开工自检里的基线跑在各自 worktree 内进行，不再共享主仓库。
- **对文档的约束**：本节内容并入文档后，`docs/waves/` 下四份文件保留作业参考；
  波次正式重启时按上条修订。
