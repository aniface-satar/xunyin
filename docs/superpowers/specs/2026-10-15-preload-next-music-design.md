# 下一首预加载（封面 / 歌词 / 背景色 / 音频）+ 动态背景渐变浮现

日期：2026-10-15 · 分支：`feat/music-recognition-phase1` · 状态：待实现（spec 已过自审）

## 1. 要解决的问题

两件事，一个是"提前准备"，一个是"没准备好时怎么出场"：

1. **切到下一首时，封面、歌词、全屏播控页的莫奈背景色、音频都要重新现取**。现状只提前拿了音频直链，
   其余四项都在切歌那一刻才发起，所以切歌后会看到"糊封面慢半拍 → 背景色突然闪出 → 歌词空一秒"。
2. **动态背景晚到时是"闪出"而不是"浮现"**，切歌时也是"闪回主题底再闪回来"。用户口径（同一句话说了两遍）：
   > 如遇网络原因导致动态背景延迟显示，请用一种自然的效果让动态效果浮现，而不是突然闪出，
   > 包括在切下一首歌的时候，背景颜色也要如此变化。

两者的关系要说清楚：**预热把"来不及"的概率压下去，渐变负责剩下的那一次真的来不及**。只做预热，坏网/坏源
那一次仍然会闪；只做渐变，用户每首歌都要等 300ms 的淡入才看到内容，比现在更拖。

## 2. 现有链路（改动前，全部读码确认）

```
播放进度 playProgressChanged
  └─ preloadNextMusic.ts:56-61  剩 <10s 且目标未定 → preloadNextMusicUrl()
        ├─ getNextPlayMusicInfo()                      // 下一首是谁（tempPlayList > 随机 pin > 列表顺序）
        ├─ getMusicUrl()                               // 只拿直链，一个字节都不下
        └─ isCached(url) + checkUrl(url)               // 探活；两者都失败才 isRefresh 重取

切歌那一刻（core/player/player.ts:209-238 debouncePlay）
  ├─ setMusicUrl()      → plugins/player → TrackPlayer.add + skip → ExoPlayer 现联网缓冲
  ├─ getPicPath()       → online.ts:66-83  有 meta.picUrl 就直接返回，否则联网问源，并把结果写回列表
  └─ getLyricInfo()     → online.ts:84-104 先 getCachedLyricInfo(本地)，没有才联网，然后 saveLyric 落盘

背景色（工作区当前状态，未提交）
  CoverBackdrop(PlayDetail/Vertical) / OverlayBackdrop(PlayerOverlay:127-159)
    → useCoverSurface() → coverBackdropStore.updateCoverBackdrop(dynamicBg, hasThemeBgImage, pic)
      → resolveCoverBackdrop(...) 纯表（backdropGate.ts）
      → 要色：getCoverSurface(picUrl, ON_COVER_FONT_CSS)
        → coverPalette 两层内存缓存（像素 LRU 20 / 配色 LRU 60）
          → 未命中才 PaletteModule.getArgbPixels(url)：原生 HttpURLConnection 自己下图（UA 头），不走 Fresco
```

四类资产各自的"焐热"入口本来就存在，这是本次大部分工作只需调用一次的原因：

| 资产 | 播放时的取法 | 预热手段 | 代价 |
|---|---|---|---|
| 封面 URL | `getPicPath` → 命中 `meta.picUrl` | 提前调一次（副作用：写回列表 `meta.picUrl`） | 1 次源 API 请求 |
| 歌词 | `getCachedLyricInfo`（本地盘） | 提前调一次 `getLyricInfo`（副作用：`saveLyric` 落盘） | 1 次联网 + 1 次写盘 |
| 背景色 | `getCoverSurface` 内存 LRU | 提前用**同一个** `ON_COVER_FONT_CSS` 调一次 | 原生队列提前下一次图 |
| 封面字节 | RN `<Image>` + Fresco 磁盘缓存（`force-cache` + UA） | 见 §4.4 | 1 次图下载（几十~几百 KB） |
| 音频字节 | ExoPlayer `SimpleCache`（LRU） | 需新增原生口子，见 §4.5 | 最多 8MB |

