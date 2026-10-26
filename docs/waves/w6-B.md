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
