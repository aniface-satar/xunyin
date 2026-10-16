# 分享图设计（Apple Music 风格分享卡 + 歌词海报）

日期：2026-10-16　状态：已定稿，待实现
落地计划：`docs/superpowers/plans/2026-10-16-share-card-image.md`（待 writing-plans 生成）

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

**下载（复用 SAF 三件套）：**

- 走 `ensureUsableSaveDir` / `publishFile` / `scanPublishedFile`（`src/core/download/target.ts`）—— 已在安卓 16 真机验通的那条链路。
- 但用**独立的 setting key** `shareCard.savePath` / `shareCard.savePathName`，不让海报混进下载的音乐文件里。
- 首次点击弹系统文件夹选择器；同名不覆盖沿用 `uniqueChildName`（会堆 `(1)(2)`，已知行为，本次不改）。
- 两枚按钮点击期间禁用 + 转圈，防重复导出。

## 6. 入口

| 入口 | 改法 |
| --- | --- |
| `Lyric.tsx:501` 的 disabled「歌词海报」 | 接上 `onPress` → 进预览页，歌词卡 |
| `PlayDetail/Vertical/components/Header.tsx:103` 分享图标 | 现在直接分享文本；改成先弹小面板「分享文字 / 分享图片」 |

头部这里选"多弹一层面板"而不是"把文本分享悄悄换成图片"：分享本来就是要用户挑目标 App 的动作，多一次点击成本很低，改掉既有行为的回归风险更高。

## 7. 文件清单

**新增依赖**：`react-native-view-shot@4.0.3`（精确锁版本）

```
新增  src/components/ShareCard/index.tsx        两层结构 + 明暗判定接线
新增  src/components/ShareCard/MusicCard.tsx    音乐卡内容
新增  src/components/ShareCard/LyricCard.tsx    歌词卡内容
新增  src/components/ShareCard/cardTheme.ts     纯判据：tone → { bg, ink, scrim }
新增  src/components/ShareCard/fitLyricBlock.ts 纯判据：行集 → 字号档/截断
新增  src/components/ShareCard/CoverImage.tsx   私有封面组件（自带 onLoad 门控）
新增  src/utils/shareCard/export.ts             captureRef → 文件路径
新增  src/components/ShareCard/ShareCardModal.tsx  全屏 Modal + 右上角两枚按钮
新增  src/resources/images/app-icon-glyph.png   从 ic_launcher_foreground.png 复制
改动  src/screens/PlayDetail/Vertical/Lyric.tsx      接上海报按钮
改动  src/screens/PlayDetail/Vertical/components/Header.tsx  分享弹面板
改动  src/utils/monet/index.ts + coverPalette.ts     加 getCoverAverageArgb 出口
改动  android/.../utils/UtilsModule.java             加 shareImage
改动  src/types/app_setting.d.ts                     shareCard.savePath / savePathName
改动  src/lang/{zh-cn,zh-tw,en-us}.json              文案
改动  package.json                                   新依赖
```

**明确不改的**：`src/components/common/Image.tsx`。`ShareCard` 里的 `CoverImage` 直接包 RN 的 `<Image>`，从 `Image.tsx` import 已导出的 `defaultHeaders` 常量，自己拿 `onLoad`。共享组件零改动 → 横屏零风险，也避开歌词页踩过的那次 memo 比较器坑。

## 8. 三条生死探针（先跑通，再写正式代码）

0. **能不能编译**（这条排最先，2026-10-16 已跑，**结论：`4.0.3` 不通过，改锁 `3.8.0`**）。
   详见 §2。`3.8.0` 的编译与 autolink 结论见实施计划 Task 1 的报告；三条真机探针因设备未连暂缺，跑完再往下面逐条补。

1. **`blurRadius` 会不会被 `view.draw()` 拍到。** Fresco 的模糊是烘进位图的，理论上能；但这条不验我不敢往下写。
   退路：用 monet 已有的像素 + `png.ts` 自己编码一张模糊小图当底 —— 仍然零新依赖。
2. **远程封面（需要 UA header）是否真的加载完才拍。** 靠 `CoverImage` 的 `onLoad` 门控。不通过的话会拍到空图/占位图。
3. **全屏 Modal 拍出来含不含状态栏。** 含则给容器加 `paddingTop`，或改 `statusBarTranslucent` 后重排。

三条都在真机上跑，任何一条挂了就回到本节改设计，不要绕过。

## 9. 测试

- 纯函数 `fitLyricBlock` / `cardTheme`（tone 分档、回落分支）：`node --test`，零 import。
- Java：`compileDebugJavaWithJavac` 过编译。
- 闸门：tsc + eslint；判据只 grep 自己改过的文件（总数会随别人未提交的 WIP 漂移）。
- 真机清单（vivo + 另一台）：
  1. 亮封面 → 白卡黑字；2. 暗封面 → 深卡白字；3. 本地歌无封面 → 深卡 + 占位；
  4. 选 1 句歌词；5. 选 20 句撑爆 → 缩字号、再截断补 `…`；6. 带翻译行的选段；
  7. 首次「下载」弹授权、文件在系统图库可见；8. 分享面板收到的是图不是文本；
  9. 右上角两枚按钮没有出现在导出图里；10. 预览页返回键退出而不是一退两级。

## 10. 范围外

- **横屏完全不参与**（用户明确要求）。功能只在 `PlayDetail/Vertical` 这条树上，新页面按现有竖屏约定写。
- iOS 不做验证（`view-shot` 有 podspec，理论上能编过，但本次不测、不写 `.mm`）。
- 不改 `shareText` 的现有文本分享行为。
- **其它分享入口本轮一律不动**，保持纯文本：`OnlineList/listAction.ts:31`、`Mylist/MusicList/listAction.ts:71`、`Recommend/index.tsx:430`、`MusicRecognition/ResultSections.tsx:79`、`SonglistDetail/Header.tsx:102`。分享图只做播放页头部 + 歌词海报这两个入口。
- 不做二维码、不做多模板/配色自选、不做海报历史。
- ~~不改 `file_paths.xml`~~ → **要改**：加一条 `external-cache-path`（见 §2 的 2026-10-16 更正），`3.8.0` 会把临时图写进外置缓存。
