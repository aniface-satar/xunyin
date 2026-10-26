# Wave 6 · Lane B 任务书 —— 搜索「专辑 / 歌手」两类（五源）

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（Wave5 遗留 W5-15）与本文全文。
> 分支 `w6/laneB`，车道起点 = `main` 的 `1a837fd`（core 883 + app 111 = 994 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | 原生搜索只有两类：`core/music/search/` 16 文件 = 五源音乐搜索 5 + 五源歌单搜索 5 + 4 个编排/模型 | 目录实测 |
| 2 | RN 是四类：`music` / `songlist` / `album` / `artist` | `src/screens/Home/Views/Search/SearchTypeSelector.tsx:15` 附近 |
| 3 | RN **五源都有**专辑与歌手模块，能力对齐 | `src/utils/musicSdk/{kw,kg,tx,wy,mg}/album.js` 与 `artist.js` 全部存在 |
| 4 | 每源 `album`：`search(text,page,limit)` / `getAlbumInfo(id)` / `getAlbumDetail(id,page)` | 五源逐个数过（kg 叫 `getAlbumDetail(id,page,limit)`，mg/tx/wy 同义） |
| 5 | 每源 `artist`：`search(text,page,limit)` / `getDetail(id)` / `getSongs(id,page,limit,sort)` / `getAlbums(id,page,limit)` | 同上 |
| 6 | RN 有统一归一化器，字段差异集中在这两个文件 | `src/utils/musicSdk/albumNormalizers.ts`、`artistNormalizers.ts` |
| 7 | RN 的搜索结果状态按源存：`limit` 专辑 15 / 歌手 18，`sources` 只收「该源有 `artist.search`」的源 | `src/store/search/artist/state.ts`、`album/state.ts` |
| 8 | 原生搜索编排已有成熟范式（transport / 并发 / 代次 / 缓存 / 分页 / 源选择）可照抄 | `core/.../search/SearchCoordinator.kt` + `SearchAggregator.kt` + `SonglistSearchCoordinator.kt` |
| 9 | app 侧 `SearchRuntime` 目前只有 `search/reachedEnd/clear` 三件套，`SOURCES` 是源清单 | `app/.../data/SearchRuntime.kt:22-100` |
| 10 | app 侧搜索界面**只有一个文件**（`ui/search/SearchPage.kt`），没有类型 tab、没有专辑/歌手详情页 | 目录实测 |

**起草结论**：这是一条**自包含**车道（只碰 `core/music/search/` 与 `ui/search/` + `SearchRuntime`），
与 A/C 零重叠。风险点不是"能不能写"，是**五源字段差异**与**分页/总量语义**，
所以任务 1 必须先出映射表，别一上来写解析器。

## 1. 任务（分四段，按顺序做，做完哪段算哪段）

### 段 1：语义实证 + 映射表（先文档，后代码）

- 逐源读 `album.js` / `artist.js` 与两个 `*Normalizers.ts`，写出一张
  **字段映射表**：请求地址与参数（分页参数名、`limit` 上限、`total` 从哪来）、响应里
  「列表路径」「id 字段」「名称字段」「封面字段」「歌手/作者字段」「发布时间字段」「歌曲数」。
- 特别要实证的坑（写进报告，不要凭直觉）：
  1. `kw` 的专辑搜索是否带 `filterListDetail`（它会重排/过滤）；
  2. `kg` 的专辑详情 `limit=200` 与「一页装完」的关系；
  3. `tx` 的专辑 id 是 `albumMid` 还是数字 `albumId`（两者都在用）；
  4. `wy` 的歌手/专辑是否走 `eapiRequest`（加密体），原生有没有现成等价（`SonglistSearch`/`WySearch` 里已有的请求构造要复用，**不要新写一套加密**）；
  5. `mg` 的 `getSongs(id,page,limit)` 没有 `sort` 参数 —— 与其余四源签名不同，别强行统一。
- 结论落到 `core/.../search/AlbumSearchModels.kt` / `ArtistSearchModels.kt` 的字段命名上（见段 2）。

### 段 2：`:core` 纯解析 + 编排（可测优先）

- 新增 `core/music/search/album/`：`KwAlbumSearch` / `KgAlbumSearch` / `TxAlbumSearch` /
  `WyAlbumSearch` / `MgAlbumSearch`，每个只做两件事：**构造请求** + **解析响应为模型**
  （与既有 `KwSearch` 等同样式：纯函数，输入是 `String` 响应体，输出模型 + 下一页判断）。