## 3. 勘查结论（哪些已确认、哪些还没跑）

**已读码/工具确认：**

1. `Image.prefetch()` 不能用。RN 的 `ImageLoaderModule.java:219` 建请求是
   `ImageRequestBuilder.newBuilderWithSource(uri).build()` —— **不带 headers**，而封面必须有 UA
   （`PaletteModule.java:26` 那句注释与 `Image.tsx:19-21` 的 `defaultHeaders` 是同一件事）。
   所以预取封面要走"带 UA 的请求"这条：要么原生 `prefetchToDiskCache` + headers，要么挂一个真 `<Image>`。
2. Fresco 的磁盘缓存 key 不含视图尺寸。`ReactImageView.java:589-601`：`resizeMethod=auto` 时只有
   `isLocalContentUri / isLocalFileUri` 才 `doResize`；http 封面 → `resizeOptions=null` → key 一致。
   `blurRadius` 是 postprocessor（`ReactImageView.java:222-231, 470-489`），磁盘存的是原始编码字节，
   **预热字节有效，模糊仍在挂载时本地重跑**（所以淡入期间不会出现"色到位了但糊底还没出来"的空档）。
3. 音频缓存不能从 App 侧另开一个实例。javap 确认 media3 1.8.0 有
   `SimpleCache.isCacheFolderLocked(File)`，`LocalPlayback.java:49-53` 已经在 `filesDir/TrackPlayer`
   上持有一份；同目录第二个 `SimpleCache` 会撞实例锁 → **必须复用播放器手里那一份**（补 track-player）。
4. 缓存 key 与 `isCached` 同源：`LocalPlayback.java:72-78` 是 `cache.getCachedSpans(url)`，
   `CacheDataSource` 默认 key 就是 `dataSpec.uri`，两边都按 url 字符串 → 写进去的字节播放时必命中。
5. javap 确认 media3 1.8.0 **没有** `CacheUtil`（只剩 `CacheDataSource` / `CacheDataSource$Factory`），
   但有 public 的 `androidx.media3.datasource.cache.CacheWriter`：
   `CacheWriter(CacheDataSource, DataSpec, byte[], ProgressListener)` + `cache()` + `cancel()`（javap `-constants` 实测）。
   所以"读一遍丢字节、顺手写进缓存"不用自己写读循环，原生补丁只剩装配工作：`CacheDataSource.Factory` 接既有
   `cache` 成员 + 一条后台线程；`cancel()` 正好是"用户已经跳走"那条逃生口。
6. 单位换算链核过：设置 `player.cacheSize = '1024'` → `index.ts:31` `maxCacheSize: cacheSize * 1024`
   → `MusicManager.java:131` `* 1024` → 1024MB。即**默认缓存 1GB LRU**，`'0'` 时 `cache == null`（不缓存、
   预取必须整条禁用）。8MB/首 → 缓存容量上界约 128 首，够用。
7. `ExoPlayback` 只有 `LocalPlayback` 一个子类（grep `extends ExoPlayback` 唯一命中）→ 原生补丁的接口面只有三处：
   `ExoPlayback`（抽象声明）、`LocalPlayback`（实现）、`MusicModule`（`@ReactMethod`）。

**未验证，交给 §6 的探针：**

- 探针 P-1：原生带 UA 的 prefetch 是否与页面渲染那条请求**命中同一条 Fresco 磁盘缓存**（§3.2 只证明了 key
  公式，没证明 `callerContext` 之类不参与）。判不出来就退回"挂 1×1 隐藏 `<Image>`"那条实现，两者用同一套
  `defaultHeaders`，差别只在请求发起者。
- 探针 P-2：`cacheTrack` 写完 `isCached(url)` 是否为真，以及切歌后 `loadstart → playing` 的实测间隔。

## 4. 设计

### 4.1 拆成"纯状态机 + 副作用执行器"

