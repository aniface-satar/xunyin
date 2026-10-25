# Wave 4 · Lane B 任务书 —— S14 分享图卡片（Apple Music 风格音乐卡 + 歌词卡）

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **预草稿**（2026-10-26 起草，基线 = Wave3 并入后 core 558 + app 76 = 634）：
> 投用前必须由协调会话在新快照上复核修订（教训 2）。

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
   保存）；这是本 lane 在 `ui/play/` 唯一允许改的文件（更多菜单 sheet，只加接线行）。
5. **封面来源**：只调用 `CoverImageLoader` 既有公开 API 取封面，**不改该文件**
   （磁盘缓存/getPicPath 归 Lane C 本波独占，避免同文件冲突）。
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