- 新增 `core/music/search/artist/`：同五源，方法 `search` / `detail`（歌手信息 + 热歌第一页）
  / `albums`。
- 模型建议（名字可调，形状照 RN）：
  - `AlbumItem(id, name, singer, picUrl, publishTime, songCount, source)`
  - `ArtistItem(id, name, picUrl, alias, albumCount, musicCount, source)`
  - `AlbumDetail(info: AlbumItem, songs: List<JsonObject>, total: Int, page: Int, limit: Int)`
  - `ArtistDetail(info: ArtistItem, songs: List<JsonObject>, albums: List<AlbumItem>)`
  - 歌曲一律复用现有 `JsonObject` 音乐项形状（**不要**再造一套歌曲模型，`SearchModels` 的
    `JsonObject` 约定是既有生态，列表→播放链路直接吃它）。
- 编排：`AlbumSearchCoordinator` / `ArtistSearchCoordinator`（照抄 `SonglistSearchCoordinator` 的
  响应代次 / 缓存 / 分页 / 全源聚合规则；`all` 源与单源行为与 RN 一致，特别核实 RN 的
  `all` 源是否真的并发拉五源、结果如何排序）。
- 测试：每个解析器至少 3 条（正常响应 / 空列表 / 字段缺失或异常），用**真实响应落盘 fixture**；
  若拿不到真实响应，就用「按 RN 解析代码构造的最小响应」并在报告里注明是构造的。
  分页与 `total` 语义各源不同，要各写一条用例钉住。

### 段 3：app 侧接线

- `SearchRuntime` 增加类型维度（音乐 / 歌单 / 专辑 / 歌手），复用既有 transport 与代次逻辑；
  新增源能力判断（`sources` 只收真有该能力的源，照 RN `music[source].artist?.search` 的写法）。
- `ui/search/SearchPage.kt` 增加四个类型 tab（**竖屏**，不新增横屏分支），结果列表分类型渲染：
  专辑行（封面 + 名称 + 歌手 + 发行时间）、歌手行（头像 + 名称 + 别名/作品数）。
  点击行为：专辑 → 专辑详情；歌手 → 歌手详情；专辑里的歌 → 加入试听列表并起播（复用既有链路）。
- 新增 `ui/search/AlbumDetailPage.kt`、`ui/search/ArtistDetailPage.kt`（歌手页含「热门歌曲 /
  专辑」两个分区；专辑页 = 曲目列表 + 「播放全部」）。
  页面挂载方式照抄既有详情页（`HomeNavigator` 的细节栈）；**不许改 `HomePage` 的导航壳结构**
  （若确实必须加一条路由，先看 `HomeNavigator` 有没有现成的 detail 路由工厂，优先复用）。

### 段 4：收口

- 全部新文件 ktlint 干净、核心逻辑有 JVM 用例、app 侧至少覆盖「类型 tab 的状态与置灰规则」
  这类可测纯逻辑（渲染不用测）。

## 2. 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/music/search/**`（新增 album/artist 子包 + 编排）
- `android-native/core/src/test/.../core/music/search/**`
- `android-native/app/.../data/SearchRuntime.kt`
- `android-native/app/.../ui/search/**`（`SearchPage.kt` 改 + 两张详情页新增）
- `android-native/app/src/test/.../ui/search/**`（新增纯逻辑用例）
- 若必须挂路由：`app/.../HomeNavigator.kt` 只允许**新增** detail 路由常量与工厂方法

## 3. 禁触

- `core/recommend/**`、`app/.../data/RadioRuntime.kt`（Lane A 范围）
- `app/.../data/LocalMusicRuntime.kt`、`player/**`、`ui/share/**`、`AndroidManifest.xml`（Lane C 范围）
- `ui/HomePage.kt`、`MainActivity.kt`、`gradle/` 与版本目录、`.github/`
- `userapi/**`（音源脚本链）、`core/setting/**`、`ui/settings/**`
- 既有 `core/music/search/` 五个音乐解析器与五个歌单解析器的**语义**不许改（可以抽公共工具，
  但不许动它们的输出字段）

## 4. 验收

- `ktlintCheck test assembleDebug` 全绿；
- 报告含：**五源专辑/歌手字段映射表**、各源分页与 `total` 语义、`all` 源聚合规则实证结论、
  新增文件的解析器覆盖矩阵（源 × 方法 × 用例数）、app 侧交互说明、真机清单；