`src/core/init/player/preloadNextMusic.ts` 现在把判据和副作用搅在一起（`if (duration > 10 && duration - nowPlayTime < 10 && !preloadMusicInfo.info)`），
没法进 `node --test`。本次拆两个文件，沿用这仓库把判断抽成纯表的习惯（`backdropGate.ts` / `attemptLedger.ts` 同一类）：

- `src/core/player/preloadPlan.ts`：**无运行时依赖的纯函数**，输入 `(progress, settings, currentTarget, generation)`，
  输出 `next | hold | cancel` 与每一步该不该跑。`node --test` 直接加载。
- `src/core/init/player/preloadNextMusic.ts`：只留订阅、代数号、并发去重与调用四步执行器。

**目标只有一个（下一首），不预焐下两首。** 莫奈那条尤其重要：`coverPalette` 的像素层 LRU 只有 20 条
（`coverPalette.ts:12`，一条是上万数字的数组），预焐两首会把当前这首歌的条目挤掉，反而制造新的取色迟到。

### 4.2 触发时机（比现状提前，并留反悔窗口）

| 步骤 | 触发条件 | 说明 |
|---|---|---|
| 解析下一首 | `maxPlayTime - nowPlayTime <= 60s` 且目标未定 | 一次性解析；`getNextPlayMusicInfo` 在随机模式会 pin `randomNextMusicInfo`，提前问与真播一致 |
| 轻资源三步 | 目标一定 → 立刻 | 便宜、无副作用风险 |
| 音频字节 | 目标一定后延迟 3s，且届时 generation 未变 | 给"连点下一首 / seek 到尾部"一个反悔窗口 |
| 兜底补触发 | 剩余 ≤ 10s 且目标仍未定（例如 seek 直接拖到尾部） | 保留现状那条门限的语义 |

任一时刻用户手动切歌 / `musicToggled` / 播放模式变化 → `generation++`，在途四步各自在写回前比对代数后丢弃；
`cancelCacheTrack()` 让原生那条读循环早点收摊（省流量）。

### 4.3 三步轻资源各自落在哪

1. `getPicPath({ musicInfo, listId })` —— 沿用现有副作用（`online.ts:76-79` 会把 url 写回列表的 `meta.picUrl`）。
   代价要说明白：写回会触发 `updateListMusics` → `myListMusicUpdate` → `watchList` 的节流重算，
   以及列表页一次重渲染。这是既有机制，不是新增风险面，但预热让它的频次从"每首一次"变成"每首一次且更早"。
2. `getLyricInfo({ musicInfo })` —— 走 `handleGetOnlineLyricInfo`，主源拿不到时会**依次试其他源**（这是跨源兜底，
   播放时本来也要付同样的代价，只是现在提前付）。成功后 `saveLyric` 落盘 → 切歌时 `getCachedLyricInfo` 直接命中。
3. `getCoverSurface(picUrl, ON_COVER_FONT_CSS)` —— **只在 `theme.dynamicBg` 为真时才做**，且必须用
   `ON_COVER_FONT_CSS` 这个常量：配色层的 key 是 `picUrl|fontArgb`（`coverPalette.ts:125`），字色对不上就是白下一次图。

**承重细节：预热只焐 `coverPalette` 的缓存，绝不碰 `coverBackdropStore` 的 `attempts` 账本与 `generation`。**
那张账本管的是"这张封面该不该再问原生、什么时候自愈重试"（`attemptLedger.ts` / `coverBackdropStore.ts:85-105`），
预热去动它就是把"时有时无"那个缺陷重写一遍。预热与页面请求在 `coverPalette` 内部按 url 合并 promise，
所以切歌时页面发的 `request()` 读到同一条在途任务，不会往原生那条单线程队列里压第二条。

### 4.4 封面字节预热

