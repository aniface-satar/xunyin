# 分享图设计（Apple Music 风格分享卡 + 歌词海报）

日期：2026-10-16　状态：音乐卡一支**代码已落地**（`feat/music-recognition-phase1`，任务范围 `a6c1744..01680db` =
**代码 14 笔 + docs 回改 11 笔**；其后的 Task 11 回写是 `f586df3`，整分支终审又落了一轮**代码修复 4 笔**
`442e652` `90efe28` `62baeda` `52e1f28`（见 §11.9），**代码到 `52e1f28` 为止**，即 `a6c1744..52e1f28` = **代码 18 笔 + docs 12 笔**；
Task 11 文档轮的收尾是 **`c9970d8`**（补 §11.9、真机第 18 条与全部更正 = docs 第 13 笔），**含本笔**（把整仓 `npm test` 的复跑实测与出处补回 §11.1/§11.9-5）= docs 14 笔；链见 §11.7）、
静态闸门全过；**真机一条没跑**（写这份状态时 `adb devices` 为空），§8 剩下的**两条**生死探针（第 3 条"状态栏进不进图"已由代码判定，见 §8）与 §9/§11.4 的验收清单仍是未闭合的门；
**歌词海报一支（`mode: 'lyric'`）只有代码没有入口**，宿主 UI 不在 HEAD。本文 §2/§5/§6/§7 的字面表述有若干处与最终实现不一致，
**§1 那两张表写的是"写 spec 时的工作区形态"**（`Lyric.tsx` 的「歌词海报」按钮、`measureArgbPixels` 两样都不在 HEAD 里，
`CoverBackdrop` 的行号也跟着变了），各表已就地标注 —— **先读文末 §11「落地与偏离」**再按本文改代码
落地计划：`docs/superpowers/plans/2026-10-16-share-card-image.md`（11 个任务，Task 1–10 执行完，Task 10b 挂起）

参考图三张（Apple Music 实拍）：亮封面 → 白卡黑字；暗封面 → 深卡白字；歌词分享 → 半透明深卡压在虚化封面上。

## 1. 要解决的问题与现状

两件事各自缺的东西不一样，先分开说清：

| 现状 | 位置 | 结论 |
| --- | --- | --- |
| 分享音乐 = **纯文本**（"歌名 - 歌手" + 网页链接），或复制到剪贴板 | `src/utils/tools.ts:343-371` → `UtilsModule.shareText`（`text/plain`） | 没有图片这条路 |
| 歌词工具栏的「歌词海报」按钮 = **disabled 空壳，没有 `onPress`** | `src/screens/PlayDetail/Vertical/Lyric.tsx:501-503` | 海报整个功能不存在。**注（2026-10-17 复核）**：这一行是**写 spec 时的工作区形态** —— HEAD 的 `Lyric.tsx` 里连「海报」二字都没有（`git show HEAD:src/screens/PlayDetail/Vertical/Lyric.tsx | grep -c 海报` = 0），那 187 行宿主 UI 至今未提交 ⇒ 见 §6 的 Task 10b |
| 选行、翻译行拼接、全选/反选逻辑已实现且零 import | `src/core/lyricCopy.ts` | 海报的行集直接复用，不另立判据。**注**：该文件同样**未进 git**（`git ls-files src/core/lyricCopy*` 空输出） |
| 封面模糊底、取色、明暗判定已实现 | `CoverBackdrop`（`blurRadius: 90`）、`src/utils/monet/*` | 三块难啃的都不用新写 |
| `react-native-view-shot` / `svg` / `skia` / `expo-*` / `react-native-share` **一个都没装** | `package.json` | 唯一需要选型的地方：用什么把卡片变成一张图 |

**已有的可复用资产**（决定了本方案几乎不写新算法）：

- 模糊：RN 核心 `<Image>/<ImageBackground>` 的 `blurRadius`，Android 侧走 Fresco（`ReactImageView.java:222`）。项目里 HEAD 的 `CoverBackdrop/index.tsx:9` 用的就是 `BLUR_RADIUS = 90`（**注**：工作区那份未提交的 WIP 已把它拆成 `WASH_BLUR_RADIUS = 90`(`:13`) 与 `COVER_BLUR_RADIUS = 9`(`:17`)，见 §11.3-10）
- 取色：`getArgbPixels(url, maxSize=128)`（`PaletteModule.java`）自己下载/读本地封面并吐 ARGB 数组；JS 侧 HEAD 跟踪的导出是 `averageArgbOfPixels`（`sourceColor.ts:77`，只要全图平均色）与 `analyzeArgbPixels`（`:151`，返回 `{ source, average, highlight }`），像素层按 url 做 LRU 缓存（`coverPalette.ts`，`PIXEL_LIMIT = 20`。**注**：本行原写 `measureArgbPixels → { average, highlight }`，那是**写 spec 时工作区里动态背景 WIP 的形态，跟踪的 `src/` 里 0 命中**；分享卡实际用的是 `averageArgbOfPixels`，两份的收口条件见 §11.5 第 1 条）
- ~~落款图标：`android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` 实测是 432×432 RGBA、四角 alpha=0、字形色 `#02AABB`（解 IDAT + 反滤波验证过）。**透明底，白卡黑卡都能直接放，不需要抠图。**~~
  → **这句判据错了，错在量法**（2026-10-17 真机看图后返工，全貌见 §11.10）：四角 alpha=0 只说明**画布角落**透明，量不到墨迹外面那圈**不透明的白色圆角方片**——前景图本来就是"白方片 + 青字形"的两层合成。
  直接把这张图放到深色卡上就是一块白斑，而且白方片吃掉约 2/3 的盒子，真正落到唱片上的只有约 9.4dp（"图标太小"的根因）。
  现在资源表里那份 `app-icon-glyph.png` 已经是**抠过底、按墨迹外框裁过**的字形本体，不再是前景图的副本。

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
- 捕获方式是 `view.draw(canvas)`（`ViewShot.java:370`；2026-10-17 对着装的这份 `3.8.0` 重核过行号，原写 `:382` 偏了），不是截图。
- 默认 `result: 'tmpfile'` 落在**内外置缓存里剩余空间大的那个**（`3.8.0`：`RNViewShotModule.java:172-189`，`externalCacheDir.getFreeSpace() > internalCacheDir.getFreeSpace()` 就用外置），真机上通常是 `/storage/emulated/0/Android/data/<pkg>/cache/`。`AndroidManifest.xml:107-117` 已声明 FileProvider，但 `res/xml/file_paths.xml` 只有 `<cache-path name="cache" path="/" />` → **`file_paths.xml` 必须补一条 `<external-cache-path name="external-cache" path="/" />`**（原写"不用改"，错）。不补的表现：`FileProvider.getUriForFile` 对外置缓存路径抛 `IllegalArgumentException`，分享按钮点了报错，而且换一台存储布局不同的机器结果就变了。
- `html2canvas` 只出现在 `src/RNViewShot.web.js`，Metro 走 `.js` 分支，**不进包**。

## 3. 卡的两层结构

```
底层  ImageBackground(封面, blurRadius: 90) + scrim      ← 铺满整张图
卡层  圆角 20（原写 28，§11.10 收小）/ padding 20 / 宽 = 屏宽 × 78%   ← 内容随形态不同
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

落款统一为：`app-icon-glyph.png`（**只剩青色墨迹**的字形本体，`14×13.1`dp，盒高对齐 `Music` 那 17dp 字号的大写高度）+ 紧跟 `Music` 两个字母，**不带 App 名**，完全对齐参考图 ` Music` 的排布。
尺寸与抠底怎么定的见 §11.10；这一行原写"约 18-20dp"，那个盒子实际被白方片占掉大半。

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

- `captureRef` 打在最外层容器，**不传 `width`/`height`**：view-shot 是"按视图尺寸画 → `createScaledBitmap`"（`ViewShot.java:428`，同一份 `3.8.0` 里重核过），传尺寸只会拿到放大后的糊图；不传就是设备原生像素。
- **右上角两枚按钮必须在 ViewShot 容器外面**的独立 absolute 层，否则会被拍进图里。

**分享（新增 `UtilsModule.shareImage(path, title, text)`）：**

- `FileProvider.getUriForFile` + `EXTRA_STREAM` + `image/png` + `FLAG_GRANT_READ_URI_PERMISSION`。
- 不复用现有 `shareText`：它压根装不下流 —— `UtilsModule.java:265-271` 只有 `setType("text/plain")` + `EXTRA_TEXT`/`EXTRA_SUBJECT`，**整个 intent 里没有 URI**（`fromFile` 在这个文件里 0 命中）。新函数单独一条路，顺手也保证 `shareText` 的行为不受影响。
  **落地更正（2026-10-17 复核）**：本行原写"它用 `Uri.fromFile`，安卓 7+ 收端 `FileUriExposedException`"——**两处都不成立**（Task 7 评审已证伪并改过 Java 注释，spec 漏改）。`file://` 那条坑是**我们自己的**：StrictMode 是在**暴露方**调 `startActivity` 时抛 `FileUriExposedException`，不是收端抛；只要我们把 `file://` 塞进 `EXTRA_STREAM`，炸的是点分享这一头的进程。`shareImage` 走 FileProvider 正是为了不走那条路。
