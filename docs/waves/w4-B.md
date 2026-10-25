# Wave 4 · Lane B 任务书 —— S14 分享图卡片（Apple Music 风格音乐卡 + 歌词卡）

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已复核修订**（2026-10-26 协调会话；基线 = Wave3 并入后 core 558 + app 76 = 634）。
> 复核结论：RN 对照文件全部存在；`MoreActionSheet.kt` 是 `ui/play/` 下唯一可改文件；
> `CoverImageLoader` 当前公开 API 写死在第 5 条。

## 背景

进度文档 B4 待办「其余弹层：分享卡」与 Wave3 之后清单均点名分享卡未移植。
RN 已有成熟实现（worktree 内只读对照，全部为已提交版本）：
- `src/components/ShareCard/`：`MusicCard.tsx`、`LyricCard.tsx`、`ShareCardModal.tsx`、
  `CoverImage.tsx`、`BrandLine.tsx`、`cardTheme.ts`、`cardTypography.ts`、`cardScale.ts`、
  `fitLyricBlock.ts`、`index.tsx`
- `src/utils/shareCard/exportCard.ts`（截屏导出）
- `src/screens/PlayDetail/Vertical/components/ShareModeSheet.tsx`（分享模式弹层入口）
- `src/screens/Home/Views/Setting/settings/Basic/ShareType.tsx`（分享类型设置）

**重要（项目记忆「RN 截屏导出的六条坑」）**：RN 走 view-shot 截屏导出，原生侧不能照抄——
Compose 无等价同步截屏，需用 `Canvas`/`android.graphics.Bitmap` + `Picture` 主动重绘卡片，
或 `Modifier.drawWithContent`+`PixelCopy`。开工先在本报告区写「导出方案选型」，再实现。
另参照「release 包资源改名→按像素验进包」：字体/品牌图不能用 RN 的 JS 资源名假设。

## 任务

1. **`:core` 卡片数据/排版纯规则**（新包 `share/`）：把 `cardTheme/cardTypography/
   cardScale/fitLyricBlock` 的取值与文字截断/适配算法移植为纯 Kotlin（输入曲目信息 +
   歌词行 + 主题色 → 输出布局/字号/换行决策），全 JVM 单测 + 黄金对照 RN 值。
   **这是本 lane 的主要可测资产**，绘制层留 app。
2. **app 绘制层**（新目录 `ui/share/`）：用 `Canvas`/`android.graphics` 按 core 决策
   重绘 MusicCard（封面 + 歌名歌手 + 进度条 + 品牌线）与 LyricCard（歌词块自适应排版），
   视觉对照 RN 组件（颜色/字号/间距从 core 黄金值取，不硬编码）。
3. **导出到相册**：MediaStore 写入（`Pictures/寻音`），命名与去重对照 RN；
   **保存辅助类放本 lane `ui/share/` 内，不得在 `util/` 建文件**（`util/` 归 Lane C 本波独占）。
4. **入口**：播放页「更多菜单」加「分享」一行 → 分享模式 sheet（音乐卡/歌词卡切换 +
   保存）。落地文件写死为
   `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`，
   这是本 lane 在 `ui/play/` 唯一允许改的文件，且只加接线行；
   `PlayDetailPage.kt`、`LyricView.kt`、`TimeoutExitRuntime.kt` 禁触。
5. **封面来源**：只调用 `CoverImageLoader` 既有公开 API，**不改该文件**
   （磁盘缓存/getPicPath 归 Lane C 本波独占，避免同文件冲突）。当前 API 形状（已核实）：
   `object CoverImageLoader { suspend fun load(rawUrl: String?): CoverArt? }`，
   返回 `CoverArt(cover: ImageBitmap, blurSource: ImageBitmap?)`；内部是 6 张内存 LRU，
   最长边 1200、`RGB_565`、`blurSource` 32px。只调 `load`；若需要缩略图/落盘路径等新能力，
   写进 lane 报告交给 C，不要自己扩。
