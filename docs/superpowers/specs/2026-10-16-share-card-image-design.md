# 分享图设计（Apple Music 风格分享卡 + 歌词海报）

日期：2026-10-16　状态：音乐卡一支**代码已落地**（`feat/music-recognition-phase1` 上 `2410e79..01680db`，**代码 14 笔**、
另有 11 笔 docs 回改不计入，链见 §11.7）、
静态闸门全过；**真机一条没跑**（写这份状态时 `adb devices` 为空），§8 三条生死探针与 §9/§11.4 的验收清单仍是未闭合的门；
**歌词海报一支（`mode: 'lyric'`）只有代码没有入口**，宿主 UI 不在 HEAD。本文 §2/§5/§6/§7 的字面表述有若干处与最终实现不一致，
**先读文末 §11「落地与偏离」**再按本文改代码
落地计划：`docs/superpowers/plans/2026-10-16-share-card-image.md`（11 个任务，Task 1–10 执行完，Task 10b 挂起）

参考图三张（Apple Music 实拍）：亮封面 → 白卡黑字；暗封面 → 深卡白字；歌词分享 → 半透明深卡压在虚化封面上。

## 1. 要解决的问题与现状

两件事各自缺的东西不一样，先分开说清：

| 现状 | 位置 | 结论 |
| --- | --- | --- |
| 分享音乐 = **纯文本**（"歌名 - 歌手" + 网页链接），或复制到剪贴板 | `src/utils/tools.ts:343-371` → `UtilsModule.shareText`（`text/plain`） | 没有图片这条路 |
| 歌词工具栏的「歌词海报」按钮 = **disabled 空壳，没有 `onPress`** | `src/screens/PlayDetail/Vertical/Lyric.tsx:501-503` | 海报整个功能不存在 |
| 选行、翻译行拼接、全选/反选逻辑已实现且零 import | `src/core/lyricCopy.ts` | 海报的行集直接复用，不另立判据 |
| 封面模糊底、取色、明暗判定已实现 | `CoverBackdrop`（`blurRadius: 90`）、`src/utils/monet/*` | 三块难啃的都不用新写 |
| `react-native-view-shot` / `svg` / `skia` / `expo-*` / `react-native-share` **一个都没装** | `package.json` | 唯一需要选型的地方：用什么把卡片变成一张图 |

**已有的可复用资产**（决定了本方案几乎不写新算法）：

- 模糊：RN 核心 `<Image>/<ImageBackground>` 的 `blurRadius`，Android 侧走 Fresco（`ReactImageView.java:222`）。项目里 `CoverBackdrop/index.tsx:11` 用的就是 `BLUR_RADIUS = 90`。
- 取色：`getArgbPixels(url, maxSize=128)`（`PaletteModule.java`）自己下载/读本地封面并吐 ARGB 数组；JS 侧 `measureArgbPixels → { average, highlight }`（`sourceColor.ts:156-182`），像素层按 url 做 LRU 缓存（`coverPalette.ts`，`PIXEL_LIMIT = 20`）。
- 落款图标：`android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` 实测是 432×432 RGBA、四角 alpha=0、字形色 `#02AABB`（解 IDAT + 反滤波验证过）。**透明底，白卡黑卡都能直接放，不需要抠图。**

## 2. 渲染路线的取舍（本次选型）

| 路线 | 卡片怎么写 | 代价 | 结论 |
| --- | --- | --- | --- |
| **A. `react-native-view-shot`** | 普通 RN 组件，`captureRef(ref)` 出 PNG | 多一个原生依赖 | **采用** |
| B. 隐藏 WebView + `<canvas>` | HTML/CSS/JS 重排一遍 | 排版逻辑要脱离主题体系另写一套；WebView 常驻内存 | 备选（A 的探针全挂时） |
| C. Android 原生 Canvas 画卡 | Java `Canvas.drawText` | 调一次间距要重编 6-8 分钟；iOS 没有 | 否 |
| D. 纯 JS 光栅化（已有 `png.ts`） | 自己编码 PNG | **没有字体/字形排版**，中文文本这一步过不去 | 否 |

选 A 的关键理由：**卡片可以写成普通 RN 组件，于是"预览"和"导出"是同一个组件**，取色结果、主题色、间距常数都不用复制第二份。

`npm pack` 扒源码实测到的事实（不是看博客摘要）：

- **版本必须锁 `3.8.0`**（原写 `4.0.3`，2026-10-16 真机编译否证）。`4.0.3` 的 `android/src/main/java` 无条件引 Fabric：`ViewShot.java:29/61/191/197` 用 `com.facebook.react.fabric.interop.UIBlockViewResolver`、`RNViewShotModule.java:101` 强转 `FabricUIManager`，而 RN 0.73.11 的 ReactAndroid 里没有这两个类 → `:react-native-view-shot:compileDebugJavaWithJavac` BUILD FAILED（5 条错误，55s）。`src/paper/` 里只有一份 codegen 桩 `NativeRNViewShotSpec.java`，**补不上 main 源集**——"带 paper 源集所以老架构可用"这条推断是错的。
  `3.8.0` 走 `reactContext.getNativeModule(UIManagerModule.class).addUIBlock(...)`（0.73 有这个方法，见 `UIManagerModule.java`），全包零 `com.facebook.react.fabric` 引用，peer `"*"`，`captureRef`/`result: 'tmpfile'` 都在（`src/index.d.ts:113,47`）。`5.x` 要 RN≥0.76、`6.x` 要 ≥0.80，也不可选。
- 捕获方式是 `view.draw(canvas)`（`ViewShot.java:382`），不是截图。
- 默认 `result: 'tmpfile'` 落在**内外置缓存里剩余空间大的那个**（`3.8.0`：`RNViewShotModule.java:172-189`，`externalCacheDir.getFreeSpace() > internalCacheDir.getFreeSpace()` 就用外置），真机上通常是 `/storage/emulated/0/Android/data/<pkg>/cache/`。`AndroidManifest.xml:107-117` 已声明 FileProvider，但 `res/xml/file_paths.xml` 只有 `<cache-path name="cache" path="/" />` → **`file_paths.xml` 必须补一条 `<external-cache-path name="external-cache" path="/" />`**（原写"不用改"，错）。不补的表现：`FileProvider.getUriForFile` 对外置缓存路径抛 `IllegalArgumentException`，分享按钮点了报错，而且换一台存储布局不同的机器结果就变了。
- `html2canvas` 只出现在 `src/RNViewShot.web.js`，Metro 走 `.js` 分支，**不进包**。