- 真机清单至少覆盖：五源各搜一次专辑名/歌手名、翻页到底、点进专辑详情能播放、
  歌手页热歌与专辑分区、空结果与网络失败提示、**竖屏**、搜索结果加入试听列表后
  返回搜索页状态不丢。

## 5. 边界说明（写在报告里，别偷偷降级）

- 本车道**不实现**「歌手详情的相似歌手/粉丝数」等 RN 未必有的字段，也不做本地数据库缓存。
- `.lxmc`/备份/同步与搜索无关，一个字不许碰（Wave7）。
- 若五源某个 `artist` 实现实际不可用（比如 `wy` 需要额外鉴权、实测 403），**允许只做四源**
  并在报告里逐源标注「可用/不可用 + 证据」。宁可四源准，不要五源假。

## Lane 报告（2026-10-26）

- **结论**：完成（段 1~4 全部落地）。专辑 = 五源搜索+详情；歌手 = 四源（tx 实测缺席），
  kw/kg/wy 有详情（热歌+专辑），mg 仅搜索；app 侧四类型 tab + 专辑/歌手详情页 + 置灰规则。
- **commit**：`943488c`（解析器修齐）→ `79d0f48`（core 黄金测试+编排用例）→ `e242f28`（app 侧接线）
  → 最终 `W6-laneB: 搜索专辑歌手（core 954 + app 117 全绿）`；测试数 **core 954（883+71）+ app 117（111+6）全绿**，
  闸门 `ktlintCheck test assembleDebug` 全绿，APK 29,013,789 B（基线 28,925,062 B）。
- **触碰文件清单**：
  - core 新增：`music/search/SearchDetailSupport.kt`；`music/search/album/`（AlbumSearchModels、AlbumSearchAggregator、AlbumSearchCoordinator、Kw/Kg/Tx/Wy/Mg AlbumSearch）；`music/search/artist/`（ArtistSearchModels、ArtistSearchAggregator、ArtistSearchCoordinator、Kw/Kg/Wy/Mg ArtistSearch）
  - core 测试新增：`music/search/SearchTestJson.kt` + `album/` 7 个测试 + `artist/` 6 个测试
  - app 改动：`data/SearchRuntime.kt`（追加 SearchTypes / AlbumSearchRuntime / ArtistSearchRuntime 三个 object）；`ui/search/SearchPage.kt`（四类型 tab + 专辑/歌手结果 + 置灰）；新增 `ui/search/AlbumDetailPage.kt`、`ui/search/ArtistDetailPage.kt`；`ui/search/SearchTypeRulesTest.kt`（app 新用例）
  - **未触碰**：HomeNavigator.kt、HomePage.kt、既有五源单曲/歌单解析器、Manifest、gradle、recommend/RadioRuntime/LocalMusicRuntime/player/ui/share