6. 分享类型设置（对照 `ShareType.tsx`）为**可选项**：卡片能存能看即达 MVP，
   类型偏好键（`share.*`）需要加 `DefaultSetting` 时在本波**避免**——用进程级默认，
   设置持久化登记收官遗留（本波无人认领 `core/.../setting/`）。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/share/`（新建）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/share/`（新建，
  含本 lane 自己的图片保存辅助类）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/` 中更多菜单
  sheet 一个文件（只加「分享」接线行）
- 新增测试放对应包

## 禁触

- `ui/play/CoverImageLoader.kt`（Lane C 独占；只调用）、`util/`（Lane C 独占）
- `ui/list/`、`core/.../list/`、`core/.../backup/`、`ui/settings/`（Lane C 范围）
- `HomePage.kt`、`HomeNavigator.kt`、`ui/radio/`、`core/.../recommend/`、`player/`（Lane A 范围）
- `core/.../setting/`、`AndroidManifest.xml`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- core 卡片排版/取值/截断规则全部 JVM 单测 + 对照 RN 黄金值；
- 「导出方案选型」写报告（说清为何不用 view-shot、用什么同步绘制路径）；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；真机清单（卡片观感、存相册、
  命名/去重、release 包字体/品牌按像素验证）写报告。

## Lane B 导出方案选型（2026-10-26，实现前定稿）

- **RN 路线不可移植**：RN 用 `view-shot` 的 `captureRef` 把已上屏的卡片组件抓成临时 PNG
  （`exportCard.ts`）。原生没有等价的同步截屏：Compose 没有「按组件出图」的公开 API；
  `PixelCopy` 只能抓窗口表面且是异步的，要求真实上屏、受最小化/遮挡影响，预览与成品
  还可能不是同一帧。继续沿用「截屏」思路会引入一整类就绪门与黑图问题。
- **选型：主动重绘（Canvas/Picture 系）**。分工写死：
  - `:core/share/` 产出全部**决策**：主题色、字号、卡片几何（`cardScale`/`shotRect`）、
    歌词块取几号字/显示几句/是否截断、文件名与去重。全部 JVM 单测 + RN 黄金值对照。
  - `ui/share/` 只有**执行器**：一个 `android.graphics.Bitmap + Canvas + Paint` 渲染器，
    把同一份决策画成位图。预览直接显示这张位图，导出写出的也是这张位图（WYSIWYG），
    不存在「预览对、导出歪」的两套排版。
- **封面**：只调 `CoverImageLoader.load(picUrl)`，取 `ImageBitmap.asAndroidBitmap()`
  画进封面框；背景用其 `blurSource`（32px 缩略图）放大铺满 + `#111114` 覆盖层近似 RN
  的 expo-blur 背景（无 RenderScript/无第三方模糊库，不新增依赖）。
- **文字**：`Paint` 按屏幕密度把 core 的 dp 值换成 px，直接排版；行高、间距、截断行数
  全部来自 core 决策。由此天然绕开 RN 那套 `allowFontScaling` 顶穿问题（不读系统字号）。
- **导出**：同一 Bitmap 压 PNG，`MediaStore` 写入 `Pictures/寻音`。命名/去重照 RN
  （`cardFileName` 清非法字符、72 字符上限、同名追加 ` (n)`）。约束：`minSdk = 26` 且
  manifest 禁触（无 `WRITE_EXTERNAL_STORAGE`），**29+ 可免权限写公共相册；26–28 只能
  提示系统版本过低**——记入遗留，要支持需改 manifest（本波禁触）。

## Lane 报告（2026-10-26）

- 结论：完成 S14 分享卡 MVP（音乐卡 / 歌词卡 / 五档比例 / 保存到相册 / 更多菜单接线）。
  导出走「主动重绘」，预览与导出是同一张 Bitmap（WYSIWYG）。未做：系统分享 chooser、
  `share.*` 偏好持久化、26–28 保存路径（均见遗留）。