## 3. 卡的两层结构

```
底层  ImageBackground(封面, blurRadius: 90) + scrim      ← 铺满整张图
卡层  圆角 28 / padding 20 / 宽 = 屏宽 × 78%              ← 内容随形态不同
```

**明暗判定（只有音乐卡参与）：**

- 取封面平均色的 HCT tone：`Hct.fromInt(averageArgb).tone > 50` → 亮卡（白底 + 黑字），否则深卡（`#1C1C1E` + 白字）。
- 这条判据和 `surface.ts:125` 的 `isDark = font.tone > 50` 是同一个写法，但**输入不同**：播放页背景跟着 App 主题字色走，分享卡跟着封面走。两者不能共用一个函数，否则用户切主题时分享图会跟着变——那不是 Apple Music 的行为。
- 为此在 monet 层加一个出口 `getCoverAverageArgb(picUrl)`，复用 `coverPalette` 已有的像素缓存（播放页已经暖过，海报页基本零成本）。
- **回落**：取色失败 / 本地歌无封面（`averageArgb` 拿到 `null`）→ 一律深卡。
  原来还写了「色度为 0 也走深卡」，2026-10-17 删掉：HCT 的 chroma 在 sRGB 里对任何中性灰都**取不到 0**（实测 gray 119 → 1.8156、gray 250 → 2.8350、纯白 → 2.8690，只有 `0x000000` 是 0，而它已经被 `tone > 50` 判成深卡了），所以那条要么恒假，要么就得引入一个阈值 —— 而阈值会和 §9 的验收项「白色系封面 → 白卡黑字」直接打架。

**歌词卡固定深卡半透明**（参考图 2 本来就是这个样式），不参与自适应。

**内容排布：**

| 卡型 | 内容 |
| --- | --- |
| 音乐卡 | 封面原图（圆角）→ 歌名 → 歌手 → 落款 |
| 歌词卡 | 歌词正文（大字）→ 分隔线 → 小封面（横排方块）+ 歌名 + 歌手 → 落款 |

落款统一为：`app-icon-glyph.png`（青色字形，约 18-20dp）+ 紧跟 `Music` 两个字母，**不带 App 名**，完全对齐参考图 ` Music` 的排布。

透明度初值（都是真机观感调参项，不是判据）：底层 scrim `rgba(0,0,0,0.20)`；深卡卡底 `rgba(28,28,30,0.72)`；亮卡卡底 `#FFFFFF` 不透明。

## 4. 歌词区最大高度

卡高随内容长，但整张图高度恒定 = 屏高，卡居中，多出的空间被虚化封面吃掉。歌词块给一个可用最大高度，超出走纯函数：

```ts
fitLyricBlock(lines, { maxHeight, tiers: [24, 22, 20, 18, 16], lineHeightRatio: 1.5 })
  → { fontSize, visibleCount, truncated }
```

- `tiers` 与 `maxHeight` 单位一律 **dp**（RN 逻辑像素），不是物理像素；`visibleCount` 按"句"计。
- 从 24 往下一档档试，取第一个装得下的字号。
- 16 档仍装不下 → 截断到能装下的行数，末行补 `…`，`truncated: true`。
- 翻译行（`extendedLyrics`）跟着正文行走，字号 = 正文档位再降一档，**地板 12**（正文已在 16 档时翻译行走 12，不再随档位下探）—— 与 `buildLyricCopyText` 的拼接口径保持一致。
- 行集来源就是 `pickLyricLinesForCopy(lyricLines, selectedLines)`，**选中几句出几句**，和「复制」按钮完全同源。

这个函数零 import、`node --test` 直接加载，规矩同 `src/core/lyricCopy.ts`。

## 5. 导出、分享、下载

**预览页 = 那张图本身。** 点入口 → 全屏 Modal 实时渲染卡片 → 右上角两枚按钮。预览和导出共用一个组件，改样式只改一处。

承载方式定为**全屏 `Modal`，不新增 navigation 路由**：`PlayDetail` 本身已经挂在 `PlayerOverlay` 这层浮窗里，再加一条路由会让返回栈变成三级；`onRequestClose` 只关这一层。

- `captureRef` 打在最外层容器，**不传 `width`/`height`**：view-shot 是"按视图尺寸画 → `createScaledBitmap`"（`ViewShot.java:440`），传尺寸只会拿到放大后的糊图；不传就是设备原生像素。
- **右上角两枚按钮必须在 ViewShot 容器外面**的独立 absolute 层，否则会被拍进图里。

**分享（新增 `UtilsModule.shareImage(path, title, text)`）：**

- `FileProvider.getUriForFile` + `EXTRA_STREAM` + `image/png` + `FLAG_GRANT_READ_URI_PERMISSION`。
- 不复用现有 `shareText`：它用 `Uri.fromFile`（安卓 7+ 收端 FileUriExposedException），且 `setType("text/plain")`。新函数单独一条路，顺手也保证 `shareText` 的行为不受影响。
- **落地更正（2026-10-17）**：实际签名多一个入参 —— `shareImage(path, authority, shareTitle, title, text)`，authority 由 JS 侧传 `APP_PROVIDER_NAME`（`src/config/constant.ts`），Java 不硬编码 `cn.toside.music.mobile.provider`。
  另有一处**必须是 `return NativeModules.UtilsModule.shareImage(...)`**：Java 方法末尾带 `Promise` 参数时，legacy bridge 判定为 `METHOD_TYPE_PROMISE` 并**返回一个 Promise**（`JavaMethodWrapper.java:220-221` → `NativeModules.js:98-121`）；
  漏掉 `return` 会让外层包装函数立刻 resolve，四条 `promise.reject`（文件不存在 / FileProvider 拒 / activity 为 null / ActivityNotFound）全变成 unhandled rejection，表现就是"点了分享没反应"，而预览页两枚按钮永远 catch 不到东西（`dfadbb8` 修的就是这条）。

**下载（复用 SAF 三件套）：**