首选：在 App 自己的原生模块（不碰 node_modules）加一条 `prefetchImageWithHeaders(url, headers)`，
实现就是 `Fresco.getImagePipeline().prefetchToDiskCache(ReactNetworkImageRequest.fromBuilderWithHeaders(builder, headers), null)`
—— 与页面渲染同一个 `ImagePipeline`、同一套 UA 头（§3.1 的坑正是 RN 自带的 prefetch 不带 headers）。
探针 P-1 判否时退回：`<Image url={nextPicUrl} style={{width:1,height:1,position:'absolute',left:-100}} />`
挂在 Home 根部（`PlayerOverlay` 的兄弟节点），用现成的 `Image.tsx`，`force-cache` + `defaultHeaders` 天然一致。

两条都只在 url 以 `http` 开头时执行；`file://`（下载曲内嵌封面抽出来的文件）本来就是本地读，预热无意义。

### 4.5 音频字节预热（唯一要动依赖的一段）

`dependencies-patch.js` 加三条补丁（该文件已有 20+ 处 track-player 补丁，含 `MusicModule.java`、
`ExoPlayback.java`，模式现成且幂等靠负向前瞻保证）：

- `LocalPlayback.cacheTrack(String url, WritableMap headers, long maxBytes, String token, Promise)`：
  复用成员 `cache`，`new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(httpFactory)`
  → `new DataSpec(uri, 0, maxBytes)` → `CacheWriter(cacheDataSource, dataSpec, buffer, listener).cache()`
  跑在后台线程；取消就调 `CacheWriter.cancel()`（§3.5 实测这条 API 在 1.8.0 是 public 的），
  `maxBytes <= 0` 时传 `C.LENGTH_UNSET`（整首），别用"很大的正数"糊弄 —— 超出资源实际长度会让
  `CacheWriter` 等到 EOF 之外的边界情况。`CacheDataSource` 用完必须 `close()`，否则那条 cache key 一直被锁着。
  headers 与 `Track.java:163-170` 同源（`DefaultHttpDataSource.Factory.setDefaultRequestProperties`），
  否则带 referer 校验的源会 403。
- `LocalPlayback.cancelCacheTrack(String token)`；`ExoPlayback` 加抽象声明；`MusicModule` 加两个 `@ReactMethod`。
- JS 侧 `src/plugins/player/utils.ts` 包一层 `cacheTrack/cancelCacheTrack`，
  `Platform.OS !== 'android' || !NativeModules.MusicModule?.cacheTrack` 时直接 no-op
  （iOS 不碰；补丁没重打时旧包也不会崩，只是这项功能自己熄火）。

默认量：**8MB**（`player.preloadNextMusicAudio: 'off' | 'head' | 'full'`，默认 `'head'`）。
8MB ≈ 320k 下 3 分钟，够"秒开 + 前几分钟不卡"，而用户要不要跳这首歌通常在一分钟内就决定了。
代价说清楚：用户听完的歌本来也要下满，跳过得早的歌会多花最多 8MB。
`player.cacheSize === '0'` 时整条禁用；下载曲 / 本地曲不发。

### 4.6 渐变浮现（对应 §1 第 2 条）

**根因**：`backdropGate.ts:24` 那句 `active = enabled && !!pic && surface != null`。新歌的色还没到手的那一帧，
`surface` 判成 null → `CoverBackdrop` 整层 `return null`（`CoverBackdrop/index.tsx:28`）→ 主题底闪回来；
色到手再挂载 → 闪出去。也就是说"闪"不是动画缺失，是**层在两个状态之间硬卸载**。

**改法（纯表加一支过渡态，动画只负责照着插值）**：

`CoverBackdropState` 增两个字段，决策仍然全在纯函数里（`node --test` 跑得动）：

```
displayed: { picUrl, surface } | null   // 屏幕上正在铺底的那一支（可能是上一首的）
incoming : { picUrl, surface } | null   // 新一首的色已到手、正在淡入
```

判据（`resolveCoverBackdrop` 的扩展，输入不变，输出多两支）：

1. `enabled` 为假（开关关 / 主题自带背景图）→ `displayed = null`，正在淡出的层淡完即卸载。**退场要淡**，
   不然翻开关仍然是闪。