- commit：`b59057e`（core 规则 + 单测）、`267bb12`（导出选型文档；同一提交里含
  `CardTypography.kt → CardTextSizes.kt` 的 ktlint 文件名修正）、`661cb9f`（绘制层 /
  保存 / 弹层 / 接线）；测试数 **core 619 + app 76 全绿**（基线 558 + 76；本波新增
  share 包 61 项单测，无删减）。
- 触碰文件清单：
  - core main（新建）：`core/share/CardTheme.kt`、`Rounding.kt`、`CardTextSizes.kt`
    （原 `CardTypography.kt`）、`CardScale.kt`、`FitLyricBlock.kt`、`CardFileName.kt`、
    `ShareCardLayout.kt`
  - core test（新建）：`CardThemeTest.kt`、`CardTypographyTest.kt`、`CardScaleTest.kt`、
    `CardFileNameTest.kt`、`FitLyricBlockTest.kt`、`ShareCardLayoutTest.kt`
  - app（新建）：`ui/share/ShareCardRenderer.kt`（Canvas 绘制执行器）、
    `ui/share/ShareCardSaver.kt`（MediaStore 保存）、`ui/share/ShareCardOverlay.kt`
    （模式/比例/预览/保存/关闭与渲染调度）
  - app（改）：`ui/play/MoreActionSheet.kt`——只加 1 个 import、1 个 `showShare` 状态、
    1 行「分享」Item、末尾 1 段 `ShareCardOverlay` 调用（无其他改动）
  - docs：本文件（选型节 + 本报告）
  - **未触**：`CoverImageLoader.kt`、`util/`、`PlayDetailPage.kt`、`LyricView.kt`、
    `TimeoutExitRuntime.kt`、`AndroidManifest.xml`、`core/setting/`、gradle/版本目录
- 语义修正与实证发现：
  - **音乐卡没有进度条**：任务书写「封面 + 歌名歌手 + 进度条 + 品牌线」，但 RN
    `MusicCard.tsx` 只有封面 / 歌名（3 行）/ 歌手（2 行）/ 品牌行。按 RN 实现，未画进度条；
    若产品确实要，应先在 RN 加并同步 core 的高度预算（`MUSIC_CARD_TEXT_RESERVE=200`）。
  - **歌词来源是整首**：RN 歌词卡的 `lyricLines` 来自歌词工具页的勾选行；原生本波没有
    工具页，用 `runtime.lyrics.parsed` 全量（丢全空行）。core 的 `fitLyricBlock` 接口不变，
    将来接选中行只换数据源。
  - **`visibleCount = -1` 哨兵不可达**：RN `fitLyricBlock` 兜底初值 -1（JS 端消费是
    `slice(0, -1)`，会少最后一句）。移植时两条路径都返回 ≥0：给了字号走连续下探（首档
    即写入 best），不给字号走五档（0 > -1 必然接管）。新增单测
    `anImpossibleCardShowsNoLyricLinesInsteadOfFailing` 锁死「预算为 0 → visibleCount 0、
    shown 为空」，因此 `lines.take(visibleCount)` 不会出现负数切片。
  - **卡色 = 系统深浅模式**：RN 取 `appTheme.isDark`；原生取 `isSystemInDarkTheme()`
    （与 `MusicApp.kt` 主题同源）。播放页封面取色主题不参与卡色（RN 明确回挂
    `SheetThemeProvider` 就是为了这个）。
  - **比例默认全屏**（RN `DEFAULT_RATIO = 'fullscreen'`）；卡片按基准屏（360×800 类）
    算一份整体，其余比例只做 `scale ≤ 1` 等缩，卡内比例不动。
  - **行高近似**：RN 的音乐卡歌手、歌词卡页脚歌名/歌手没有显式 `lineHeight`（吃平台默认）；
    原生统一按 1.25× 字号排。单行无差异，两行时每行差 <2dp，仍在 200/160 的预算内。
  - **字距单位**：RN `letterSpacing: 0.2` 是 dp；`TextPaint.letterSpacing` 是 em，
    所以取 `0.2 / 17`。
  - **品牌图形资源替换**：RN 用裁到墨迹的 `app-icon-glyph.png`（218×204，唱片+音符）；
    原生包内没有该图，改用 `ic_launcher_foreground`（Material Symbols music_note 矢量，
    viewport 108、墨迹框 x 30.5..68 / y 32..76）。按墨迹框等比 contain 进 14×13.1 的框、
    左对齐、`SRC_IN` 染色。**观感与 RN 的唱片图标不同**（只剩音符），属已知近似。
  - **糊底近似**：RN 是 Fresco 20dp 框糊（边缘会读到图外、留一圈暗边）；原生用
    `blurSource`（32px 缩略图）center-crop 放大 + 20% 黑 scrim，边缘干净但颗粒更粗。
  - **noWrap 判定几何**：歌词页左右各 28dp（`LyricView`），所以 `pageTextWidth =
    屏宽 − 56dp`、`pageFontSize = lrcFontSizeTenths / 10`，与 core 的估算宽度同源。
  - **不做截屏的实证理由**：`:app` 没有 view-shot 等价物；Compose 无按组件出图 API，
    `PixelCopy` 异步且依赖上屏。选型文档已单独提交（`267bb12`）。