- ~~走 `ensureUsableSaveDir` / `publishFile` / `scanPublishedFile`（`src/core/download/target.ts`）~~ → **没复用**（2026-10-17 更正）：`src/core/download/` 到本次落地为止**始终未进 git**（`git ls-files src/core/download/` 空输出，是另一支会话的 WIP），引用它这笔提交单独 checkout 编译不过。
  改为自带判据：`src/utils/shareCard/saveTarget.ts`（纯函数 `parseSaveDir` / `isDirGranted` / `childProbePath` / `childRealPath`）+ `saveCard.ts` 用 HEAD 真有的 `selectManagedFolder` / `existsFile` / `copyFile`（`copyFile` 这一行由本分支解冻入库）+ `joinSavePath`。
  两份判据的语义重复是**有意的**，收口条件见 §11.5 第 2 条。
- 媒体扫描走 `RNFS.scanFile(childRealPath(...))`，失败就 `void …catch(() => {})` 静过（原写 `scanPublishedFile`，那个函数不在 HEAD）。
- 但用**独立的 setting key** `shareCard.savePath` / `shareCard.savePathName`，不让海报混进下载的音乐文件里。已进 `src/types/app_setting.d.ts:367/:372` 与 `src/config/defaultSetting.ts:74-75`，锚在 HEAD 真有的 `'download.fileName'` 之后。
- 首次点击弹系统文件夹选择器；同名不覆盖是自己实现的 `uniqueName`（探测用**完整 document URI** 走 `existsFile`，写入用裸拼路径，两者不能混），会堆 `(1)(2)`，已知行为，本次不改。**探测这条从没在真机上验过**，见 §11.4 第 11/12 条。
- 两枚按钮点击期间禁用 + 转圈，防重复导出。（落地后 `TouchableOpacity` 禁用态不会自动变暗，观感见 §11.6。）

## 6. 入口

| 入口 | 改法 | 落地情况（2026-10-17） |
| --- | --- | --- |
| `Lyric.tsx:501` 的 disabled「歌词海报」 | 接上 `onPress` → 进预览页，歌词卡 | **未做，挂起为 Task 10b**：宿主那批改动（`Lyric.tsx` +187/−13）与它要消费的 `src/core/lyricCopy.ts` 全都没进 git（`git ls-files src/core/lyricCopy*` 空输出），接上去这笔提交单独 checkout 编译不过。于是 `mode: 'lyric'` 这条路**代码在、无用户入口** |
| `PlayDetail/Vertical/components/Header.tsx:103` 分享图标 | 现在直接分享文本；改成先弹小面板「分享文字 / 分享图片」 | **已做**（`01680db`）：新增 `ShareModeSheet.tsx`（162 行，两行面板，结构对齐同目录 `MusicMoreSheet.tsx:159-230`），`share()` 只负责 `shareSheetRef.current?.show()`，文本那一支仍原样调 `shareMusic(shareType, downloadFileName, musicInfo)` |

头部这里选"多弹一层面板"而不是"把文本分享悄悄换成图片"：分享本来就是要用户挑目标 App 的动作，多一次点击成本很低，改掉既有行为的回归风险更高。

## 7. 文件清单

**新增依赖**：~~`react-native-view-shot@4.0.3`~~ → 实际锁 **`3.8.0`**（精确锁版本；否证过程见 §2，2026-10-16 真机编译更正）

```
新增  src/components/ShareCard/index.tsx        两层结构 + 明暗判定接线            ✅ 落地
新增  src/components/ShareCard/MusicCard.tsx    音乐卡内容                        ✅ 落地
新增  src/components/ShareCard/LyricCard.tsx    歌词卡内容                        ✅ 落地（无入口，见 §6）
新增  src/components/ShareCard/cardTheme.ts     纯判据：tone → { bg, ink, scrim }  ✅ 落地
新增  src/components/ShareCard/fitLyricBlock.ts 纯判据：行集 → 字号档/截断          ✅ 落地
新增  src/components/ShareCard/CoverImage.tsx   私有封面组件（自带 onLoad 门控）    ✅ 落地（就绪上报两次返工，见 §11.3-5）
新增  src/components/ShareCard/ShareCardModal.tsx  全屏 Modal + 右上角两枚按钮      ✅ 落地
新增  src/components/ShareCard/BrandLine.tsx    落款（§7 原没列，多拆）            ★ 本计划新增
新增  src/utils/shareCard/exportCard.ts         captureRef → 文件路径（原名 export.ts）  ✱ 改名
新增  src/utils/shareCard/cardFileName.ts       非法字符判据（§7 原没列，多拆）      ★ 本计划新增
新增  src/utils/shareCard/saveCard.ts           SAF 落盘（§7 原没列，被 §5 的"复用"顶掉了）★ 本计划新增
新增  src/utils/shareCard/saveTarget.ts         tree URI 判据（§7 原没列）          ★ 与下载 WIP 重复，见 §11.5
新增  src/components/.../components/ShareModeSheet.tsx  分享方式两行面板（§7 原没列）  ★ 本计划新增
新增  src/resources/images/app-icon-glyph.png   从 ic_launcher_foreground.png 复制  ✅ 落地（72,708 B，md5 与源文件一致）
新增  tests/{share-card-fit-lyric-block,share-card-theme,monet-cover-average,share-card-file-name,share-card-save-target}.mts  §7 原没列，§9 的 5 个用例
删除  src/components/ShareCard/probe/BlurProbeCard.tsx  Task 1 的生死探针载体，Task 6 按计划删除 ✅
改动  src/screens/PlayDetail/Vertical/Lyric.tsx      接上海报按钮                  ✗ 未做（Task 10b 挂起）
改动  src/screens/PlayDetail/Vertical/components/Header.tsx  分享弹面板             ✅ 落地
改动  src/utils/monet/index.ts + coverPalette.ts     加 getCoverAverageArgb 出口    ✅ 落地
改动  src/utils/monet/sourceColor.ts                 加 averageArgbOfPixels         ★ §7 原没列（原本要用 WIP 的 measureArgbPixels，见 §11.5）
改动  android/.../utils/UtilsModule.java             加 shareImage                  ✅ 落地
改动  android/app/src/main/res/xml/file_paths.xml    加 external-cache-path         ★ §7 原写"不改"，§2 已推翻
改动  src/utils/nativeModules/utils.ts               shareImage 的 JS 包装          ★ §7 原没列
改动  src/types/app_setting.d.ts                     shareCard.savePath / savePathName  ✅ 落地
改动  src/config/defaultSetting.ts                   两个键的默认值 ''               ★ §7 原没列
改动  src/lang/{zh-cn,zh-tw,en-us}.json              文案（实际每份 +9 枚 key）      ✅ 落地
改动  package.json                                   新依赖 + test 脚本追加 5 个用例  ✅ 落地
改动  src/utils/fs.ts                                解冻 copyFile 那一行            ★ §7 原没列
```