2. 换歌分两种情形，判据不同：

   - **新歌有封面、色还没到手**（`pic` 非空、新 surface 为 null）→ `displayed` **保留上一首那一支**，
     `incoming = null`，且 `wantsSurface` 仍为真。
   - **新歌根本没有封面**（`pic` 为 null 或空串）→ **不给宽限期**，旧层直接走退场淡出。
     这条分界是为了保住既有两条判据不改：`tests/monet-gate.mts:31`「切到没有封面的歌：同一帧就把旧配色交回去，
     不刷一屏旧封面色」与 `:38`「空串 pic 不算有封面」原样成立。

   真正被改写的只有 `tests/monet-gate.mts:44`「配色还没算出来（含取色失败）：surface 交 null，整层不渲染」
   —— 它现在对"有旧层 + 宽限期内"这一分支不再成立（这一支要留旧层铺底）。
   保留旧层之所以不再是 `backdropGate.ts:21` 那句注释担心的"刷一屏旧封面色"，是因为留住的是**带自己 picUrl 的
   完整那一支（糊封面 + 底色 + 蒙版）**，不是把上一首的纯色铺到新一首上 —— 屏上是"背景还没变过来"，
   不是"一屏无关的纯色"。这条改写必须在提交信息里点名，不能靠顺手让旧用例变绿。

   另外一条不许松：宽限期内 `wantsSurface` 必须仍为真。`tests/monet-gate.mts:54` 钉的正是"屏上没开背景层"与
   "该不该去取色"是两件事，凑一起就是死锁；如果因为"先留着旧层"就把请求关掉，等于把 2026-10-15 晚修掉的
   「时有时无」缺陷（见 `attemptLedger.ts` 头注释与 `coverBackdropStore.ts:82-84`）在新实现里重写一遍。
3. 新色到手 → 新层（底色 + 糊封面 + 蒙版整体）以 `opacity 0→1` **叠在旧层之上**；到 1 之后才卸载旧层。
   这是"先叠后撤"而不是两路交叉淡出：两支都是整屏不透明层，交叉淡会让中间帧露出主题底
   （线性 `a=t, b=1-t` 时中点露底 25%），先叠后撤全程无露底。
4. 宽限期 `graceMs = 8000`：新色在 8s 内没到手 → 旧层淡出回主题底，**不能无限期把上一首的色挂在新一首上**。
   8s 这个数不是拍的：原生单次超时是 4s（`coverBackdropStore.ts:83` 记的就是这个量级），取 4s 会把
   "慢但还活着"的请求判成失败，结果就是先淡出、晚到的色再淡入一次 —— 双向变动比一次闪更难看；
   而 8s 仍明显短于 `ATTEMPT_COOLDOWN_MS = 15_000`（`attemptLedger.ts:14`），不会和冷却重试的节拍撞在一起。
   超时之后晚到的结果仍会走一次淡入（`coverBackdropStore.ts:66-76` 那三条守卫不变，只是那时底下是主题底）。
   超时后仍然按现有 `attemptLedger` 的冷却窗口继续重试，重试成功时再走一次淡入（那时是"从主题底淡进来"，路径 3 同一支代码）。
5. 首次进入（没有 `displayed`）→ 纯淡入，下面没有旧层，等价于路径 3 的退化情形。

**前景墨色**：`OnCoverThemeProvider` 继续读 `surface`（现约定：底与字同一份、同一次 publish 一起翻，
`coverBackdropStore.ts:3-5`）。权威 `surface` 跟随 `displayed`，所以宽限期内屏幕上是旧封面 + 旧墨色，
新色到手时底与字一起换 —— 中间帧不会出现"白字压在刚闪出来的亮底上"。可读性不靠赌：
两支 surface 各自都过同一个白字对比度闸门（`surface.ts:28` `ON_COVER_FONT_CSS` + `MIN_CONTRAST 4.5`），
所以叠加淡化的整个过程中白字在底下那一支上都成立。

