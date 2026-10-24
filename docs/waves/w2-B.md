# Wave 2 · Lane B 任务书 —— S10 桌面歌词服务（MVP）

> 本文件是 Lane B 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **派发版**（2026-10-25 按 Wave1 合并后快照修订；Wave1 三车道已全部并入 main）。

## 开工基线（实测，2026-10-25）

- 波前快照 = 本文件所在提交（主仓库 HEAD；Wave1 收口提交为 `47be7e0`）。
- `cd android-native && gradlew.bat ktlintCheck test assembleDebug`（强制真跑）
  → `:core` **384** + `:app` **62**（合计 **446**）全绿，failures/errors/skipped 全 0，
  `app-debug.apk` = **27,602,811 B**。
- 测试数只会等于或大于 446；变少 = 有人删测试，停下报告。

## 背景

RN 版桌面歌词 = `android/app/src/main/java/cn/toside/music/mobile/lyric/`（9 个 Java
文件：`Lyric` / `LyricEvent` / `LyricModule` / `LyricPackage` / `LyricPlayer` /
`LyricSwitchView` / `LyricTextView` / `LyricView` / `Utils`，工作区干净、已入库）
+ `src/utils/nativeModules/lyricDesktop.ts` + `src/core/desktopLyric.ts`
+ 设置项 `desktopLyric.*`（`src/config/defaultSetting.ts:55-69` 与 `:104`）。Kotlin 侧为 0。
本 lane 只做 **MVP**：浮窗服务 + 逐行滚动 + 启停开关，OEM 兼容与锁词拖动细节留后。

前提（已核实）：Wave 1 已把播放页「更多菜单」sheet 落地，文件名与路径是
`android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`
（标题「播放器设置」，调用点在 `PlayDetailPage.kt:161-173`）。本 lane 的入口
直接加进这个 sheet，不再做临时按钮。

## 任务

1. **`DesktopLyricService`**（新目录 `app/.../lyric/`）：TYPE_APPLICATION_OVERLAY 悬浮窗，
   对照 RN `LyricViewManager.java` 对应的 `LyricView.java`/`LyricTextView.java`
   （布局参数、窗口标志、逐行滚动）。`AndroidManifest` 加 `SYSTEM_ALERT_WINDOW`
   权限与服务注册（当前 manifest 只有 `PlaybackService`，**还没有**该权限），
   **不得动 `screenOrientation="portrait"`（现第 22 行）**。
2. **歌词数据源**：订阅 `PlayerRuntime` 既有歌词流与播放进度，同步到浮窗
   （播放/暂停/切歌）。**不改 `core/lyric/` 与 `ui/play/` 内部**；歌词文本一律从
   `PlayerRuntime` 公开流取。
3. **设置键：全部已存在，禁止追加**——`core/.../setting/DefaultSetting.kt:60-74`
   已含 RN 的 14 个 `desktopLyric.*` 键（`enable/isLock/width/maxLineNum/isSingleLine/
   showToggleAnima/position.x/position.y/textPosition.x/textPosition.y/style.fontSize/
   style.opacity/style.lyricUnplayColor/style.lyricPlayedColor/style.lyricShadowColor`）。
   本任务改为**键契约测试**（默认值逐键对照 RN，含 `:104` 的新年皮肤覆盖），
   `DefaultSetting.kt` 列为禁触。
4. **入口**：`MoreActionSheet.kt` 加桌面歌词开关一行（含 overlay 权限检查 + 跳系统
   权限页，对照 RN `DesktopLyricEnable.tsx`）。这是本 lane 在 `ui/play/` 里
   **唯一允许改的业务文件**，且只许加行；该行的状态/动作必须自包含
   （进程级单例 + `LocalContext`），不得要求 `PlayDetailPage.kt` 改签名。
   若确实无法自包含，允许在 `PlayDetailPage.kt:161-173` 的调用点**最多加 1 个传参
   与 1 个形参**，并写进报告；其他行一律不许动。
5. **测试**：歌词行选择/滚动的纯逻辑放 `:core`（新文件，如
   `core/lyric/DesktopLyricLine.kt`，**只新建不改既有文件**）配 JVM 单测；
   设置键默认值契约单测。浮窗服务真机验收。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/`（新建目录）
- `android-native/core/src/main/kotlin/cn/toside/music/core/lyric/` 内**新建文件**（不改既有）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`
  （只加入口行；必要时按任务 4 的例外动 `PlayDetailPage.kt` 调用点）
- `android-native/app/src/main/AndroidManifest.xml`（加权限/服务注册；禁动方向属性）
- 新增测试放对应包

## 禁触

- `core/.../setting/DefaultSetting.kt`（键已齐全，本波不许追加）
- `ui/settings/`、`userapi/`、`ui/list/`、`core/.../list/`、`ui/search/`、`ui/leaderboard/`、
  `ui/songlist/`（Lane A/C 范围或非本波）
- `app/.../player/`、`core/.../player/`、`core/.../lyric/` 既有文件
- `.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿，
  测试数 ≥ 446（`:core` ≥384 + `:app` ≥62）；
- 新增设置键契约测试（默认值逐键对照 RN）；歌词行选择纯逻辑有 JVM 单测；
- lane 报告按 RULES 模板追加到本文件末尾并 commit；
- 真机 MVP 清单写进报告：MIUI/HyperOS 上显示/拖动/锁词、开关持久化、息屏行为。