**明确不改的**：`src/components/common/Image.tsx` —— 实际零改动（`CoverImage.tsx:4` 只 import 它的 `defaultHeaders`）。从 `Image.tsx` import 已导出的 `defaultHeaders` 常量，自己拿 `onLoad`。共享组件零改动 → 横屏零风险，也避开歌词页踩过的那次 memo 比较器坑。

## 8. 三条生死探针（先跑通，再写正式代码）

0. **能不能编译**（这条排最先，2026-10-16 已跑，**结论：`4.0.3` 不通过，改锁 `3.8.0`**）。
   详见 §2。`3.8.0` 的编译与 autolink 结论见实施计划 Task 1 的报告；三条真机探针因设备未连暂缺，跑完再往下面逐条补。
   补记（2026-10-17，Task 11）：`assembleDebug` BUILD SUCCESSFUL（1m14s）、Metro bundle exit 0、
   `PackageList.java` 里 `RNViewShotPackage` 命中 2 次、`RNViewShotModule.class` 进了 javac 产物 —— **编译这一条已经闭合**。

**探针 1/2/3 到 Task 11 为止一条都没跑**（`adb devices` 从 Task 1 到本次全程为空；APK 已产出躺在
`android/app/build/outputs/apk/debug/xunyin-v1.1.0-arm64-v8a.apk`，插上手机 `adb install -r` 即可）。
Task 6 的铺底层与 Task 9 的状态栏留白**按"探针全过"写完并入了 HEAD**，所以下面三条现在是**负债而不是结论**，
判据是图本身不是 `exists=true`：

1. **`blurRadius` 会不会被 `view.draw()` 拍到。** Fresco 的模糊是烘进位图的，理论上能；但这条不验我不敢往下写。
   退路：用 monet 已有的像素 + `png.ts` 自己编码一张模糊小图当底 —— 仍然零新依赖。
   挂了的返工范围：`src/components/ShareCard/index.tsx` 底层那一块（`BLUR_RADIUS = 90` 那发 `ImageBackground`）。
2. **远程封面（需要 UA header）是否真的加载完才拍。** 靠 `CoverImage` 的 `onLoad` 门控。不通过的话会拍到空图/占位图。
   挂了的返工范围：`CoverImage` 的 ready 上报（§11.3-5 那两轮返工的成果要重做），`onReadyChange` 那条就绪链跟着作废。
3. **全屏 Modal 拍出来含不含状态栏。** 含则给容器加 `paddingTop`，或改 `statusBarTranslucent` 后重排。
   现状：`ShareCardModal` 用 `useWindowSize().height` 并在按钮层留 `paddingTop: statusBarHeight + 6`，
   而 `windowSizeTools.ts:42-53` 有两条分支（原生 px÷scale **不加**状态栏 / 兜底 `Dimensions` **主动加**）——
   两条分支下导出矩形高度差一个状态栏，**哪条在真机上生效没人验过**，所以这一项现在连"猜"都猜不准。

顺带一条同一批未验的前提：**`NativeModules.RNViewShot` 在运行时非 undefined 也没在设备上确认过**（autolink 只证到编译期）。

三条都在真机上跑，任何一条挂了就回到本节改设计，不要绕过。

## 9. 测试

- 纯函数 `fitLyricBlock` / `cardTheme`（tone 分档、回落分支）：`node --test`，零 import。
- Java：`compileDebugJavaWithJavac` 过编译。
- 闸门：tsc + eslint；判据只 grep 自己改过的文件（总数会随别人未提交的 WIP 漂移）。
- **落地情况（2026-10-17）**：5 个用例文件都进了 HEAD 且**都登记在 `package.json` 的 `test` 脚本里**（没登记的用例不会跑，这条查过）——
  `tests/share-card-fit-lyric-block.mts`（9 条档位/截断）、`tests/share-card-theme.mts`（7 条，含实测的 118/119 翻转点）、
  `tests/monet-cover-average.mts`（Task 4 平均色）、`tests/share-card-file-name.mts`（非法字符/长度回落）、
  `tests/share-card-save-target.mts`（11 条 tree URI 判据）。本轮实测 `npm test` = **685 / pass 684 / fail 1**，
  唯一那条红是既有的 `tests/monet-texture.mts:68`（纹理支故意红），本功能既没把它改绿也没让它更红。实测数与判据见 §11.1。
- ~~真机清单（vivo + 另一台）：1…10~~ → 这份 10 条的草稿已被计划 Task 11 Step 3 的 **13 条**取代（多出"同名不覆盖""杀进程不再弹选择器""savePathName 存的是可读名字"三条 SAF 判据），
  再叠加 Task 7 要求补的两条（反复分享 10 次、非 Pixel OEM chooser）。**全部挂起未跑**，逐条原文与阻塞原因见 §11.4。

## 10. 范围外

- **横屏完全不参与**（用户明确要求）。功能只在 `PlayDetail/Vertical` 这条树上，新页面按现有竖屏约定写。
- iOS 不做验证（`view-shot` 有 podspec，理论上能编过，但本次不测、不写 `.mm`）。
- 不改 `shareText` 的现有文本分享行为。
- **其它分享入口本轮一律不动**，保持纯文本：`OnlineList/listAction.ts:31`、`Mylist/MusicList/listAction.ts:71`、`Recommend/index.tsx:430`、`MusicRecognition/ResultSections.tsx:79`、`SonglistDetail/Header.tsx:102`。分享图只做播放页头部 + 歌词海报这两个入口。
- 不做二维码、不做多模板/配色自选、不做海报历史。
- ~~不改 `file_paths.xml`~~ → **要改**：加一条 `external-cache-path`（见 §2 的 2026-10-16 更正），`3.8.0` 会把临时图写进外置缓存。

## 11. 落地与偏离（Task 11 回写：2026-10-17）