- **落地更正（2026-10-17）**：实际签名多一个入参 —— `shareImage(path, authority, shareTitle, title, text)`，authority 由 JS 侧传 `APP_PROVIDER_NAME`（`src/config/constant.ts`），Java 不硬编码 `cn.toside.music.mobile.provider`。
  另有一处**必须是 `return NativeModules.UtilsModule.shareImage(...)`**：Java 方法末尾带 `Promise` 参数时，legacy bridge 判定为 `METHOD_TYPE_PROMISE` 并**返回一个 Promise**（`JavaMethodWrapper.java:220-221` → `NativeModules.js:98-121`）；
  漏掉 `return` 会让外层包装函数立刻 resolve，三处 `promise.reject`（`:281` 文件不存在 / `:288` FileProvider 拒 / `:304` 包 `startActivity` 的 catch —— `activity == null` 的 NPE 与 `ActivityNotFound` 都折进这同一处，所以**三个点覆盖四类原因**）全变成 unhandled rejection，表现就是"点了分享没反应"，而预览页两枚按钮永远 catch 不到东西（`dfadbb8` 修的就是这条）。

**下载（自带 SAF 判据）：**

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
| `Lyric.tsx:501` 的 disabled「歌词海报」（**写 spec 时的工作区形态**，HEAD 的 `Lyric.tsx` 里没有这枚按钮） | 接上 `onPress` → 进预览页，歌词卡 | **未做，挂起为 Task 10b**：宿主那批改动（`Lyric.tsx` +187/−13）与它要消费的 `src/core/lyricCopy.ts` 全都没进 git（`git ls-files src/core/lyricCopy*` 空输出），接上去这笔提交单独 checkout 编译不过。于是 `mode: 'lyric'` 这条路**代码在、无用户入口** |
| `PlayDetail/Vertical/components/Header.tsx:103` 分享图标 | 现在直接分享文本；改成先弹小面板「分享文字 / 分享图片」 | **已做**（`01680db`）：新增 `ShareModeSheet.tsx`（162 行，两行面板；它在 `src/screens/PlayDetail/Vertical/components/`，参考实现 `MusicMoreSheet.tsx:159-230` 在 `src/screens/PlayDetail/Vertical/Player/components/`，**不是同一个目录**），`share()` 只负责 `shareSheetRef.current?.show()`，文本那一支仍原样调 `shareMusic(shareType, downloadFileName, musicInfo)` |

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
新增  src/screens/PlayDetail/Vertical/components/ShareModeSheet.tsx  分享方式两行面板（§7 原没列）  ★ 本计划新增
新增  src/resources/images/app-icon-glyph.png   ~~从 ic_launcher_foreground.png 复制~~ → **抠底 + 按墨迹外框裁过的派生图**
                                                2026-10-17 首落地是 432×432 / 72,708 B 的原样复制；§11.10 返工后为 **218×204 / 20,930 B / md5 `a31072c6…`**
                                                **更正（2026-10-17 复核，这条仍然成立）**：原写"md5 与源文件一致"**不成立** —— 仓库跟踪的那份
                                                `mipmap-xxxhdpi/ic_launcher_foreground.png` 是 77,438 B / md5 `5e237a32…`，两者不同；
                                                旧 glyph 对得上的是**当时工作区**那份未提交的图标改版（`git status` 里那个 ` M`）。
                                                ⇒ 耦合关系变了，而且更硬：这份资源现在是**派生图**，不是任何文件的副本。
                                                图标 WIP 若被回退，落款会和出厂启动图标不一致（原来那条，无闸门会红）；
                                                **更危险的反向操作是"顺手把 `ic_launcher_foreground.png` 再复制过来"** —— 那会把白色圆角方片原样带回来，
                                                而它在浅色卡上几乎看不出来。启动图重画后要改落款，请重跑 §11.10 的抠底脚本，不要复制。
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
改动  package-lock.json                              view-shot 3.8.0 及其依赖的锁   ✅ 落地（§7 原没列，§11.2 有它）
改动  src/utils/fs.ts                                解冻 copyFile 那一行            ★ §7 原没列
```

**明确不改的**：`src/components/common/Image.tsx` —— 实际零改动（`CoverImage.tsx:4` 只 import 它的 `defaultHeaders`）。从 `Image.tsx` import 已导出的 `defaultHeaders` 常量，自己拿 `onLoad`。共享组件零改动 → 横屏零风险，也避开歌词页踩过的那次 memo 比较器坑。

## 8. 三条生死探针（先跑通，再写正式代码）

0. **能不能编译**（这条排最先，2026-10-16 已跑，**结论：`4.0.3` 不通过，改锁 `3.8.0`**）。
   详见 §2。`3.8.0` 的编译与 autolink 结论见实施计划 Task 1 的报告；三条真机探针因设备未连暂缺，跑完再往下面逐条补。
   补记（2026-10-17，Task 11）：`assembleDebug` BUILD SUCCESSFUL（1m14s）、Metro bundle exit 0、
   `PackageList.java` 里 `RNViewShotPackage` 命中 2 次、`RNViewShotModule.class` 进了 javac 产物 —— **编译这一条已经闭合**。

**探针 1/2/3 到 Task 11 为止一条都没跑**（`adb devices` 从 Task 1 到本次全程为空）。
**⚠️ 更正（2026-10-17 复核，原写"APK 已产出躺着，插上手机 `adb install -r` 即可"——错，别照它装机）**：
磁盘上那份 `android/app/build/outputs/apk/debug/xunyin-v1.1.0-arm64-v8a.apk` 的 mtime 是 **2026-10-16 23:26:39**，
而 Task 1 自己那笔提交 `2410e79` 的时间是 **23:38:53** ⇒ 这份产物**比本分支第一笔代码还早**，
里面既没有 `shareImage`、也没有 SAF 保存、预览 Modal 与头部入口，装上手机跑出来的结论全是假的。
**插上手机的第一件事是重跑 `cd android && ./gradlew assembleDebug`，装新产物。**
ETA 口径（按本仓库惯例记死）：纯 JS 改动的增量 debug 构建 **2–3 分钟**；本分支这段范围动过 Java
（`android/` 下只有 `UtilsModule.java` 与 `res/xml/file_paths.xml`，见 §11.2），所以**按 6–8 分钟预算**。
Task 6 的铺底层与 Task 9 的状态栏留白**按"探针全过"写完并入了 HEAD**，所以下面 **1/2 两条现在是负债而不是结论**
（第 3 条已被代码判定，见下），判据是图本身不是 `exists=true`：

1. **`blurRadius` 会不会被 `view.draw()` 拍到。** Fresco 的模糊是烘进位图的，理论上能；但这条不验我不敢往下写。
   退路：用 monet 已有的像素 + `png.ts` 自己编码一张模糊小图当底 —— 仍然零新依赖。
   挂了的返工范围：`src/components/ShareCard/index.tsx` 底层那一块（`BLUR_RADIUS = 90` 那发 `ImageBackground`）。
2. **远程封面（需要 UA header）是否真的加载完才拍。** 靠 `CoverImage` 的 `onLoad` 门控。不通过的话会拍到空图/占位图。
   挂了的返工范围：`CoverImage` 的 ready 上报（§11.3-5 那两轮返工的成果要重做），`onReadyChange` 那条就绪链跟着作废。
3. ~~**全屏 Modal 拍出来含不含状态栏。**~~ → **已由代码判定：恒为"不含"，不必上机**（2026-10-17 终审收掉，见 §11.9）。
   理由：我们这条路是 `captureRef` → `ViewShot.takeSnapshot(view, …)` → **`view.draw(canvas)`**（`ViewShot.java:370`），
   画布只覆盖那一个 view 树；状态栏/导航栏是 SystemUI 自己的窗口，`view.draw()` 拍不到独立窗口，所以"状态栏进不进图"
   这个问题在 `view.draw` 路线上永远为否。（`captureScreen` 那条 API 才涉及截屏，本功能没用它。）
   **剩下的真问题只有一个**：导出矩形的高度 —— `ShareCardModal` 用 `useWindowSize().height` 并在按钮层留
   `paddingTop: statusBarHeight + 6`（那层在被拍容器**外面**，它只是按钮内缩，不影响成品图），
   而 `windowSizeTools.ts:42-53` 有两条分支（原生 px÷scale **不加**状态栏 / 兜底 `Dimensions` **主动加**）——
   两条分支下导出矩形高度差一个状态栏，**哪条在真机上生效没人验过**，所以"卡居中居中得对不对、上下留白多少"仍要上机看观感。

顺带一条同一批未验的前提：**`NativeModules.RNViewShot` 在运行时非 undefined 也没在设备上确认过**（autolink 只证到编译期）。

**1/2 两条**都在真机上跑，任何一条挂了就回到本节改设计，不要绕过（第 3 条已由代码判定，见上）。

## 9. 测试

- 纯函数 `fitLyricBlock` / `cardTheme`（tone 分档、回落分支）：`node --test`，零 import。
- Java：`compileDebugJavaWithJavac` 过编译。
- 闸门：tsc + eslint；判据只 grep 自己改过的文件（总数会随别人未提交的 WIP 漂移）。
- **落地情况（2026-10-17）**：5 个用例文件都进了 HEAD 且**都登记在 `package.json` 的 `test` 脚本里**（没登记的用例不会跑，这条查过）——
  `tests/share-card-fit-lyric-block.mts`（**12** 条：9 条档位/截断 + `90efe28` 加的 3 条源码扫描，见 §11.9-2）、`tests/share-card-theme.mts`（7 条，含实测的 118/119 翻转点）、
  `tests/monet-cover-average.mts`（5 条，Task 4 平均色）、`tests/share-card-file-name.mts`（**7** 条：5 条 + `52e1f28` 加的 2 条前缀判据，见 §11.9-4）、
  `tests/share-card-save-target.mts`（11 条 tree URI 判据）。`52e1f28` 上实测这五个文件 **42 pass / 0 fail**（修复轮前是 37），本笔收尾时复跑仍是 42/0。
  另记一笔：整仓 `npm test` 在 Task 11 那轮（跑在修复轮之前）= **685 / pass 684 / fail 1**；**修复轮之后复跑过 = 690 / pass 689 / fail 1**（本控制在 `c9970d8` 上实跑，2026-10-17 14:08 连跑两遍，两遍同数，红的仍是既有的 `tests/monet-texture.mts:68`）。
  多的 5 条是别的会话这期间新增的用例，本功能自己的 42 条一条没变；唯一那条红两次都是既有的 `tests/monet-texture.mts:68`（本轮实测 `正文区 tone 89.84 越界（带 72~88）`，纹理支故意红），
  本功能既没把它改绿也没让它更红 —— **总数随别的会话 WIP 漂移，只当参考、不当契约**。
  实测数与判据见 §11.1。
- ~~真机清单（vivo + 另一台）：1…10~~ → 这份 10 条的草稿已被计划 Task 11 Step 3 的 **13 条**取代（多出"同名不覆盖""杀进程不再弹选择器""savePathName 存的是可读名字"三条 SAF 判据），
  再叠加 Task 7 要求补的两条（反复分享 10 次、非 Pixel OEM chooser）与终审修复轮补的三条（冷像素缓存首帧、系统字号 1.3、延迟触发的选曲快照）⇒ **现在共 18 条**，
  其中 11/12 两条的一半已降级为"静态判定 + 真机复核观感"（见 §11.4 表下说明）。**全部挂起未跑**，逐条原文与阻塞原因见 §11.4。

## 10. 范围外

- **横屏完全不参与**（用户明确要求）。功能只在 `PlayDetail/Vertical` 这条树上，新页面按现有竖屏约定写。
- iOS 不做验证（`view-shot` 有 podspec，理论上能编过，但本次不测、不写 `.mm`）。
- 不改 `shareText` 的现有文本分享行为。
- **其它分享入口本轮一律不动**，保持纯文本：`OnlineList/listAction.ts:31`、`Mylist/MusicList/listAction.ts:71`、`Recommend/index.tsx:430`、`MusicRecognition/ResultSections.tsx:79`、`SonglistDetail/Header.tsx:102`。分享图只做播放页头部 + 歌词海报这两个入口。
- 不做二维码、不做多模板/配色自选、不做海报历史。
- ~~不改 `file_paths.xml`~~ → **要改**：加一条 `external-cache-path`（见 §2 的 2026-10-16 更正），`3.8.0` 会把临时图写进外置缓存。

## 11. 落地与偏离（Task 11 回写：2026-10-17）

Task 1–10 执行完 = **代码 14 笔**（`a6c1744..01680db`），其后的整分支终审又落了**一轮代码修复 4 笔**
（`442e652` `90efe28` `62baeda` `52e1f28`，见 §11.9）⇒ **代码收口在 `52e1f28`**（`a6c1744..52e1f28` = **代码 18 笔 + docs 12 笔**），Task 11 文档轮收尾是 `c9970d8`（链见 §11.7）。
**静态闸门全过；真机一次没跑** —— 写这份状态时 `adb devices` 仍是空列表（从 Task 1 到本次全程如此），
所以计划的 Step 2（gradle 构建装机）与 Step 3（验收清单，草稿 13 条 → 现在 **18 条**，见 §11.4）整体**挂起**：不是失败，是没有硬件。
§8 的探针 **1/2 仍无结论**（第 3 条"状态栏进不进图"已由代码判定，见 §8 与 §11.9-1），§11.5 两份重复仍不能合并，
`mode: 'lyric'` 那一支只有代码没有入口（Task 10b 挂起）。

### 11.1 闸门实测数（2026-10-17；下次别照抄本文其他处的旧数）

- `npm test`：**跑过两轮。Task 11 那轮（修复轮之前）= 685 / pass 684 / fail 1**（原始输出记在 `task-11-report.md`，评审也独立复现到同一串）；
  **修复轮之后 = 690 / pass 689 / fail 1**，由控制会话在 `c9970d8` 上实跑（文档子代理自己那一轮按约束没跑 `npm test`，所以它的报告里只有 685 那一串 —— 别把"它没跑"读成"没跑过"）。
  多的 5 条是别的会话这期间新增的用例，本功能自己的 42 条一条没变。
  **总数会随别的会话 WIP 漂移（那条红也一样会漂），判据只是"红的那条不是本功能的、且没有新增红"**，不拿总数对号。
  两轮红的都是既有的 `tests/monet-texture.mts:68`（`c9970d8` 上这次实测 `正文区 tone 89.84 越界（带 72~88）`，纹理支故意红，2026-10-15 预加载 spec §9.1 记的是同一条），
  本功能既没把它改绿也没让它更红。本功能 5 个文件单独跑（`52e1f28` 上实测，本笔收尾时再跑一遍仍是这个数）：
  `share-card-fit-lyric-block` 12、`share-card-theme` 7、`monet-cover-average` 5、`share-card-file-name` 7、`share-card-save-target` 11 = **42 条全绿**（修复轮前 37）。
- `npx tsc --noEmit`：**137 条 = 本机基线，一条没涨**（`52e1f28` 之后本笔收尾又复跑过一遍：还是 137，命中面没变）。
  **数法记死**：137 是 `grep -c "error TS"` 的数，**不是 `wc -l`** —— 本轮同一次输出 `wc -l` 是 **161**，因为 TS 的"原因说明"各占一行，照 161 对号会把人吓一跳。
  判据是"本功能创建的文件在输出里 0 次命中"——拿本分支提交里的全部 ts/tsx 路径 grep 过 tsc 输出，
  唯一命中是 `src/config/defaultSetting.ts(81,3): error TS2353: ... ''list.isClickPlayList'' does not exist in type 'AppSetting'`。
  那条**在 HEAD 就红**（`git show 01680db:src/types/app_setting.d.ts | grep -c isClickPlayList` = 0，那个键根本没声明过）。
  **更正（2026-10-17 复核）**：位移是**第 76 行 → 第 79 行**（`git show a6c1744:src/config/defaultSetting.ts` = 76，`git show HEAD:…` = 79，即本分支插的 3 行把它挪下去 3 行）；
  上面输出里的 **(81,3) 是当下这份工作区（带着别的会话 WIP）的位置**，不是分支上的位置，别把 81 当分支事实抄。
  `defaultSetting.ts` 是本功能**改动**的文件，不是本功能创建的。
- `npx eslint`：**没有跑计划里的 `npx eslint . --ext .js,.jsx,.ts,.tsx`** —— 工作区带着另一支会话的大批未提交 WIP，
  整仓 lint 报的是本分支既不该修也修不动的错。实际跑的是本功能自己的 21 个 ts/tsx（`git diff --name-only a6c1744..01680db` 里的 ts/tsx：
  13 个新建 + 8 个改动，含 `Header.tsx` / `sourceColor.ts` / `fs.ts` 这些带着别人 WIP 的共享文件）：两组都**静默、exit 0、0 error**。
- Java / 打包：Task 1 的 `assembleDebug` BUILD SUCCESSFUL（1m14s）、Task 7 的 `compileDebugJavaWithJavac` 与合好的 debug manifest
  （`cn.toside.music.mobile.provider` → `@xml/file_paths`，打包后的 `file_paths.xml` 确实带着新那条）都已过。
  Task 11 **没有重跑 gradle** —— 按裁定，没有设备就不装机，编译结论不会因为我再跑一遍而改变。

### 11.2 落了什么（`a6c1744..01680db`；其后修复轮 `442e652^..52e1f28` 见 §11.9）

新增 ts/tsx **13 个**（本文 §7 只列了 8 个）+ 用例 **5 个** + `app-icon-glyph.png`；改动既有文件 **8 个 ts/tsx + 2 个 android + 3 份 lang + `package.json`/`package-lock.json`**。
逐条状态在 §7 那张表里，这里只说 §7 完全没出现过的：

- **修复轮没有新增任何文件**（`git diff --name-status 442e652^..52e1f28` = 9 个文件、全是 `M`、没有一条 `A`；再与整分支 `a6c1744..52e1f28` 的清单逐项对得上）：它只改本分支已有文件
  （`ShareCard/index.tsx`、`ShareCardModal.tsx`、`MusicCard.tsx`、`LyricCard.tsx`、`BrandLine.tsx`、`ShareModeSheet.tsx`、`exportCard.ts`）
  并往**已登记**的两个用例文件里追加用例（`share-card-fit-lyric-block` +3、`share-card-file-name` +2）⇒ 上面的 13 / 5 两个数在 HEAD 仍然成立。
- `src/utils/shareCard/` 这一层实际是 **4 个**文件：`exportCard.ts` / `saveCard.ts` / `saveTarget.ts` / `cardFileName.ts`（§7 只给了 1 个）。
- `ShareModeSheet.tsx`（入库时 162 行，`62baeda` 之后 HEAD 是 183 行）与 `BrandLine.tsx` 是执行期间新增的拆层。
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
   ~~代价：那一层不吃字号缩放——按钮里是 `Icon size={22}` 不是文字，本来就不该缩~~ → **这条代价已被 `442e652` 收平**：两枚按钮都改成 `rawSize={22}`（`ShareCardModal.tsx:86/:89`，`common/Icon.tsx:55` 是 `size={rawSize ?? scaleSizeW(size)}`），字形与不吃字号缩放的 44/`borderRadius: 22` 药丸同坐标系，上面那句"本来就不该缩"从此不是解释而是实现。
   `paddingTop: statusBarHeight + 6` 一直是原始 dp。附带收益：老路径乘 375×667 设计稿比例会把 44 压成约 42，现在正好 44。
   **卡片内容层仍然用带类型标注的普通对象常量**（Task 5/6 定的 Step 0：卡内数字是原始 dp，必须与 `fitLyricBlock` 的高度预算同一坐标系）——同目录两种写法并存是有意的，别"顺手统一"。
5. **`CoverImage` 的就绪上报返工了两轮**（`cff62d0`、`6e65168`），计划原写法有两个真 bug：
   ① `[uri]` 复位 effect 在 paint 之后跑，同一次 passive flush 里会先看到 `uri=B, loaded=true` ⇒ 给**没解过码的新封面**报一次 ready，Task 6 照它放行拍摄就拍到上一首的图（Fresco 换源保留旧 drawable）；
   ② 卸载清理挂在 `[onReady]` 上，父组件每次传新箭头都在活的子组件上跑一次 `onReady(false)`，而 `(uri, ready)` token 已消费、再没有 transition 能救回来——无封面那条路（ready 恒真）正好被永久钉死在"正在准备"。
   最终形态：`LoadState` 带 uri + 渲染期 setState（React 官方"prop 变化时调整 state"）+ `onReadyRef` 期间赋值 + `[]` deps 清理 + **`key={uri}` 重挂**（RN 图片事件只认当前挂载视图，否则晚到的旧图 `onLoad` 会打到新回调上、`s.uri === uri` 两边都是新的，判据形同虚设）。
   `onReady` 走 ref 不进 deps，父组件可以传内联箭头；`normalizeCoverUri` 必须保持返回**原始字符串或 null**（返回新对象会无限重渲染）。
   **补记（2026-10-17 终审）**：上面这套只管**卡封面那一路**。`442e652` 之后"能不能拍"的判据已经上移到 `ShareCard` 那层聚合三路，见 §11.9-1 —— 别把这一条当成整扇门。
6. **两处裸 `catch {` 补了 `console.error('[share_card] …', e)`**（`ShareCardModal.tsx:48` capture_failed、`:64` save_failed；2026-10-17 复核：`442e652` 之后行号从 46/62 漂到 48/64）。本仓库 release 构建不剥 console。
   `capture_failed` 那个 try 连分享面板一起包，日志标签范围略宽是**接受的**：收窄要把拍摄与分享拆成两步，不值。
7. **i18n key 的任务边界改过**：`t` 是 `(key: keyof Message, val?) => string`（`src/lang/i18n.ts:21`；2026-10-17 复核：原写 `:19` 偏了两行，`getMessage` 在 `:20`），`Message` 是三份语言 Record 的联合、`keyof` 取**交集**
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

**本轮中途接过一次真机**（vivo16，无线 adb，15:31–15:32 四张截图在 `.superpowers/sdd/2026-10-16-share-card-image/shots/01…04`）：
拿到了 **§8 探针 1（糊底拍得到）与探针 2（远端封面拍前解得出码）的预览侧证据**，以及第 1 条（亮封面 → 白卡黑字）的现场判定。
**仍然零证据的是**：`captureRef` 真正吐出来的那张**文件**（成品图一直没拉到过——临时 PNG 落在 App **内部** cache，非 debuggable 包取不到，只能走「保存图片」那条 SAF 路径拿），
以及第 4–15、17–19 条。装完 16:11 那支包之后，第 2 条起都可以顺手一起看。
**⚠️ 别拿 `apk/debug/` 那几支（10-16 23:26）装机** —— 它们比本分支第一笔代码还早，成因与"先重跑 `assembleDebug`"的口径见 §8（6–8 分钟预算）。
**`apk/release/` 16:11 那几支是当前的**（`a09204b` 之后重跑增量，`BUILD SUCCESSFUL in 2m 54s`）：含本分支全部代码 + §11.10 的字形与圆角，直接 `adb install -r -d` 就能跑这张表。
**字形进包的证明方法记一下**（release 会缩短资源路径，按名字在包里搜 `app-icon-glyph` 是搜不到的）：`assets/index.android.bundle` 里那串注册名只出现 1 次，真正的位图被 aapt2 改名 + 压成 `res/UN.png`（218×204、11,901 B，源文件 20,930 B）——
**按尺寸认而不是按名字认**；解开那一支实测 `opaque-white = 0`、四角 alpha=0，白方片确实没进包。
1–13 是计划 Task 11 Step 3 的原文清单，**一条都没有结论**；14/15 是按 Task 7 的要求补的；16–18 是终审修复轮（§11.9）新加的回归项；19 是落款字形返工（§11.10）。

| # | 验什么 | 判据 / 不通过长什么样 | 状态 |
| --- | --- | --- | --- |
| 1 | 亮封面（白色系专辑）→ 白卡黑字 | §3 的 `tone > 50` | **预览侧已过**（2026-10-17 15:32，`shots/04`：青绿封面 → 白卡 + 深色歌名）；**成品文件那一半仍挂起**（见上：只能走保存图片） |
| 2 | 暗封面（黑金专辑）→ 深卡白字 | 同上 | 挂起 |
| 3 | 本地歌无封面 → 深卡 + 空封面位不崩、导出按钮仍可用 | `averageArgb = null` 的回落分支；`442e652` 后三路都当场落定，按钮不该永远灰着 | 挂起 |
| 4 | 歌词卡只选 1 句 → 大字号、卡偏矮 | — | 挂起，**额外阻塞在 Task 10b**（本轮 `mode: 'lyric'` 无用户入口） |
| 5 | 歌词卡全选 20+ 句 → 先缩字号，缩到 16 还装不下就截断补 `…` | — | 同上 |
| 6 | 选带译文的段落 → 译文紧跟自己那行、字更小 | — | 同上 |
| 7 | 首次点下载 → 弹系统文件夹选择器，落地文件在系统图库里能看到 | `RNFS.scanFile(childRealPath(...))` 那条 | 挂起 |
| 8 | 点分享 → 系统面板收到的是 PNG 图，不是文本 | `shareImage` 整条链 | 挂起 |
| 9 | 导出图里**没有**右上角那两枚按钮 | §5 的分层承诺（按钮在被拍容器外面） | 挂起 |
| 10 | 预览页按系统返回 → 只关预览，不连带把播放页关掉、也不吞掉上一层 | `onRequestClose` | 挂起（歌词工具那一层要等 10b，本轮只测头部这条路） |
| 11 | 同一张海报**再保存一次** → 文件名是 `xxx (1).png`，不是覆盖 | 原写"这是 `existsFile(document URI)` 的唯一验法、认不出就一路堆 `(1)(2)(3)`"——**这一半已由库的源码静态判定**（下表下方那条说明）⇒ 不再是生死项，**真机只需复核观感**：`(1)` 这套命名用户认不认、图库里看不看得到 | 静态已定，挂起复核观感 |
| 12 | **杀掉 App 再进来**，直接点保存 → 不该再弹一次文件夹选择器 | `existsFile(裸 tree URI)` 那一半同样**已由源码静态判定**；剩下只有"**persistable 授权能不能活过进程杀死**"这一件是代码答不了的（`isDirGranted` 的祖先判定是 JS 判据，`share-card-save-target.mts` 那 11 条覆盖的是形状，还缺同层 `Music` vs `Music2` 夹具，见 §11.6） | 半静态已定；授权存活那一半挂起 |
| 13 | 选完文件夹后 `shareCard.savePathName` 里存的是可读名字（`Music` 这种），不是整条 `content://…` | `openDocumentTree` 返回值到底带不带 `name`，HEAD 里没人读过它（`src/core/common.ts:106-108` 只取 `.path`/`.isDirectory`）。取不到会回落成 URI，功能不坏但难看 —— **只记观感，不算验收失败** | 挂起 |
| 14 | **反复分享 10 次**：不炸、每次发出去的图都能打开 | 临时 PNG 的清理已改成"接库自带清扫"（`52e1f28`，见 §11.9-4）：名字带上 `ReactNative-snapshot-image` 前缀，让 `RNViewShotModule.java:150-152` 那条 `startsWith` 判据收得到它。**注意 3.8.0 的清扫只有一个实例化点**：`onCatalystInstanceDestroy`（`:56-58`）—— 类注释（`:122-126`）说"模块实例化时也跑"，但这份代码里没有 `initialize()` 重写 ⇒ 一次长会话里仍是攒着的，真机要看的是"重启/重载 JS 之后 cache 目录收干净了没"。**绝不能在 `shareCapturedCard` 返回后就调 `releaseCapture`** —— chooser 返回时用户还没选完收端，收端是之后才惰性读那个 content URI，删早了就是"分享出去打不开" | 挂起（判据已随 `52e1f28` 更新） |
| 15 | 至少一台**非 Pixel**（本机目标是那台 vivo）上验 chooser 真的收到图 | 读权限 grant **只加在内层 intent**：`UtilsModule.java:296` 在 `shareIntent` 上 `addFlags(FLAG_GRANT_READ_URI_PERMISSION)`，`:299` 才用 `Intent.createChooser(shareIntent, …)` 包一层，**外层没有再 addFlags** ⇒ OEM chooser 是不是把 grant 传给收端是经典翻车点 | 挂起 |
| 16 | **冷像素缓存**的亮封面：全新安装、这首歌没听过 → 进预览**第一眼**就是白卡 | §11.9-1 那条 Critical 的回归项。不通过长什么样：先出深卡再翻成白卡（现场翻色），或直接导出黑卡 ⇒ 说明 `ready` 没等够配色那一路（`ShareCard/index.tsx` 的 `paletteSettled`） | 本次新增，挂起 |
| 17 | 系统字号拉到 **1.3**（设置 → 显示 → 字体大小最大档）→ 落款 `Music` 仍在圆角卡**内**，卡内文字**没有**阴影 | §11.9-2 的回归项。不通过长什么样：落款溢出到糊底上（且在成品图里）、或字底带着用户主题的 `fontShadow` 阴影 ⇒ 说明漏了某枚 `allowFontScaling={false}` / `noShadow`（`tests/share-card-fit-lyric-block.mts` 的源码扫描只在 JS 侧数得平，真机要的是像素） | 本次新增，挂起 |
| 18 | 点「分享图片」后**那 200ms 里正好切歌**（自动下一首或手动切）→ 预览卡是哪一首 | `62baeda` 把 `onSelect` 推迟到面板退场落定（§11.9-3），代价是这一刻读的是**按下那一刻那次渲染**的 `playerState` 快照（`Header.tsx:58-66` 的 `handleShareMode` 每次渲染新建闭包，退场回调抓住的是点击当时的 `onSelect`）⇒ 卡片锁旧歌、身后的播放页可能已经显示下一首。**这是设计代价不是 bug**：真机要确认的只有"不一致只存在于预览屏幕，导出的成品图里没有任何播放页元素" | 本次新增，挂起 |
| 19 | 落款字形（抠过底、`14×13.1`dp）在**真机**的亮封面与暗封面各看一眼：① 唱片上那些透明细纹在 4.4× 降采样后还认得出吗 ② 和 `Music` 的 `M` 是不是等重 ③ 圆角 20/12 要不要再收 | §11.10 的三条观感。**桌面 PIL 小样判不了 ①**（脚本的缩放和 Fresco 的双线性不是一条链路，且没有 mipmap）；不通过长什么样：细纹糊成一片实色青（那就得回到"给纹路留一层浅色"而不是抠底），或字标明显压过 `M`（判据在 `BrandLine.tsx:33-38` 的推导，×1.08 那一档是可调项） | 本次新增，挂起（包已构建、设备掉线没装上） |
| 20 | 预览**刚挂上那一两秒**用户看到的是什么 | 现场抓到的一帧：`shots/03`（15:31:53）是**一张纯白卡——封面位空着、歌名/歌手/落款全无**，12 秒后的 `shots/04` 才是完整卡。卡底已经按亮卡解析出来了 ⇒ 不是配色没到，是**子节点那一帧还没画**（`Modal animationType="fade"` + 首帧）。要判的是：这个空窗**人眼看不看得见**（截图是抓瞬间的，不代表停留时长）。看不见就记账；看得见就给卡内容也加一道淡入/骨架，**别动 `ready`** —— 那两枚按钮已经吃的是聚合门（§11.9-1），导出侧不会拍到空卡 | 本次新增（真机顺手抓到的），挂起 |

跑 1–3 / 7–19 之前，先把 §8 剩下的**两条**生死探针收干净 —— 探针 1/2 已在 15:31 那一次拿到**预览侧**证据（糊底拍得到、远端封面解得出码），剩的那一半是"**同一件事在 `captureRef` 出来的那张文件里也成立**"，只有走第 7 条那次真实保存才看得到；第 3 条"状态栏进不进图"已由代码判定为恒否，不必上机。
Task 6 的铺底层与 Task 9 的状态栏留白都是**按"探针全过"写的**，任何一条挂了要先回 §8 改设计，而不是在验收清单上打勾。

第 11/12 条为什么能**静态定**（2026-10-17 读的库源码，不是推断）：`existsFile` 落到
`node_modules/react-native-file-system/android/src/main/java/com/filesystem/FileSystem.java:80-83`（`exists` → `new FsFile(context, path).exists()`），
`FsFile.java:26-31` 见到 `content://` 就按 `isTreeUri(uri)` 分流到 `DocumentFile.fromTreeUri` / `fromSingleUri`，
而 `Utils.java:35-37` 的 `isTreeUri` 判据就是"**首段 path segment 等于 `tree`**"⇒ 裸 tree URI 与 document URI 都会走 DocumentFile 那条 exists，
不是恒 false。写入侧同名新建同理由 `Utils.java:184-193` 的 `DocumentsContract.createDocument(...)` 承担。
所以这两条从"生死"降为"复核观感"；**但静态判定不等于设备证据** —— 授权是否还在、`uniqueName` 的探测路径拼得对不对，仍要 12 条那一次杀进程来答。

第 11 条之外还有一条只能在这张表上验的：`fileName` 到不了收端手里（它是 `createTempFile` 的**前缀**，系统插随机数字，`safeFileName` 又把中日韩字符全换成 `_`），
所以"分享出去的文件名就是歌名"不成立 —— 歌名只走第 7/11/12 条那条保存路径。

### 11.5 本分支刻意留下的两份重复（都是为了"提交单独 checkout 也编译得过"；触发条件到了才收，现在收不了）

1. **`averageArgbOfPixels` ↔ 动态背景 WIP 的 `measureArgbPixels`**（同一件事：全图平均色）。
   现状（**`52e1f28` 上重新复验过，两条前提都还没到**）：`averageArgbOfPixels` 在 `HEAD:src/utils/monet/sourceColor.ts:77`，被 `coverPalette.ts:251` 的 `getCoverAverageArgb` 调用；
   `measureArgbPixels` 在**已跟踪的 `src/` 里仍 0 命中**（`git grep -n measureArgbPixels HEAD -- src/utils/monet/` 空输出；它只在这份工作区的 `sourceColor.ts:206` 里，
   即未提交的动态背景 WIP），⇒ 这一条**仍然收不了口**。
   **触发条件**：动态背景那支把 `measureArgbPixels` 提交进 HEAD 的那一笔。
   **收口动作**：`getCoverAverageArgb` 的实现改调 `measureArgbPixels` → **删掉** `averageArgbOfPixels`（`sourceColor.ts:72-102` 那一段）。
   两份实现插在**同一文件同一带**，WIP 提交时这里必起冲突；顺带把 Task 4 评审记的那三份"校验+累加求平均"（`:79/:82/:83` vs `:155/:159/:160`、`:88-95` vs `:165-172`、`:96/:97-101` vs `:173/:175-179`，
   `blockHighlightArgb` 里还有第三份通道求和）一起抽成 WIP 那份 `collectOpaque`。
2. **`src/utils/shareCard/saveTarget.ts` ↔ 下载 WIP 的 `src/core/download/safPath.ts`**（tree URI 的四条判据：授权覆盖、document URI 探测、docId 反推真实路径）。
   现状（`52e1f28` 上复验）：`git ls-files src/core/download/` **仍是空输出**、`safPath.ts` 仍是未跟踪文件 ⇒ 现在合并就等于让 `saveCard.ts` 依赖一个不在库里的模块（与 Task 4 否掉 `measureArgbPixels` 同一类边界）。
   **触发条件**：`src/core/download/` 进 HEAD 的那一笔。
   **收口动作**：`saveCard.ts` 改成从那边 import → **删** `src/utils/shareCard/saveTarget.ts` **和** `tests/share-card-save-target.mts`，
   同时把后者从 `package.json` 的 `test` 脚本里摘掉（那边自己的 `tests/download-save-path.mts` 覆盖同样语义）。
   合一后注意调用点形状：本分支 `saveCard.ts:48` 用的是裸 `joinSavePath`，参考实现把那一步叫 `childWritePath`。
3. **连带项**：`src/utils/fs.ts` 的 `copyFile` 那一行解冻由本分支（Task 8，`97391d4`）先进库；下载那支后续提交 `fs.ts` 时它不再出现在 diff 里，**属正常，不要重复添加**。

### 11.6 已知观感风险与 deferred minors（都不阻塞，别在闸门里当失败算）

- ~~**要脸的一条（只有真机能判）**：点「分享图片」时 `ShareModeSheet` 的 `handleSelect` 是**同步** `hide()` + `onSelect(mode)`，
  面板自己那层 Modal 还在 200ms 退场就把第二层 `ShareCardModal` 挂上去 ⇒ 安卓上两个 dialog 窗口重叠。~~
  → **已由 `62baeda` 从代码上改掉**（见 §11.9-3）：HEAD 的 `ShareModeSheet.tsx:70-71` 现在是 `hide(() => requestAnimationFrame(() => onSelect(mode)))`，
  照的是仓里现成的 `Player/components/MusicMoreSheet.tsx:131-135` 那条写法；「分享文字」那一支不叠窗口，保持立即触发（`:63`）。
  **仍欠真机一眼**：重叠没了，但"面板退场 → 预览浮现"衔接处会不会闪一下黑底，只有设备上能判 ⇒ 记在 §11.4 第 10 条一起做。
- ~~`ShareModeSheet.tsx:157-159`：`actionText` 丢了参考实现的 `flex: 1` ⇒ 字号 >1 或长译文时标签顶穿 `paddingHorizontal` 被裁，不出省略号。~~
  → **已由 `62baeda` 补回**（HEAD `ShareModeSheet.tsx:177-178` 有 `flex: 1`）。**一处引用要更正**：这条原写"参考实现（同目录 `MusicMoreSheet.tsx`）有 `flex: 1`"——
  HEAD 的 `Player/components/MusicMoreSheet.tsx:272-274` 其实只有 `{ marginLeft: 10 }`，带 `flex: 1` 的那份是**未提交的工作区版本**（`:292-295`）；
  即 62baeda 对齐的是工作区那份，不是库里那份。两个文件也**不在同一个目录**（`Vertical/components/` vs `Vertical/Player/components/`）。
- ~~`ShareModeSheet.tsx:44-53`：200ms 退场窗口内连点两行会同时做两件事（`hide` 有相位闸门，`handleSelect` 没有）。~~
  → **已由 `62baeda` 加闸门收掉**：HEAD `:37` 的 `exitingRef`，`:60` 一进 `handleSelect` 就 `if (exitingRef.current) return`，`:51-53` 退场回调里复位，`show()` 时（`:41`）也擦一次。
- **修复轮明知故留的两条 minor**：
  ① 上面那道闸门只挡 `handleSelect`，**没挡 `show()`**：面板还在退场时若被外部再 `show()` 一次，`src/utils/hooks/useSheetSlideAnimation.ts:73-76`
  那个**已经在飞**的 `Animated.parallel` 完成回调仍会跑到底 —— 它把 `phaseRef` 判成 `idle`、`setVisible(false)`、并把排队中的 `onSelect('image')` 放出去
  ⇒ 刚重开的面板被这一下再隐藏一次，预览 Modal 照样挂上。今天**从现有入口够不到**：退场那 200ms 里 `mounted` 还撑着（要到 `onDismiss` 才清，HEAD `:75`/`:87-89`），
  面板那层 dialog 窗口盖着播放页头部，第二次 `show()` 没有触发源 ⇒ 记负债不记 bug。**10b 若给歌词工具页也接这条链，回头补 `show()` 的闸门。**
  ② `52e1f28` 之后**收端看到的临时文件名多了 `ReactNative-snapshot-image_` 这段前缀**（`fileName` 是 `createTempFile` 的前缀，见 §11.4 第 14 条）。
  代价判为近零：中文歌名本来就被 `safeFileName` 整串换成 `_`，改前改后一样不可读，而换来的是库自己那条 `startsWith` 清扫终于收得到它。
- `Header.tsx:54-56`：没有在播曲目时现在也会先弹面板，两行都静默 no-op（HEAD 的 `share()` 是直接 return 的）。
- `{name, singer, pic}` + `'progress' in` 那支投影是全仓第 4 份私有副本 ⇒ 建议 10b 时抽成 `toShareCardData()`，顺带能单测。
- 两枚按钮禁用时没有任何视觉反馈（`disabled={busy || !ready}`，`TouchableOpacity` 禁用态不自动变暗）。
- `cardFileName(...)` 在一次保存里算两遍（临时名 + 落地名），改一处易漏另一处；拍摄进行中关 Modal → 子树卸载、`captureRef` reject ⇒ 在身后那层屏幕上弹一个"生成图片失败"。
- 分享按钮的 a11y label 复用了 `share_title_music`（"歌曲分享"是名词）；10b 手上有 key 名额时可加 `share_card_share`。
- Task 2/3 留的**四条**（ledger 记的是四条，本表原来只写了三条）：
  ① `fitLyricBlock.ts:64` 非有限 `maxHeight` 会**敞开通过**（`x > NaN` 恒 false → 全部行都算装得下），
  `ShareCard/index.tsx:111`（`442e652` 之后从 `:69` 漂到这里）已用 `Math.max(0, …)` 兜住，别的消费方也要兜；
  ② `tiers: []` 会返回 `fontSize: undefined` / `visibleCount: -1`（越出 `FitLyricResult` 契约，生产传不到）；
  ③ `LYRIC_CARD_THEME` 与 `DARK_CARD_THEME` 是**同一个对象引用**且 `CardTheme` 全可变 ⇒ 主题对象只读用，原地改一个会把音乐深色卡一起改了；
  ④ **`tests/share-card-theme.mts` 只断了 `cardBackground` 与 `titleColor`**（`:43`、`:47-50`），
  `subtitleColor` / `lyricColor` / `scrimColor` 三个值**一条断言都没有** ⇒ 改这三个字段不会有任何测试红（终审也点过"测试强度"这一类，本轮没动代码）。
- Task 4/8 留的：`saveTarget.ts:88` 卷名判据 `/^[A-Za-z0-9-]{4,}$/` 会把 `download:` / `images:` 这类伪前缀认成卷名 → bogus `/storage/download/…`，扫描在 `void …catch` 里静死
  （收紧办法：按 `ref.authority === 'com.android.externalstorage.documents'` 判，别看字符集）；`saveCard.ts:32` `existsFile(...).catch(() => false)` 把"探测报错"和"文件不存在"折叠成同一个结论
  → 极端情况会覆盖上一张海报（计划逐字要求，plan-mandated）；测试补强：`isDirGranted` 缺 `primary:Music` vs `primary:Music2` 夹具（现在 `startsWith` 的错误实现能全过）、
  `share-card-file-name.mts:22` 的 `<= 80` 应写成 `<= 72`、`'lyric-poster'` 回落与控制字符半支无断言、`childRealPath` 的无冒号/空相对路径/`/sdcard/` 三支无断言。
- 渲染成本：`fitLyricBlock` + `lines.slice` 每次渲染都跑；**两枚**默认导出是匿名箭头（`MusicCard.tsx:18`、`LyricCard.tsx:29`），React DevTools 里显示空白条目。
  **更正**：原写"四个"——HEAD 上 `index.tsx:146` / `CoverImage.tsx:77` / `ShareCardModal.tsx:117` 都是 `export default 具名常量`，`BrandLine.tsx:10` 干脆是具名导出，匿名箭头只剩上面那两枚。
- **Task 7 点名"→ Task 11 清单"、账上一直没记的两条**：
  ① `image/png` 的 intent 上**还要不要带 `EXTRA_TEXT` / `EXTRA_SUBJECT`**：`UtilsModule.java:294-295` 至今仍两条都塞，`ShareCardModal.tsx:43-45` 也仍照样把 `t('share_card_title_music')` / `t('share_title_music')` 传下去。
  `EXTRA_SUBJECT` 早就过时，`EXTRA_TEXT` 在图片意图上会被部分收端当正文显示（有的邮箱会把它写进正文）——**要不要摘掉是产品判断，本轮没动 Java**（硬约束：文档轮不改代码），留给下一次带设备的改动一起裁。
  ② **Java 注释的两处措辞还没修**：`dfadbb8` 只删掉了"shareText 用 `Uri.fromFile`"那句，`UtilsModule.java:273` 那句"**收端**抛 `FileUriExposedException`"仍然说反（实际是暴露方 `startActivity` 时 StrictMode 抛，见 §5 的落地更正），
  同段 `:275-276` 的"**下面** cache-path 与 external-cache-path 两条声明"里的"下面"指的其实是**另一个文件** `res/xml/file_paths.xml`，在本文件里往下看什么都没有。这两条都在 `android/` 下 ⇒ 本轮按约束只记账、没改。
- **合并卫生**：`ShareModeSheet` 现在在（仍未跟踪的）`src/components/player/SheetThemeProvider.tsx` 之外，两边都改 `Header` 的渲染区 ⇒
  玻璃那支合进主干时**要把 `<ShareModeSheet>` 包进那个 provider**，否则在动态封面上会读成"半透明黑纱浮在糊图上"。
- **"单独 checkout 能不能编译"至今只是静态判定**（评审做了四项闭合）。要真验得 `git worktree add` 出一份干净树跑 tsc，那要再装一份 `node_modules`（本机磁盘空闲不足），留给对外发布前。

### 11.7 提交链（任务范围 `a6c1744..01680db` = 代码 14 笔 + docs 11 笔；代码收口 `a6c1744..52e1f28` = 代码 18 笔 + docs 12 笔；文档轮 `c9970d8` = docs 第 13 笔、`c6b110f` = 第 14 笔；字形返工 `a09204b` = 代码第 19 笔、`b7ab854` = docs 第 15 笔，含本笔 = docs 16 笔）

代码（任务范围）：`2410e79` spike 装 view-shot 3.8.0 + 探针 · `5b8a56a` `fitLyricBlock` + `cardTheme`（Task 2/3 合笔，代价：将来不能单独 revert）·
`9147879` `getCoverAverageArgb` + `averageArgbOfPixels` · `59a908b` `CoverImage` · `cff62d0` `6e65168` 就绪上报两轮修 ·
`c2d0854` `ShareCard` 两层结构 + `BrandLine` + 删探针 · `41f4181` 两处高度预算 · `0a5c438` `captureRef` 导出 + FileProvider 分享 ·
`dfadbb8` `shareImage` 桥补 `return` · `97391d4` SAF 保存 + `shareCard.savePath` · `e5adab7` 预览 Modal + 5 枚 key ·
`d853eb6` 按钮层不吃字号缩放 + catch 留原始错误 · `01680db` 头部入口 + 4 枚 key。
docs（回改，不计入代码数）：`e2eff3f` `1452958` `7d0a6ea` `f904374` `a4dd9b3` `a0f0196` `48454dc` `a20b02a` `2757fd3` `701631f` `e80afc7` `f586df3`（最后这枚就是本节的 Task 11 回写）。
**其后（终审修复轮，代码 4 笔，见 §11.9）**：`442e652` 就绪门聚合三路 · `90efe28` 卡内文字不吃系统字号也不跟 `theme.fontShadow` ·
`62baeda` 面板退场落定后再挂预览 Modal · `52e1f28` 导出图名接上 view-shot 自己的缓存清理（**代码到此为止**）。
总数是 `git log --oneline <range> | wc -l` 实跑的：`a6c1744..01680db` = 25（14 + 11），`a6c1744..52e1f28` = 30（18 + 12）。
**拆分口径**：docs 按提交前缀 `docs(分享图)` 数，不是按路径数 —— `6e65168` 那笔 fix 顺手也改了计划文件，
用 `git log -- docs/superpowers` 过滤会各多出一笔（25 的区间跑出 12、30 的区间跑出 13），别照路径命令对号。
**Task 11 文档轮收尾 = `c9970d8`（docs 第 13 笔，`a6c1744..c9970d8` = 31 = 18 + 13，同样 `git log` 实跑）**：
`f586df3` 那轮回写把终审修复轮**整段漏了**（它的 §11 只写到 11.8，全文 `§11.9` 0 命中），这一轮补上 §11.9 一节、正文指向它的引用、真机第 18 条、修复轮明知故留的两条 minor 与全部行号/事实更正。
**这一轮的现场要记一笔**：同一份 spec 里同时有子代理与控制会话在写（控制会话补的是 §11.4 第 18 条、§11.6 两条 minor、§11.1 的 tsc 数法与本节的计数），
`c9970d8` 把这些一起带走了；子代理按它的约束不跑 `npm test`，因此把控制会话实跑出来的那个总数撤下过一回 —— 撤是对的纪律、错的判断（它没复现，我复现了），
下一笔（**本笔**，docs 第 14 笔 ⇒ `a6c1744..本笔` = 32 = 18 + 14）把 690/689/fail 1 连出处一起补回 §11.1 与 §11.9-5。并行写同一文件的过程与裁定见 ledger。
**注意 `2410e79..01680db` 这种写法是错的**（那个 range 不含 `2410e79` 本身，跑出来 24 笔 = 13 代码 + 11 docs，与本节少一笔）。
**上面那句"代码到此为止"已经作废**：真机看过图之后又开了一轮代码 —— `a09204b`（代码第 19 笔，§11.10 的落款字形抠底 + 圆角收小，4 个文件：3 个 tsx + 那张 PNG）。
本笔是 docs 第 15 笔 ⇒ `a6c1744..本笔` 应为 **34 = 19 + 15**；**那一笔提交之后实跑过：`git log --oneline a6c1744..HEAD | wc -l` = 34、`grep -c '^docs(分享图)'` = 15，成立**。
本轮（重建包之后补 §11.4/§11.10 的构建事实与"字形进包怎么验"）是 docs 第 16 笔 ⇒ 应为 35 = 19 + 16，**自指的数本笔写完不跑**，下轮照例实跑再落数。
执行现场与逐条裁定见 `.superpowers/sdd/2026-10-16-share-card-image/progress.md` 及同目录各 `task-N-report.md`。

### 11.8 卫生（读历史时别误判）

- 本功能全程用"HEAD + 本次改动"的定向入索引。共享文件（`package.json`、三份 `src/lang/*.json`、`Header.tsx`、`src/utils/monet/*`、`src/utils/fs.ts`、
  `app_setting.d.ts`、`defaultSetting.ts`）里**别人的未提交 WIP 一行都没进提交**，也一行都没被清理掉；代价是每个任务多两步还原。
- 工作区里歌词工具页 / 下载 / 莫奈动态背景 / 玻璃 Sheet 那几支 WIP 仍**未提交** —— 这正是 Task 10b 与 §11.5 两份重复挂起的根因，不是遗漏。
- 从这个工作树产出的 APK 只用于验证，**不是发布候选**：它把那批未提交 WIP 一起打进去了。
  **补一条（2026-10-17）**：磁盘上现在留着的 `android/app/build/outputs/apk/debug/*.apk` 连本分支的代码都不含（mtime 早于 `2410e79`），
  既是旧的也是不完整的 —— 见 §8 的"先重跑 `assembleDebug`"。
- iOS 一行没写，与本文 §10 一致：`src/utils/nativeModules/utils.ts` 在模块顶层解引用 `NativeModules.UtilsModule`，`ios/` 侧没有对应实现（grep `ios/**` 零命中）→ 这条路本来就只有安卓通。

### 11.9 整分支终审与它的代码修复轮（`442e652` `90efe28` `62baeda` `52e1f28`，2026-10-17）

Task 11 的回写（`f586df3`）之后对本分支做了一次**整分支终审**：**1 Critical + 4 Important + 1 Minor**，
外加它**用代码关掉了 §8 的一条生死探针**（"状态栏进不进图"恒为否，理由见 §8 第 3 条）。裁定是"代码先、文档后、串行不并发"
（两个代理共用同一个 git 索引，并发 `git add` 会把彼此的暂存文件卷进同一笔）。下面逐条写的是**这四笔提交实际改了什么**（`git show` 读过，不是转抄结论）。

1. **Critical #1 + Important #2 —— 就绪门只盖了三路异步输入里的一路（`442e652`）**。
   原来两枚按钮的 `disabled` 只跟着**卡封面**的 `onLoad` 走，而：
   - **配色那一路和 Fresco 没有任何同步点**：`PaletteModule.java` 的 `getArgbPixels`（HEAD `:57`）在 `:71` 调 `readBytes`（定义在 `:167`），远程封面走它自己的 `HttpURLConnection`（`:179`），
     和 Fresco 的位图/磁盘缓存互不相干 ⇒ 冷像素缓存时能差几百毫秒到几秒；而 `averageArgb` 的初值是 `null`，`pickMusicCardTheme(null)` 给的是**深卡**（`cardTheme.ts:36` 对非数字一律判暗）
     ⇒ **亮封面能导出成黑卡**，预览还会现场翻色。
   - **整屏糊底那一路此前完全没人管**：`blurRadius` 是 Fresco 的 **per-request post-processor**，落在 bitmap cache **外面** ⇒ 播放页那支糊底暖不出可复用条目，
     卡封面 `onLoad` 也说明不了糊底解没解完 ⇒ 快拍就是底上一块空 `#111114`。
   现在改成 `ShareCard` 这一层聚合：`const ready = coverReady && backdrop.settled && paletteSettled`（`ShareCard/index.tsx:96`，`:101` 只在这个布尔翻转时往外报一次），
   `ShareCardModal` **只吃这一个布尔、不另存 ready**（`ShareCardModal.tsx:28/:32`）——各存一份就会有人漏掉某一路。
   糊底沿用 `CoverImage` 的形状：落定结果和"它属于哪一张封面"绑在同一个 state（`:64-65` 渲染期复位）+ `key={uri}` 重挂（`:116`）+ `onLoad/onError` 都算落定（`:119-120`）；
   **没有封面 uri 时糊底压根没有 source ⇒ 当场算落定**，门不会永远闭着。`getCoverAverageArgb` 补了 `try/catch/finally`：失败按 §3 回落深卡，
   但 `paletteSettled` 一定置起来（否则一趟不会回来的回调把按钮永久钉死，外加一条没人接的 rejection），日志 `console.error('[share_card] palette_failed', e)`。
   歌词卡那条短路（配色写死、不敲原生）现在**自己把门落定**（`:74-75` 那支 `if (!musicInfo.pic || mode === 'lyric') { setPaletteSettled(true); return }`）——"既然不敲门，就没人来应门"。
   **同笔顺带的 Minor**：两枚按钮的图标从 `Icon size` 改成 `rawSize`（`ShareCardModal.tsx:86/:89`）——`common/Icon.tsx:55` 的 `size` 会经 `scaleSizeW` 乘 App 字号，
   图标和它那枚 44dp 药丸本来该同一套缩放（`:101` 的注释就是这么写的）。
2. **Important #3 —— 系统字号与用户主题字影都能漏进成品图（`90efe28`）**。
   `allowFontScaling` 在**本仓库没有全局关掉**：HEAD 的 `src/` 里只有 `components/common/CheckBox/Checkbox.tsx:95` 与 `:103` 两处设过
   （终审给的 `:100,108` 是当下工作区那份 WIP 的位置，HEAD 上是 95/103）⇒ 安卓默认按**系统**字号乘 `fontSize/lineHeight/letterSpacing`，1.3 档就是 +30%，
   文字块顶穿 `MUSIC_CARD_TEXT_RESERVE = 200` 与 `fitLyricBlock` 的 `fontSize × 1.5` 行模型 ⇒ **落款溢出圆角卡，而且溢在导出的成品图里**
   （和 `41f4181` 修的是同一个症状，只是从系统字号这扇门进来）。另一半：`common/Text.tsx:34-46` 会把用户的 `theme.fontShadow` 铺进每一枚 `Text`，
   而 §3 写的是分享图不跟 App 主题走。
   改法（**没有**把卡内换成 RN 原生 `Text`，共享组件全站在用、本轮不动）：卡内每一枚 `Text` 补 `allowFontScaling={false}`，
   每个卡文件加一处 `noShadow`（`textShadowColor: 'transparent'` + `radius 0` + `offset 0`）铺进文字样式，把主题阴影覆盖回去；
   `index.tsx:27-30` 的预算注释补上"这两笔全是原始 dp，成立前提是卡内每一枚 Text 都写了 `allowFontScaling={false}`"。
   防回归：`tests/share-card-fit-lyric-block.mts` 末尾对 `MusicCard`/`LyricCard`/`BrandLine` **各加一条源码扫描**（剥掉注释后 `<Text` 的个数 == `allowFontScaling={false}` 的个数，
   `noShadow` 出现"枚数 + 1"次 ⇒ 只声明不铺用也算漏）。写在**这个**文件里是因为它已登记在 `package.json` 的 `test` 行上，而那一行正被别的会话改着，新开文件没法同笔接进去。
   与 §11.3-4 那条"按钮层用 `StyleSheet.create`"同源：**整张分享图不吃字号缩放是刻意的决定**，不是遗漏。
3. **Important #4 —— 面板还在退场就挂第二层 Modal（`62baeda`）**：见 §11.6 头三条（都标了"已由 `62baeda` 收掉"）。
   形状是 `hide(onHidden)` 等 exit 动画落定、再 `requestAnimationFrame` 挂（`ShareModeSheet.tsx:70-72`，照的是 `MusicMoreSheet.tsx:131-135` 那条现成的路），
   「分享文字」那一支不叠窗口所以保持立即触发（`:61-65`）；另加 `exitingRef` 闸门挡掉退场那 200ms 里的第二次命中（`:37/:41/:51-53/:60`），
   和补回 `actionText` 的 `flex: 1`（`:177-178`；**注意** `flex: 1` 出自**未提交的工作区版** `MusicMoreSheet`，HEAD 版没有，见 §11.6）。
   "会不会闪一下黑底"这条**仍然欠真机**，挂在 §11.4 第 10 条。
   **这笔的设计代价**：`onSelect` 推迟到退场落定 ⇒ 那一刻读的是**按下当时**那次渲染的歌曲快照，200ms 内正好切歌会让预览卡与身后播放页不同步 —— 已记成 §11.4 第 18 条（导出的图里只有卡，不一致只出现在屏幕上）。
   另有一道闸门只挡 `handleSelect`、没挡 `show()` 的负债，本轮判为"现有入口够不到"，记在 §11.6。
4. **Important #5 —— 导出的 PNG 没人清（`52e1f28`）**：`captureRef` 的 `fileName` 原来直接按歌名命名，
   而 view-shot 扫缓存的**唯一判据**是 `startsWith(TEMP_FILE_PREFIX)`（`RNViewShotModule.java:120` 定义、`:150-152` 判据，**不看修改时间**），对不上就永远没人删
   ⇒ cache 目录里一首一张只增不减。改成把那个常量当 `SWEEP_PREFIX` 拼在名字前面（`exportCard.ts:16/:21`；库把 `fileName` 当 `createTempFile` 的**前缀**用 —— 调用点 `RNViewShotModule.java:98`，`:192` 把它交给 `File.createTempFile`，只有**没传** fileName 时才回落到 `:194` 用那个常量当 prefix），
   复用库自带的 `CleanTask`，零新增生命周期代码，也不会删掉别人正在读的文件；`safeFileName` 那条 ≥3 字符的规则原样保留。
   **本轮复核到的一条与提交说明不符**：`CleanTask` 在这份 `3.8.0` 里**只有一个实例化点** —— `onCatalystInstanceDestroy`（`:56-58`）；
   类注释（`:122-126`）说"模块实例化时也跑"，但 `RNViewShotModule` 没有 `initialize()` 重写 ⇒ 一次长会话里仍然攒着，要等 JS 实例销毁才收。
   这条已写进 §11.4 第 14 条的判据里。**账上原来"没人删是接受的"那条裁定就此作废**（Task 7 的裁定，被 #5 推翻）。
   防回归：`tests/share-card-file-name.mts` 加两条源码判据 —— 读 `node_modules` 里那支 Java 的 `TEMP_FILE_PREFIX` 和我们的 `SWEEP_PREFIX` **必须相等**（库改常量、或有人把前缀拼丢都会先红），
   并钉住 `result` 仍是 `tmpfile`、前缀确实拼进返回值、≥3 字符补位没丢。
5. **本轮复测的闸门**：本功能 5 个用例文件 **42 pass / 0 fail**（`37 → 42`：`90efe28` +3、`52e1f28` +2），
   `npx tsc --noEmit` **137 条 = 基线**（文档轮收尾时复跑过：`grep -c "error TS"` = 137、同一次输出 `wc -l` = 161，两个数的口径见 §11.1；命中本分支文件的仍只有 `defaultSetting.ts` 那条 HEAD 上也红的旧错），
   本功能自有文件 eslint **0 error**（收尾时按 `git diff --name-only a6c1744..HEAD` 现取的 21 个 ts/tsx 复跑：exit 0、**零行输出**；修复轮没新增文件，跑的还是 §11.1 那 21 个）。
   整仓 `npm test`：**文档子代理那一轮按约束没跑**（它的报告里只有 Task 11 那轮的 **685 / pass 684 / fail 1**）；随后控制会话在 `c9970d8` 上复跑过 = **690 / pass 689 / fail 1**，多的 5 条来自别的会话新增用例，红的仍是既有的 `tests/monet-texture.mts:68`（这次实测 `tone 89.84 越界`）。
   **总数会随别的会话 WIP 漂移，不当契约；自己没复现过的数不往本文里填 —— 这条纪律两边都守：子代理没跑就不写，控制会话跑过的才补进来。**
6. **真机证据：本轮一条也没拿到**。`adb devices` 仍为空，四笔提交全部是**静态**改动 + 静态判据；
   新增的 §11.4 第 16/17 两条就是为 `442e652`/`90efe28` 这两笔准备的回归项（冷像素缓存首帧白卡 / 系统字号 1.3 落款不出卡），第 18 条盯的是 `62baeda` 那个延迟触发的选曲快照。
7. **终审点名"以后再说"、本轮没动的**：`ShareCardModal` 的 `visible`/`ready` 复位设计（归 Task 10b）、`share_card_share` 新文案键（三语言同笔的风险）、
   `cardFileName.ts:2` 拿**未跟踪的** `src/core/lyricCopy.ts` 当"零 import"先例（那句注释在库里指向一个不存在的路径）、`EXTRA_TEXT`/`EXTRA_SUBJECT`（§11.6 新记的那条）、
   glyph 取自未提交的图标改版（§7 那行已改写）、`shareCard.savePathName` **写了没人读**（HEAD 只有 `defaultSetting.ts:75` / `app_setting.d.ts:372` / `saveCard.ts:23` 三处，没有一处读回来显示）、
   `isDirGranted` 每次存图一趟桥、以及 §11.6 那批测试强度补强。

### 11.10 落款字形返工：抠白底、盒高对齐 `Music` 的大写高度、圆角收小（`a09204b`，2026-10-17，连着 vivo16 看过真机图之后）

用户提的三条（原话）：图标要做成**仅有色图标**、不要白色底；大小要和 `Music` 的 `M` 相称（"当前的有点太小了"）；卡片与封面圆角太大。**没有一条是判据，全是观感** —— 但根因是一个实打实的测量错误。

1. **根因：§1 那条"透明底，不需要抠图"判据量错了**（已在 §1 原地更正）。四角 alpha=0 只证明**画布角落**透明；
   `ic_launcher_foreground.png` 本来就是"不透明白色圆角方片 + 青色字形"的两层合成，墨迹**外面那圈**方片是实色不透明的。
   两个症状同一来源：深色卡上露出一块白斑，而 20×20 的盒子里方片吃掉约 2/3，真正落在唱片上的只有约 9.4dp ⇒ "图标太小"。
2. **抠底算法（不是阈值切图）**：源图是纯色青 `(2,170,188)` **线性混合**在白底上，所以 R 通道单调、`t = (255 − R) / (255 − 2)` 就是**真实覆盖率**，
   反算回去时把 RGB 钉回那支平色青、alpha 用 `t`（并按地板重标定 `t' = (t − floor)/(1 − floor)`）。这样半透明边缘是**渐变**而不是锯齿。
   **地板是量出来的**：第一版取 `t ≥ 0.045`，把白方片自己的 PNG 压缩雾噪也留下了（外框一路吃到 y=354，量出错值 219×242）；
   把墨迹下方每一行的最大 `t` 打出来是 **0.032–0.040** ⇒ 地板抬到 `T_FLOOR = 0.09`，外框落回 **(112, 113, 330, 317) → 218×204**，墨迹宽高比 218/204。
3. **盒子尺寸推导**（`BrandLine.tsx:33-38` 的注释是同一套）：`Music` 是 `fontSize: 17` 原始 dp，Arial/Roboto 系的大写高度 ≈ `0.711em` ⇒ **12.09dp**；
   圆形字标要和字母**视觉等重**得出头一点，取 ×1.08 ⇒ 13.05 ⇒ **盒高 13.1**（`contain` 下资源已裁到墨迹外框，框高即字形高），**盒宽 14 = 13.1 × 218/204**，`marginRight` 4 → 5。
4. **圆角**：卡 `28 → 20`（`ShareCard/index.tsx:126`），封面 `18 → 12`（`MusicCard.tsx:43`）。§3 的字面 wireframe 已跟着改。
5. **一个必须写下来的实现后果**：唱片上的**白色刻线与音符现在是透明的**，透出卡片底色 ⇒ 深卡是"青唱片 + 暗纹"，亮卡上纹路基本隐形（白卡本来也看不见白纹，这正是"仅有色图标"要的效果）。
   **这一条欠真机一眼**：218px 的源图降到 14dp（本机 3.5× 约 49px）是 4.4× 缩放，安卓那侧走 Fresco 双线性、没有 mipmap ⇒ 细纹可能发虚或断续，桌面 PIL 小样替代不了设备像素。
6. **复现工具**：`.superpowers/sdd/2026-10-16-share-card-image/mock_brandline.py`（一次性脚本，git-ignored；`--write` 会把抠好的字形覆盖到仓库资源上）。
   两条**已知坑**，下次别踩：
   - 脚本的输入路径现在指向**仓库里那份已抠好的 glyph**，所以直接重跑的 `keyed ink` 会打印 `(0, 0, 218, 204)`，而"before"那一格也不再是白方片原图。
     要从头重做请先把输入指回 `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png`（本文第 2 条那组数是当时对着前景图量出来的）。
   - **对着已抠好的资源再跑一次 `--write` 不是字节幂等**：本轮实测 44,472 个像素里有 **23 个**因为地板重标定被跑了两遍而错一格 alpha（`20,930 B` → `20,913 B`）。
     肉眼不可见，但别把它当"重跑一次没差别" —— 已把资源还原回进包的那一份（md5 `a31072c6…`）。
   小样在 `shots/brandline-mock.png`（新旧 × 亮暗卡 2×2，外加每格下面一条品牌行的放大图）。
7. **本轮闸门（都是现跑的，不是照抄 §11.1）**：本功能 5 个用例文件 **42 pass / 0 fail**；`npx tsc --noEmit` **137**（基线），命中 `ShareCard` 的 **0** 条；
   改动的 3 个 tsx eslint **exit 0、零行输出**。提交后又重跑了一次增量：`BUILD SUCCESSFUL in 2m 54s`（只动 JS + 资源，没碰 Java），
   五支 release ABI 落在 16:11，并把 arm64 那支**拆开验过字形确实进包**（判据见 §11.4 开头那段：`res/UN.png`、218×204、`opaque-white = 0`）。
8. **真机证据：本轮为零** —— 包在磁盘上，装之前设备从无线 adb 掉了（`adb connect` 得到"主动拒绝"，安卓的无线调试端口每会话一变），
   所以第 5 条那句细纹判定、以及 20/12 这两档圆角到底要不要再收，全部挂在 §11.4 第 19 条。