- **语义修正与实证发现**：
  1. **RN 快照五源都没有 `artist.js`**（任务书 §0 第 3/5 条与实际不符）：`src/utils/musicSdk/{kw,kg,tx,wy,mg}/` 逐目录实测只有 `album.js` 无 `artist.js`，`albumNormalizers.ts/artistNormalizers.ts` 也不存在。歌手模块全部为按任务书模型 + 真实响应 fixture 的重构。
  2. **tx 歌手实测不可用，歌手走四源**：①RN 无 tx/artist.js；②用 node 复刻 `zzcSign`（sha1+置乱表，与 TxSearch.kt 同参数）实测 `u.y.qq.com/cgi-bin/musics.fcg` 综合搜索（search_type=0，remoteplace txt.newclient.top / solosinger 变体、含 grp 去除变体），`body.singer.list` 恒为空（album fixture 同样 singer 分区 0）；③旧 web 端 `c.y.qq.com/soso/fcgi-bin/client_search_cp?t=8` 返回 HTTP 500。按「宁可四源准」只做 kw/kg/wy/mg。
  3. **五源专辑/歌手字段映射表**（请求 → 列表路径 → 字段）：
     | 源 | 专辑搜索 | 专辑列表 | id/名称/歌手/封面/时间/歌曲数 | 专辑详情 | total |
     |:--|:--|:--|:--|:--|:--|
     | kw | `search.kuwo.cn/r.s ft=album`（`albumlist`） | albumid/name/artist/img·hts_img/pub/musiccnt | `r.s stype=albuminfo` 一次 rn=1000 | **无 TOTAL**，整页→page+1 启发式 | |
     | kg | `mobiles.kugou.com api/v3/search/album` | `data.info[]` albumid/albumname/singername/imgurl({size}→240)/publishtime/songcount | `api/v3/album/song`(pagesize=200) + `gateway.kugou.com/v3/album_audio/audio` 批量补全 + `api/v3/album/info` | `data.total`，ceil(total/limit) | |
     | tx | `musicu.fcg DoSearchForQQMusicDesktop`（zzc 签名复用 TxSearch） | `req.data.body.album.list[]` **albumMID 为 id**（数字 albumID 弃用）| `GetAlbumDetail`(albumMid) `req.data.songList[].songInfo` | 专辑区**无 total**，整页启发式；详情 totalNum 一页装完 | |
     | wy | eapi `/api/cloudsearch/pc` type=10（构造复用 WySonglistSearch 同构） | `result.albums[]` id/name/artist.name/picUrl/publishTime(ms→Y-M-D)/size | weapi `weapi/v1/album/{id}`（songs 内嵌 privilege） | `result.albumCount`，ceil | |
     | mg | jadeite `searchAll` searchSwitch album=1（签名同 MgSonglistSearch） | `albumResultData.result[]` id/name/singer/imgItems[0].img/publishDate | `queryAlbumSong` + `MIGUM3.0/resource/album/v2.0`；曲目复用 MgLeaderboard.filterMusicInfoList | `totalCount` 是**字符串**，ceil；详情 limit=total 一页装完 | |
     歌手：kw `r.s ft=artist`（abslist ARTIST/ARTISTID/AARTIST/ALBUMNUM/SONGNUM/PICPATH，TOTAL 有）；kg `api/v3/search/singer`（**data 纯数组无 total**）+ `api/v5/singer/info` + `api/v3/singer/song|album`；wy eapi type=100（`result.artists`/`artistCount`，alias/albumSize/musicSize）+ weapi `v1/artist/{id}` + `artist/albums/{id}`；mg jadeite searchAll singer=1（`singerResultData`，totalCount 字符串）。
  4. **all 源聚合实证**：RN 无专辑/歌手搜索可对照（见发现 1），照 `SonglistSearchAggregator` 的形状实现——五源并发、拼接不去重、`similar(keyword,name)` 排序后 `asReversed()`（等分时顺序翻转，测试按此钉住）、total 取各源最大值、翻页时已翻尽的源（maxPage<page）不再请求（coordinator 测试实证）。
  5. **翻页累积语义**：page≥2 时返回**累积列表**（previous + 当前页），与原版 `SonglistSearchAggregator.all/single` 一致；初期测试误写「只回当前页」，已按原版语义修正测试。
  6. **coordinator 单源分支补写 maxPages**：Artist/Album 两个 coordinator 原先只有 ALL 分支写 `maxPages`，单源翻页后切 all 源时已翻尽的源不会被过滤；两处口径统一（单源分支也写）。
  7. **kw `r.s` 响应容错（album-kw-search.txt 实证）**：真实响应存在三类 artifact——伪 `]` + 逗号（`'],'+','`）、**缺开括号的元素**（`}],'company':''` 直接以键开始）、闭合前尾逗号。整包修复不可行，`kwRsRoot` 退化为逐元素抽取重建（深度扫描 + 缺 `{` 补齐 + 尾逗号/连续逗号清理）。归一化顺序有讲究：先转引号再塌缩，反过来会把 `'],'`+`,'` 变成假键 `","`。
  8. **品质表在 `meta.qualitys`**：新歌曲项沿用既有音乐项形状（qualitys 在 meta 内），测试初期读顶层路径失败后修正（非解析器 bug）。
  9. **测试死锁教训**：coordinator 测试用 CompletableDeferred 门闩挡 ALL 源请求 → 第二次 search 走 ALL 分支 awaitAll 同一被门请求 → runBlocking 单线程死锁（卡 18 分钟）。runBlocking 单线程下**禁止用门闩等自己**，改用 delay + 换单源推进代次（协调会话修复，保留）。