Task 1–10 执行完，**代码 14 笔提交**在 `feat/music-recognition-phase1` 上（链见 §11.7；另有 11 笔 docs 回改不计入）。
**静态闸门全过；真机一次没跑** —— 写这份状态时 `adb devices` 仍是空列表（从 Task 1 到 Task 11 全程如此），
所以计划的 Step 2（gradle 构建装机）与 Step 3（13 条验收清单）整体**挂起**：不是失败，是没有硬件。
§8 三条生死探针仍无结论，§11.5 两份重复仍不能合并，`mode: 'lyric'` 那一支只有代码没有入口（Task 10b 挂起）。

### 11.1 闸门实测数（2026-10-17；下次别照抄本文其他处的旧数）

- `npm test`：**685 / pass 684 / fail 1**。唯一那条红是既有的 `tests/monet-texture.mts:68`（纹理支故意红，
  2026-10-15 预加载 spec §9.1 记的是同一条），本功能既没把它改绿也没让它更红。总数会随别的会话 WIP 漂移，
  **判据只是"红的那条不是本功能的、且没有新增红"**，不拿总数对号。本功能 5 个文件单独跑：
  `share-card-fit-lyric-block` 9、`share-card-theme` 7、`monet-cover-average` 5、`share-card-file-name` 5、`share-card-save-target` 11 = **37 条全绿**。
- `npx tsc --noEmit`：**137 条 = 本机基线，一条没涨**。判据是"本功能创建的文件在输出里 0 次命中"——拿本分支提交里的全部 ts/tsx 路径 grep 过 tsc 输出，
  唯一命中是 `src/config/defaultSetting.ts(81,3): error TS2353: ... ''list.isClickPlayList'' does not exist in type 'AppSetting'`。
  那条**在 HEAD 就红**（`git show 01680db:src/types/app_setting.d.ts | grep -c isClickPlayList` = 0，那个键根本没声明过），
  只是被本分支插入的 3 行从第 77 行挪到第 81 行；`defaultSetting.ts` 是本功能**改动**的文件，不是本功能创建的。
- `npx eslint`：**没有跑计划里的 `npx eslint . --ext .js,.jsx,.ts,.tsx`** —— 工作区带着另一支会话的大批未提交 WIP，
  整仓 lint 报的是本分支既不该修也修不动的错。实际跑的是本功能自己的 21 个 ts/tsx（`git diff --name-only a6c1744..01680db` 里的 ts/tsx：
  13 个新建 + 8 个改动，含 `Header.tsx` / `sourceColor.ts` / `fs.ts` 这些带着别人 WIP 的共享文件）：两组都**静默、exit 0、0 error**。
- Java / 打包：Task 1 的 `assembleDebug` BUILD SUCCESSFUL（1m14s）、Task 7 的 `compileDebugJavaWithJavac` 与合好的 debug manifest
  （`cn.toside.music.mobile.provider` → `@xml/file_paths`，打包后的 `file_paths.xml` 确实带着新那条）都已过。
  Task 11 **没有重跑 gradle** —— 按裁定，没有设备就不装机，编译结论不会因为我再跑一遍而改变。

### 11.2 落了什么（`a6c1744..01680db`）

新增 ts/tsx **13 个**（本文 §7 只列了 8 个）+ 用例 **5 个** + `app-icon-glyph.png`；改动既有文件 **8 个 ts/tsx + 2 个 android + 3 份 lang + `package.json`/`package-lock.json`**。
逐条状态在 §7 那张表里，这里只说 §7 完全没出现过的：

- `src/utils/shareCard/` 这一层实际是 **4 个**文件：`exportCard.ts` / `saveCard.ts` / `saveTarget.ts` / `cardFileName.ts`（§7 只给了 1 个）。
- `ShareModeSheet.tsx`（162 行，两行面板）与 `BrandLine.tsx` 是执行期间新增的拆层。
- 探针载体 `src/components/ShareCard/probe/BlurProbeCard.tsx` 由 Task 1 建、Task 6 按计划 `git rm -r` 删。
- `src/utils/fs.ts` 的 `copyFile` 那一行解冻由本分支（`97391d4`）先入库（工作区本来就解冻着，见 §11.5 第 3 条）。

### 11.3 与本文字面不一致的（以代码为准）

1. **§7 `src/utils/shareCard/export.ts` → 实名 `exportCard.ts`**。`export` 是 JS 关键字，文件名与 tsc 的模块解析放一起容易踩坑，且同目录已有 `saveCard.ts` 的命名风格。
2. **多拆 `cardFileName.ts`（零 import）**：文件名的非法字符判据要能被 `node --test` 直接加载，而 `saveCard.ts` 带 RNFS 与 store import 加载不动。
   `saveCard.ts` **不 import** 它——`saveShareCard(tempPath, baseName)` 收的是调用方用 `cardFileName(name, singer)` 算好的 `baseName`，自己只落盘，返回**文件名**（`null` = 用户没选位置）。SAF 判据另住 `saveTarget.ts`（只 import `savePath.ts`）。
3. **多拆 `BrandLine.tsx`**：音乐卡与歌词卡的落款完全同形同逻辑，不拆就是两份间距常数。代价：那一行需要一条 `eslint-disable-next-line @typescript-eslint/no-var-requires`（`:7`）——
   `eslint --print-config` 实测 `.eslintrc.cjs:39-40` 的 `standard-with-typescript` 在 `*.tsx` 上确实把这条规则设成 error，所以这条 disable **是有承重的**，不是随手加的；
   仓库里没有 `declare module '*.png'`，而 `require('@/resources/…')` 是现成写法（`src/components/common/LocateButton.tsx:7`）。
4. **`ShareCardModal` 的按钮层用 `StyleSheet.create`，不是 `createStyle`**（`d853eb6`）。理由：`createStyle` 缩放 width/height/margin/padding 却**不缩放 borderRadius** ⇒ 字号 >1 时圆角按钮变方角。
   代价：那一层不吃字号缩放——按钮里是 `Icon size={22}` 不是文字，本来就不该缩；另一半的 `paddingTop: statusBarHeight + 6` 一直是原始 dp。附带收益：老路径乘 375×667 设计稿比例会把 44 压成约 42，现在正好 44。
   **卡片内容层仍然用带类型标注的普通对象常量**（Task 5/6 定的 Step 0：卡内数字是原始 dp，必须与 `fitLyricBlock` 的高度预算同一坐标系）——同目录两种写法并存是有意的，别"顺手统一"。