**动画参数**（与仓库现成写法一致：`Animated.timing` + `useNativeDriver: true`）：
淡入 380ms `Easing.out(Easing.quad)`，淡出 260ms `Easing.in(Easing.quad)`。
实现约束一条（踩过）：`Animated.Interpolation` 节点没有 `.subtract()` 之类算术方法，
需要组合时走 `Animated.add/multiply` 或纯 JS 算好再喂 `useNativeDriver`。

**范围**：只动 `CoverBackdrop`（PlayDetail/Vertical，即全屏播控页的铺底层）。
`PlayerOverlay/index.tsx` 里那份 `OverlayBackdrop`（line 127-159）是反编译产物、自带 morph 动画的淡入路径，
本轮不碰；渐变逻辑留在纯表里，它以后要接就接同一张表。
横屏一行不动（AGENTS.md portrait-only + 既有约定）。

### 4.7 设置项（复用现成组件，不新造 UI）

放"播放设置"里 `MaxCache` 之后（`settings/Player/index.tsx`），两项都用现成件：

- `player.preloadNextMusic`（bool，默认 `true`）→ `CheckBoxItem`，说明文案走"对你有什么用"的口径，
  不解释实现：`切歌前先把下一首的封面、歌词和配色准备好，切过去不用再等`。
- `player.preloadNextMusicAudio`（`'off' | 'head' | 'full'`，默认 `'head'`）→ 与 `PlayHighQuality` 同款选择器，
  文案要点出流量：`提前下载下一首的开头（约 8MB）／整首／不下载`。

两个键进 `defaultSetting.ts` 与 `app_setting.d.ts`，i18n 键按 `setting_play_*` 现有前缀补 zh_cn / zh_tw / en_us。

## 5. 错误处理与边界

| 情形 | 处理 |
|---|---|
| 源 API 失败 / 抛错 | 该步 `catch` 后记失败，不影响其余三步；不重试到下一首（下一首播完自然会再问） |
| 主源拿不到歌词、跨源兜底成功 | 正常（`saveLyric` 写的是真正命中的那份 musicInfo，`online.ts:99-100` 已处理） |
| `getNextPlayMusicInfo()` 返回 null（列表播完 / 无列表） | 整轮不启动 |
| 稍后播放 `tempPlayList[0]` | 照常预热；不因预热调 `resetRandomNextMusicInfo()`（那是播放模式变更的语义） |
| 个性电台 / 串流临时曲 | 目标由 `getNextPlayMusicInfo` 给，行为与普通曲一致 |
| 下载曲（`'progress' in musicInfo`）/ 本地曲（`source === 'local'`） | 不发音频字节预热、不发封面字节 prefetch；歌词/URL 仍走 |
| `player.cacheSize === '0'` | `cacheTrack` 整条禁用（原生侧 `cache == null`） |
| 补丁未重打 / iOS | JS 特性检测 no-op，不抛 |
| 快速连点下一首 | 每步写回前比代数；`cancelCacheTrack(token)` |
| 切歌时取色失败、宽限期内没到手 | 走 §4.6 路径 4：旧层淡出回主题底，`attemptLedger` 的冷却重试仍然有效，重试成功再淡入 |
| 新歌没有封面（`pic` 为 null / 空串） | **不留旧层**，立即走退场淡出（保住 `tests/monet-gate.mts:31/:38`） |
| 色在宽限期之后才晚到 | 底下已是主题底，仍然淡入一次；不重发请求（`coverPalette` 按 url 合并 promise） |
| 8MB 下载中途进程被杀 | 不算正确性风险：写的就是播放本来也会写的同一份缓存。未提交片段具体如何落账，实现时读 `CacheWriter` 源码确认，本 spec 不背书 |

## 6. 测试

**纯函数单测（`node --test`，`package.json` 的 test 脚本追加，总数只增不减）**

- `tests/preload-next-music-plan.mts`：触发档位（60s / 3s 延迟 / 10s 兜底）、目标解析一次不重复、
  手动切歌作废在途、`preloadNextMusic=false` 时四步全不发、`dynamicBg=false` 时**只跳取色那一步**、
  `cacheSize='0'` 只跳音频、本地/下载曲的分支、`tempPlayList` 优先。