- **解析器覆盖矩阵**（71 条 core 用例；「正常/空/异常」+ 分页/total 语义全部钉住）：
  | 解析器 | search | detail/信息 | 空 | 异常 | 请求构造 | 分页/total 钉子 |
  |:--|:--|:--|:--|:--|:--|:--|
  | KwAlbumSearch | 1 | 1 | 1 | 1 | 1 | 整页启发式 1 |
  | KgAlbumSearch | 1 | 2(info+网关两步链) | 1 | 1 | 1 | ceil(total/limit)+网关分批 1 |
  | TxAlbumSearch | 1 | 1 | — | 1 | 1 | albumMID 寻址+整页启发式 1 |
  | WyAlbumSearch | 1 | 1 | 1 | 1 | 1 | albumCount ceil 1 |
  | MgAlbumSearch | 1 | 2(songs+info)+1(串行 detail) | 1 | 1 | 1 | totalCount 字符串+一页装完 1 |
  | KwArtistSearch | 1 | 2(songs/albums)+1(fallback detail) | 1 | 1 | — | TOTAL ceil 1 |
  | KgArtistSearch | 1 | 2(info+gateway) | — | 1 | — | 纯数组无 total 启发式 1 |
  | WyArtistSearch | 1 | 2(detail+albums) | — | 1 | 1 | artistCount ceil 1 |
  | MgArtistSearch | 1 | —（仅搜索） | 1 | 1 | 1 | totalCount 字符串 1 |
  | Aggregator×2 + Coordinator×2 | | | | | | 21 条（累积/代次/过滤/缓存/reachedEnd） |
- **app 侧交互说明**：SearchPage 四类型 tab（歌曲/歌单/专辑/歌手，SearchTypes.ALL）；源横滑条按类型置灰——歌手类型 tx 灰显不可点（`SearchTypes.enabledSources`），切到歌手时若当前源是 tx 自动回落 kw（`effectiveSource`），`switchSource` 再兜底拒绝禁用源；专辑行（名称/歌手·发行时间·曲数/来源标签）点击进 `AlbumDetailPage`（头部信息+曲目列表+播放全部，曲目点击/播放全部写 TEMP 临时列表起播，复用 SonglistDetailPage 链路）；歌手行（名称/别名·专辑数·歌曲数）点击进 `ArtistDetailPage`（热门歌曲/专辑两分区，专辑行页内再叠专辑详情），mg 行不可点（canOpenDetail=false），tx 源根本不出结果。搜索翻页到底提示「到底啦~」，四类型切换保留关键词自动重查（coordinator 缓存命中不发请求）。
- **真机清单**（至少覆盖任务书 §4）：
  1. 五源各搜一次专辑名（建议「范特西」）与歌手名（建议「周杰伦」），确认 kw/kg/tx/wy/mg 专辑、kw/kg/wy/mg 歌手出结果、all 聚合排序合理；
  2. 歌手类型下 tx 源灰显且点击无效；从 tx 源切到歌手类型自动回落酷我；
  3. 每源翻页到底出现「到底啦~」，all 源翻页不重复请求已翻尽源（观察无卡顿即专线通过）；
  4. 专辑详情：五源各开一次，头部信息完整、曲目可点击起播、「播放全部」从第一首起播；
  5. 歌手详情：kw/kg/wy 热歌与专辑两分区齐全，专辑行可进二级详情；mg 歌手行点击无响应（置灰语义）；
  6. 空结果提示（「没有找到专辑/歌手」）与网络失败提示（详情页错误 + 返回按钮）；
  7. **竖屏**：搜索页与两张详情页全程竖屏、无横屏分支；
  8. 专辑曲目起播后返回搜索页，关键词/结果/滚动位置不丢（页内覆盖返回）。
- **遗留问题与对后续波次的建议**：
  - 路由缺口依旧：SEARCH tab 的专辑/歌手详情沿用页内覆盖（songlist 详情同款），HomeNavigator sealed Route 由 HomePage 穷尽渲染、壳结构禁触；后续若统一路由需 HomePage 配合。
  - kw `r.s` 容错为实测驱动的兜底（发现 7），若后续拿到更多真实响应建议核对逐元素抽取的边界（嵌套对象/字符串内大括号）。
  - tx 歌手若未来拿到可用接口（如专用 singer 搜索模块），可补第五源，`SearchTypes.ARTIST_SOURCES` 一处改动即可。
  - 歌手详情未做相似歌手/粉丝数（RN 本就没有，任务书 §5 明确不做）；专辑封面图未逐行加载（与歌单搜索同口径）。