5. **`CoverImage` 的就绪上报返工了两轮**（`cff62d0`、`6e65168`），计划原写法有两个真 bug：
   ① `[uri]` 复位 effect 在 paint 之后跑，同一次 passive flush 里会先看到 `uri=B, loaded=true` ⇒ 给**没解过码的新封面**报一次 ready，Task 6 照它放行拍摄就拍到上一首的图（Fresco 换源保留旧 drawable）；
   ② 卸载清理挂在 `[onReady]` 上，父组件每次传新箭头都在活的子组件上跑一次 `onReady(false)`，而 `(uri, ready)` token 已消费、再没有 transition 能救回来——无封面那条路（ready 恒真）正好被永久钉死在"正在准备"。
   最终形态：`LoadState` 带 uri + 渲染期 setState（React 官方"prop 变化时调整 state"）+ `onReadyRef` 期间赋值 + `[]` deps 清理 + **`key={uri}` 重挂**（RN 图片事件只认当前挂载视图，否则晚到的旧图 `onLoad` 会打到新回调上、`s.uri === uri` 两边都是新的，判据形同虚设）。
   `onReady` 走 ref 不进 deps，父组件可以传内联箭头；`normalizeCoverUri` 必须保持返回**原始字符串或 null**（返回新对象会无限重渲染）。
6. **两处裸 `catch {` 补了 `console.error('[share_card] …', e)`**（`ShareCardModal.tsx:46` capture_failed、`:62` save_failed）。本仓库 release 构建不剥 console。
   `capture_failed` 那个 try 连分享面板一起包，日志标签范围略宽是**接受的**：收窄要把拍摄与分享拆成两步，不值。
7. **i18n key 的任务边界改过**：`t` 是 `(key: keyof Message, val?) => string`（`src/lang/i18n.ts:19`），`Message` 是三份语言 Record 的联合、`keyof` 取**交集**
   ⇒ key 与用它的代码必须同笔落地，否则那一支单独 checkout 编译不过。5 枚 toast key（`share_card_capture_failed` / `share_card_save` / `share_card_save_canceled` / `share_card_save_failed` / `share_card_saved`）
   从 Task 10 挪进 Task 9，Task 10 只剩 4 枚（`share_mode_sheet_title` / `share_mode_text` / `share_mode_image` / `share_card_no_selection`）。
   `share_card_title_music` 与 `share_title_music`（`zh-cn.json:478-479`）是**本功能之前就有的**（歌单分享那一支留下的），不是本次新增。
   `share_card_no_selection` 本轮入库但**没有引用**（唯一消费者在挂起的 Task 10b）——10b 之前它是 dark key，别当垃圾清掉。
8. **两处高度预算是执行期间加的，本文 §3/§4 没有**：`MUSIC_CARD_TEXT_RESERVE = 200`（`ShareCard/index.tsx:26`：封面尺寸取"宽上限"与"高上限 − 文字预留"的较小者。
   原先只按宽算 `0.78W − 40`，而 RN 的 `maxHeight` 既不缩子节点也不裁（默认 `flexShrink: 0`、`overflow: 'visible'`）→ 内容一超，歌名/歌手/落款渲染到圆角卡底**外面**的糊底上，而且是在导出的成品图里；411×823 那种窗口 + 三行歌名就已经翻负）
   与 `LYRIC_FOOTER_RESERVE` 140 → **160**（`:24`：截断省略号那一行不在歌词预算里，而 `fitLyricBlock` 的判据是 `>`，"正好等于上限"算装得下 = 正是没有余量的那一刻；旧注释还把 `CARD_PADDING*2` 重复算进 140，真实余量只剩 18~37 dp）。
   省略号那行还补了确定 `lineHeight`，`1.5` 改用 `fitLyricBlock` 导出的 `LYRIC_LINE_HEIGHT_RATIO`（预算与绘制必须同一坐标系，否则改了模块没改卡，测过的数和拍出的图分叉）。
9. **`ShareCardProps` 是导出的**（Task 9 要 import 它），不是未导出的本地 `interface Props`。
10. **注释漂移一条**：`ShareCard/index.tsx:16` 写"播放页 `COVER_BLUR_RADIUS=5`"，工作区 `CoverBackdrop/index.tsx:17` 实际已经是 **9**（并行会话改的，与本功能无关）。分享卡自己的 `BLUR_RADIUS = 90` 不受影响。
11. **§3 的"色度为 0 → 深卡"回落已在实现前删掉**（`1452958`，正文 §3 已同步）；HCT tone 50 的灰阶翻转点是**实测的 118/119**，不是推的，`tests/share-card-theme.mts` 把这两个值钉住了。

### 11.4 唯一未闭合的门：真机清单（本轮全部挂起，跑完把结论写回本表）

**挂起原因：本轮无真机可连**（`adb devices` 空列表）。Step 2 的构建装机同样没跑。所需 APK 已经在
`android/app/build/outputs/apk/debug/xunyin-v1.1.0-arm64-v8a.apk`，插上手机 `adb install -r` 即可。
1–13 是计划 Task 11 Step 3 的原文清单，**一条都没有结论**；14/15 是本次按 Task 7 的要求补的。