- 遗留问题与对后续波次的建议：
  1. **系统分享未做**（RN 有 `shareCapturedCard`）：需要在保存后拿 MediaStore Uri 发
     `ACTION_SEND`；本波验收只要求保存，建议下一波与「更多菜单其它动作」一起接。
  2. **`share.*` 偏好持久化**（分享类型/默认比例）：本波用进程级默认，`core/setting/`
     无人认领，需在 DefaultSetting 表尾追加后接线。
  3. **26–28 无法免权限写相册**：manifest 禁触（无 `WRITE_EXTERNAL_STORAGE`），现为
     可读提示「需要 Android 10 及以上」。要支持得改 manifest（`maxSdkVersion=28`）或
     改用 SAF 让用户选目录（RN 旧路就是 SAF）。
  4. **去重只看得见本应用条目**：29+ 作用域存储下 `RELATIVE_PATH` 查询只返回本应用贡献的
     图片；重装/跨应用写入可能重名，最终由系统改显示名，不覆盖原文件。若要严格不重名，
     需改用 MediaStore 查询全库（要权限）或 SAF。
  5. **封面仅 http(s)**：`CoverImageLoader.normalizeUrl` 只认 http(s)（本地曲目
     `picUrl` 为路径时无封面），属既有 API 限制，本波只调用不改；需要时交 Lane C 扩。
  6. **分享层叠在更多菜单之上**：关闭分享回到面板（`PlayDetailPage` 禁触，无法把状态提升
     到播放页直接开卡）。若产品要求「分享关掉即回播放页」，需在 PlayDetailPage 提升状态。
  7. **真机清单（本波零项，待验收）**：
     ① 深/浅色模式各开一次：卡底黑/白、文字对比正常，切换系统深色后重开生效；
     ② 音乐卡：封面圆角+1px 边界线、歌名 ≤3 行、歌手 ≤2 行、品牌行不越卡；
     ③ 歌词卡：字号从设置档下探到 14 地板、截断出现「…」、分隔线 35% 不抢眼；
     ④ 五档比例逐档切：卡整体等比缩放、卡内比例不变、预览不拉伸；
     ⑤ 保存后相册 `Pictures/寻音` 出现图片，像素与预览一致（全屏档 = 屏宽 px）；
     ⑥ 同名连存 → `歌名 - 歌手.png` / `歌名 - 歌手 (1).png`；含 `/ : * ? " < > |` 的
        歌名被清理；中英文混排正常；
     ⑦ 断网/无封面：仍能生成并保存（纯色底、封面框只剩边界线）；
     ⑧ 生成中/保存中：关闭与返回键无效；完成弹「已保存：x.png」；
     ⑨ **release 包按像素验证**：`ic_launcher_foreground` 被资源改名后品牌字形仍在卡上、
        字体未被资源收缩破坏；26–28 设备（若有）出现版本提示而不崩。