- `tests/monet-gate.mts` 增补三条分支：新歌有封面而色没到手 + 有旧层 + 宽限期内 → `displayed` 仍是旧那一支
  且带旧 picUrl；新歌无封面（null / 空串）→ 不留旧层、立即走退场；宽限期内 `wantsSurface` 仍为真。
  唯一被改写的既有判据是 `:44`「配色还没算出来：整层不渲染」（只在新分支上不再成立），
  `:31`、`:38`、`:54` 三条必须原样绿 —— 提交信息里要点名改了 `:44`。

**静态闸门**：`npx tsc --noEmit`（src 基线 107，不许涨）、`npm run lint`（改到的文件零新增告警）、
`cd android && gradlew.bat compileDebugJavaWithJavac`（动 Java 必跑，比整包快得多）。

**真机（vivo，两台备用；release 构建 2–3 分钟 ETA）**

- P-1：预热过封面后切歌，糊底是否还走网络（在 `CoverBackdrop` 临时挂 `onLoad` 计时探针；磁盘命中通常 <30ms，
  网络 >300ms，断网重放同一条 url 应当仍然命中）。
- P-2：`cacheTrack` 后 `isCached(url)` 为真，且切歌 `loadstart → playing` 实测间隔下降。
- 观感复核（这条比指标优先）：① 正常网切歌——底色直接换新、无闪；② 弱网（模拟限速或移动网络）切歌——
  旧色停留 ≤8s（= `graceMs`）后淡回主题底，色到手时淡入浮现，不出现"闪一下"；③ 翻「动态背景」开关——淡出而非硬切。

## 7. 风险与逃生口

1. **原生补丁漂移**：`npm ci` 后忘记重打 → 音频字节这项自己熄火（特性检测），前四项不受影响。补丁靠负向前瞻幂等。
2. **撞 ExoPlayer 的缓存实例**：绝不在 App 侧 `new SimpleCache(filesDir/TrackPlayer)`（§3.3）；
   补丁只在 `LocalPlayback` 内部用既有成员。
3. **带校验的音源 403**：`cacheTrack` 必须带与播放同一套 headers；不带就是白下一趟。
4. **流量**：8MB 档是默认；`'off'` 一键关掉，`'full'` 要用户自己选。
5. **旧色停留的观感争议**：`graceMs = 8000` 是唯一可调数字（依据见 §4.6-4：两次原生 4s 超时的量级）。
   真机若觉得"背景跟着新歌变得太慢"就调小，但调到 4s 以下会把慢请求误判成失败，换来"淡出再淡入"的双向变动；
   调到 15s 以上则与 `ATTEMPT_COOLDOWN_MS` 同量级，看不出是宽限期还是冷却重试。只动纯表入参，不动动画。
6. **预热写回列表的连带渲染**：`getPicPath` 会 `updateListMusics`；如果真机观察到列表页明显抖动，
   逃生口是预热时不传 `listId`（只拿 url，不写回），代价是切歌时仍要问一次源。

## 8. 明确不做

- 不预焐下两首（只做下一首）。
- 不改 `PlayerOverlay` 反编译层那份 `OverlayBackdrop` 的动画；不动横屏布局与方向相关 API。
- 不接纹理层（`getCoverTexture` 那条支仍是不接线状态）。
- 不引入新依赖（`expo-image` / `NetInfo` 都不要），也不做"仅 WiFi 预取"的网络类型判定。
- 不走 media3 官方 `ExoPlayer.setPreloadConfiguration`：它要求下一首已在播放队列里，
  而 lx 的 JS 队列语义是单曲 add→skip→remove，改它会牵连通知栏队列与 `playerEnded → playNext` 的自动续播
  （可能双重前进）。1.8.0 确有该 API（javap 确认），但风险/收益不划算，且它是否写入同一个 `SimpleCache` 未证明。
- 不把 `PaletteModule` 改成优先读 Fresco 缓存（现在它自己下图，等于每张封面下两次）。这是后续独立一项。