| # | 验什么 | 判据 / 不通过长什么样 | 状态 |
| --- | --- | --- | --- |
| 1 | 亮封面（白色系专辑）→ 白卡黑字 | §3 的 `tone > 50` | 挂起 |
| 2 | 暗封面（黑金专辑）→ 深卡白字 | 同上 | 挂起 |
| 3 | 本地歌无封面 → 深卡 + 空封面位不崩、导出按钮仍可用 | `averageArgb = null` 的回落分支 | 挂起 |
| 4 | 歌词卡只选 1 句 → 大字号、卡偏矮 | — | 挂起，**额外阻塞在 Task 10b**（本轮 `mode: 'lyric'` 无用户入口） |
| 5 | 歌词卡全选 20+ 句 → 先缩字号，缩到 16 还装不下就截断补 `…` | — | 同上 |
| 6 | 选带译文的段落 → 译文紧跟自己那行、字更小 | — | 同上 |
| 7 | 首次点下载 → 弹系统文件夹选择器，落地文件在系统图库里能看到 | `RNFS.scanFile(childRealPath(...))` 那条 | 挂起 |
| 8 | 点分享 → 系统面板收到的是 PNG 图，不是文本 | `shareImage` 整条链 | 挂起 |
| 9 | 导出图里**没有**右上角那两枚按钮 | §5 的分层承诺（按钮在被拍容器外面） | 挂起 |
| 10 | 预览页按系统返回 → 只关预览，不连带把播放页关掉、也不吞掉上一层 | `onRequestClose` | 挂起（歌词工具那一层要等 10b，本轮只测头部这条路） |
| 11 | 同一张海报**再保存一次** → 文件名是 `xxx (1).png`，不是覆盖 | 这条是 `existsFile(完整 document URI)` 的**唯一验法**：原生 `exists` 认不出 document URI 而恒返回 false 时，表现就是一路堆 `(1)(2)(3)`（Task 8 评审指出的假设） | 挂起 |
| 12 | **杀掉 App 再进来**，直接点保存 → 不该再弹一次文件夹选择器 | 同时验 `isDirGranted` 的祖先判定和 `existsFile(裸 tree URI)` —— 裸树 URI 能不能被 `exists` 认下来，HEAD 里没有任何先例（`src/utils/log.ts` 那些调用点给的都是文件系统路径） | 挂起 |
| 13 | 选完文件夹后 `shareCard.savePathName` 里存的是可读名字（`Music` 这种），不是整条 `content://…` | `openDocumentTree` 返回值到底带不带 `name`，HEAD 里没人读过它（`src/core/common.ts:106-108` 只取 `.path`/`.isDirectory`）。取不到会回落成 URI，功能不坏但难看 —— **只记观感，不算验收失败** | 挂起 |
| 14 | **反复分享 10 次**：不炸、每次发出去的图都能打开 | 导出的临时 PNG **没人删是接受的**（库自带清理只认它的默认前缀，传了自定义 `fileName` 就落在过滤外；文件在应用自己的缓存目录，系统按空间压力回收）。**绝不能在 `shareCapturedCard` 返回后就调 `releaseCapture`** —— chooser 返回时用户还没选完收端，收端是之后才惰性读那个 content URI，删早了就是"分享出去打不开" | 本次新增，挂起 |
| 15 | 至少一台**非 Pixel** 上验 chooser 真的收到图 | grant flag 只加在内层 intent 上，OEM chooser 是经典翻车点 | 本次新增，挂起 |

跑 1–3 / 7–15 之前，先把 §8 的三条生死探针（糊底拍得到 / 远端封面拍前解得出码 / 状态栏进不进图）一起收掉：
Task 6 的铺底层与 Task 9 的状态栏留白都是**按"探针全过"写的**，任何一条挂了要先回 §8 改设计，而不是在验收清单上打勾。
第 11 条之外还有一条只能在这张表上验的：`fileName` 到不了收端手里（它是 `createTempFile` 的**前缀**，系统插随机数字，`safeFileName` 又把中日韩字符全换成 `_`），
所以"分享出去的文件名就是歌名"不成立 —— 歌名只走第 7/11/12 条那条保存路径。

### 11.5 本分支刻意留下的两份重复（都是为了"提交单独 checkout 也编译得过"；触发条件到了才收，现在收不了）

1. **`averageArgbOfPixels` ↔ 动态背景 WIP 的 `measureArgbPixels`**（同一件事：全图平均色）。
   现状（2026-10-17 实测）：`averageArgbOfPixels` 在 `01680db:src/utils/monet/sourceColor.ts:77`，被 `coverPalette.ts:251` 的 `getCoverAverageArgb` 调用；
   `measureArgbPixels` 在**已跟踪的 `src/` 里 0 命中**（`git grep -n measureArgbPixels 01680db -- src` 空输出），只活在未提交的动态背景 WIP 里。
   **触发条件**：动态背景那支把 `measureArgbPixels` 提交进 HEAD 的那一笔。
   **收口动作**：`getCoverAverageArgb` 的实现改调 `measureArgbPixels` → **删掉** `averageArgbOfPixels`（`sourceColor.ts:72-102` 那一段）。
   两份实现插在**同一文件同一带**，WIP 提交时这里必起冲突；顺带把 Task 4 评审记的那三份"校验+累加求平均"（`:79/:82/:83` vs `:155/:159/:160`、`:88-95` vs `:165-172`、`:96/:97-101` vs `:173/:175-179`，
   `blockHighlightArgb` 里还有第三份通道求和）一起抽成 WIP 那份 `collectOpaque`。
2. **`src/utils/shareCard/saveTarget.ts` ↔ 下载 WIP 的 `src/core/download/safPath.ts`**（tree URI 的四条判据：授权覆盖、document URI 探测、docId 反推真实路径）。
   现状：`git ls-files src/core/download/` **空输出**、`safPath.ts` 仍是未跟踪文件 ⇒ 现在合并就等于让 `saveCard.ts` 依赖一个不在库里的模块（与 Task 4 否掉 `measureArgbPixels` 同一类边界）。
   **触发条件**：`src/core/download/` 进 HEAD 的那一笔。
   **收口动作**：`saveCard.ts` 改成从那边 import → **删** `src/utils/shareCard/saveTarget.ts` **和** `tests/share-card-save-target.mts`，
   同时把后者从 `package.json` 的 `test` 脚本里摘掉（那边自己的 `tests/download-save-path.mts` 覆盖同样语义）。
   合一后注意调用点形状：本分支 `saveCard.ts:48` 用的是裸 `joinSavePath`，参考实现把那一步叫 `childWritePath`。
3. **连带项**：`src/utils/fs.ts` 的 `copyFile` 那一行解冻由本分支（Task 8，`97391d4`）先进库；下载那支后续提交 `fs.ts` 时它不再出现在 diff 里，**属正常，不要重复添加**。

### 11.6 已知观感风险与 deferred minors（都不阻塞，别在闸门里当失败算）

- **要脸的一条（只有真机能判）**：点「分享图片」时 `ShareModeSheet.tsx:50-53` 的 `handleSelect` 是**同步** `hide()` + `onSelect(mode)`，
  面板自己那层 Modal 还在 200ms 退场就把第二层 `ShareCardModal` 挂上去 ⇒ 安卓上两个 dialog 窗口重叠。
  参考实现（同目录 `MusicMoreSheet.tsx`）是 `hide(() => requestAnimationFrame(...))` 之后再开的。**要验的是会不会闪一下黑底、上层有没有被吞**，和清单第 10 条一起做。
- `ShareModeSheet.tsx:157-159`：`actionText` 丢了参考实现的 `flex: 1` ⇒ 字号 >1 或长译文时标签顶穿 `paddingHorizontal` 被裁，不出省略号。
- `ShareModeSheet.tsx:44-53`：200ms 退场窗口内连点两行会同时做两件事（`hide` 有相位闸门，`handleSelect` 没有）。
- `Header.tsx:54-56`：没有在播曲目时现在也会先弹面板，两行都静默 no-op（HEAD 的 `share()` 是直接 return 的）。
- `{name, singer, pic}` + `'progress' in` 那支投影是全仓第 4 份私有副本 ⇒ 建议 10b 时抽成 `toShareCardData()`，顺带能单测。
- 两枚按钮禁用时没有任何视觉反馈（`disabled={busy || !ready}`，`TouchableOpacity` 禁用态不自动变暗）。
- `cardFileName(...)` 在一次保存里算两遍（临时名 + 落地名），改一处易漏另一处；拍摄进行中关 Modal → 子树卸载、`captureRef` reject ⇒ 在身后那层屏幕上弹一个"生成图片失败"。
- 分享按钮的 a11y label 复用了 `share_title_music`（"歌曲分享"是名词）；10b 手上有 key 名额时可加 `share_card_share`。
- Task 2/3 留的三条（消费方注意）：`fitLyricBlock.ts:64` 非有限 `maxHeight` 会**敞开通过**（`x > NaN` 恒 false → 全部行都算装得下），
  `ShareCard/index.tsx:69` 已用 `Math.max(0, …)` 兜住，别的消费方也要兜；`tiers: []` 会返回 `fontSize: undefined` / `visibleCount: -1`（越出 `FitLyricResult` 契约，生产传不到）；
  `LYRIC_CARD_THEME` 与 `DARK_CARD_THEME` 是**同一个对象引用**且 `CardTheme` 全可变 ⇒ 主题对象只读用，原地改一个会把音乐深色卡一起改了。
- Task 4/8 留的：`saveTarget.ts:88` 卷名判据 `/^[A-Za-z0-9-]{4,}$/` 会把 `download:` / `images:` 这类伪前缀认成卷名 → bogus `/storage/download/…`，扫描在 `void …catch` 里静死
  （收紧办法：按 `ref.authority === 'com.android.externalstorage.documents'` 判，别看字符集）；`saveCard.ts:32` `existsFile(...).catch(() => false)` 把"探测报错"和"文件不存在"折叠成同一个结论
  → 极端情况会覆盖上一张海报（计划逐字要求，plan-mandated）；测试补强：`isDirGranted` 缺 `primary:Music` vs `primary:Music2` 夹具（现在 `startsWith` 的错误实现能全过）、
  `share-card-file-name.mts:22` 的 `<= 80` 应写成 `<= 72`、`'lyric-poster'` 回落与控制字符半支无断言、`childRealPath` 的无冒号/空相对路径/`/sdcard/` 三支无断言。
- 渲染成本：`fitLyricBlock` + `lines.slice` 每次渲染都跑；四个默认导出是匿名箭头，React DevTools 里显示空白条目。
- **合并卫生**：`ShareModeSheet` 现在在（仍未跟踪的）`src/components/player/SheetThemeProvider.tsx` 之外，两边都改 `Header` 的渲染区 ⇒
  玻璃那支合进主干时**要把 `<ShareModeSheet>` 包进那个 provider**，否则在动态封面上会读成"半透明黑纱浮在糊图上"。
- **"单独 checkout 能不能编译"至今只是静态判定**（评审做了四项闭合）。要真验得 `git worktree add` 出一份干净树跑 tsc，那要再装一份 `node_modules`（本机磁盘空闲不足），留给对外发布前。

### 11.7 提交链（`a6c1744..01680db`：代码 14 笔 + docs 11 笔）

代码：`2410e79` spike 装 view-shot 3.8.0 + 探针 · `5b8a56a` `fitLyricBlock` + `cardTheme`（Task 2/3 合笔，代价：将来不能单独 revert）·
`9147879` `getCoverAverageArgb` + `averageArgbOfPixels` · `59a908b` `CoverImage` · `cff62d0` `6e65168` 就绪上报两轮修 ·
`c2d0854` `ShareCard` 两层结构 + `BrandLine` + 删探针 · `41f4181` 两处高度预算 · `0a5c438` `captureRef` 导出 + FileProvider 分享 ·
`dfadbb8` `shareImage` 桥补 `return` · `97391d4` SAF 保存 + `shareCard.savePath` · `e5adab7` 预览 Modal + 5 枚 key ·
`d853eb6` 按钮层不吃字号缩放 + catch 留原始错误 · `01680db` 头部入口 + 4 枚 key。
docs（回改，不计入代码数）：`e2eff3f` `1452958` `7d0a6ea` `f904374` `a4dd9b3` `a0f0196` `48454dc` `a20b02a` `2757fd3` `701631f` `e80afc7`。
执行现场与逐条裁定见 `.superpowers/sdd/2026-10-16-share-card-image/progress.md` 及同目录各 `task-N-report.md`。

### 11.8 卫生（读历史时别误判）

- 本功能全程用"HEAD + 本次改动"的定向入索引。共享文件（`package.json`、三份 `src/lang/*.json`、`Header.tsx`、`src/utils/monet/*`、`src/utils/fs.ts`、
  `app_setting.d.ts`、`defaultSetting.ts`）里**别人的未提交 WIP 一行都没进提交**，也一行都没被清理掉；代价是每个任务多两步还原。
- 工作区里歌词工具页 / 下载 / 莫奈动态背景 / 玻璃 Sheet 那几支 WIP 仍**未提交** —— 这正是 Task 10b 与 §11.5 两份重复挂起的根因，不是遗漏。
- 从这个工作树产出的 APK 只用于验证，**不是发布候选**：它把那批未提交 WIP 一起打进去了。
- iOS 一行没写，与本文 §10 一致：`src/utils/nativeModules/utils.ts` 在模块顶层解引用 `NativeModules.UtilsModule`，`ios/` 侧没有对应实现（grep `ios/**` 零命中）→ 这条路本来就只有安卓通。
