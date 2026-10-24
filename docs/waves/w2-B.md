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
   对照 RN `LyricView.java`（607 行，窗口/浮窗与 `TYPE_APPLICATION_OVERLAY` 都在这里）
   + `Lyric.java`（控制器）+ `LyricPlayer.java`（逐行推进）+ `LyricTextView.java`（行渲染）
   + `LyricModule.java`（RN 桥，仅作接口对照）（布局参数、窗口标志、逐行滚动）。
   `AndroidManifest` 加 `SYSTEM_ALERT_WINDOW` 权限与服务注册
   （当前 manifest 只有 `PlaybackService`，**还没有**该权限），
   **不得动 `screenOrientation="portrait"`（现第 22 行）**。
2. **歌词数据源**：订阅 `PlayerRuntime` 既有歌词流与播放进度，同步到浮窗
   （播放/暂停/切歌）。**不改 `core/lyric/` 与 `ui/play/` 内部**；歌词文本一律从
   `PlayerRuntime` 公开流取。
3. **设置键：全部已存在，禁止追加**——`core/.../setting/DefaultSetting.kt:60-74`
   已含 RN 的 15 个 `desktopLyric.*` 键（`enable/isLock/width/maxLineNum/isSingleLine/
   showToggleAnima/position.x/position.y/textPosition.x/textPosition.y/style.fontSize/
   style.opacity/style.lyricUnplayColor/style.lyricPlayedColor/style.lyricShadowColor`）。
   本任务改为**键契约测试**（默认值逐键对照 RN `defaultSetting.ts:55-69`，并锁住
   Kotlin `DefaultSetting.kt:106` 的 1-2 月新年皮肤覆盖，对应 RN `:103-106`），
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

## Lane 报告（2026-10-25）

- 结论：部分完成。MVP 代码全部落地：浮窗服务、逐行滚动、开关与权限流程、位置持久化；`core` 纯逻辑与键契约测试全绿。未做：真机验收（本 lane 无设备，清单见文末）、应用冷启动自动恢复浮窗、锁词拖动精调与 OEM 适配（按任务书留给后续波次）。
- commit：`4458f3c`（core 逻辑）→ `ae9ba90`（键契约）→ `1f3f3cc`（浮窗服务/控制器）→ `6010420`（入口行）；测试数 core **405** + app **62**（合计 **467**，较基线 +21）全绿，failures/errors/skipped 全 0；`app-debug.apk` = 27,723,451 B（基线 27,602,811 B，+120,640 B）。
- 触碰文件清单：
  - 新增 `android-native/core/src/main/kotlin/cn/toside/music/core/lyric/DesktopLyricLine.kt`
  - 新增 `android-native/core/src/main/kotlin/cn/toside/music/core/lyric/DesktopLyricColor.kt`
  - 新增 `android-native/core/src/test/kotlin/cn/toside/music/core/lyric/DesktopLyricLineTest.kt`（11 例）
  - 新增 `android-native/core/src/test/kotlin/cn/toside/music/core/lyric/DesktopLyricColorTest.kt`（5 例）
  - 新增 `android-native/core/src/test/kotlin/cn/toside/music/core/setting/DesktopLyricSettingKeysTest.kt`（5 例）
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/DesktopLyricConfig.kt`
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/DesktopLyricController.kt`
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/DesktopLyricOverlay.kt`
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/DesktopLyricRow.kt`
  - 新增 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/DesktopLyricService.kt`
  - 修改 `android-native/app/src/main/AndroidManifest.xml`（+`SYSTEM_ALERT_WINDOW`，+`DesktopLyricService`；`screenOrientation="portrait"` 未动）
  - 修改 `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`（+1 import、+`DesktopLyricRow()` 一行）
  - `PlayDetailPage.kt` 未改（入口行自包含，未用到任务 4 的例外）。

- 语义修正与实证发现：

  | 主题 | RN 实证 | Kotlin 落地 |
  | --- | --- | --- |
  | 逐行提前量 | 桌面 `LyricPlayer.offset = 150`；Kotlin 播放页 `LyricParser.DEFAULT_OFFSET_MS = 100` | `DesktopLyricLine.OFFSET_MS = 150`；单测锁 850ms 停第一行、851ms 切第二行 |
  | 显示哪些行 | `LyricView.setLyric`：当前行 + 扩展行，`maxLineNum>1` 且非单行时最多 `maxLineNum` 行；单行模式只当前行 | 同规则；RN `Lyric.java` 只滤掉空串，Kotlin 连纯空白扩展行也跳过；`maxLineNum<=0` 仍显示当前行一次 |
  | 翻译/罗马音开关 | `Lyric.java:193-196` 扩展行受 `isShowTranslation`/`isShowRoma` 控制，并跟随播放页开关（`src/core/lyric.ts:91,101`） | MVP 无桌面独立开关，直接用 `ParsedLyric.extendedLyrics`（与 Kotlin 播放页 `ui/play/LyricView.kt:92` 一致）；差异待后续波次 |
  | 窗口几何 | 宽 `maxWidth*widthPercent/100`；高 `fontMetrics.height*maxLineNum`，封顶 `maxHeight-100`；百分比定位后夹在屏内 | 像素级照搬；RN 在窗口大于屏幕时会出现负坐标，Kotlin 统一归 0 贴左上 |
  | 颜色解析 | `LyricView.parseColor`：先匹配 `rgba?()`，alpha 为 0-1 小数；否则 `Color.parseColor`；失败回退黑 | `DesktopLyricColor` 移植；注意 RN 正则只允许逗号后空格，`rgb( 7 , 197 , 86 )` 会回退黑（已写成用例）；支持 #RGB/#ARGB/#RRGGBB/#AARRGGBB |
  | 位置持久化 | `mergeSetting` 原样复制 JS 原始值，RN 写小数百分比 | **关键差异**：`SettingsStore.merge` 会按默认值类型强转，而 `position.x/y` 默认是 Int `0`，小数会被丢弃成 0。故 Kotlin 统一写四舍五入后的整数百分比；RN 旧版写入的小数在 Kotlin 读侧可能变 0（契约测试 `toggleAndDragRoundTrip` 固化）。`SettingsStore` 属禁触区，未改 |
  | 权限流程 | `DesktopLyricEnable.tsx` 先弹确认框，再跳系统悬浮窗页；回来自检权限，失败则开关落回 false | MVP 直接 toast 后跳 `ACTION_MANAGE_OVERLAY_PERMISSION`；`ON_RESUME` 按系统事实决定起服务或回滚，未授予时提示并关闭 |
  | 冷启动恢复 | `src/core/init/player/lyric.ts:33-35` 启动时若 enable=true 自动恢复浮窗，异常则把 enable 落 false | 无 Application 级钩子（不在范围）：`DesktopLyricController.sync()` 只在「更多」弹层里的行出现时执行；进程被杀后需再开一次弹层才恢复（已记遗留） |
  | 锁定态 | `isLock`：窗口不可触摸、背景透明、透明度 0.8（Android 12+） | 同左；MVP 只读取设置，不提供浮窗内锁定/解锁手势，运行中改 `isLock` 需重开服务才生效 |
  | 单行模式 | `LyricTextView` 做横向滚动 | MVP 用 marquee 截断显示（差异已记） |
  | 服务形态 | RN 是普通 Service + 悬浮窗，无前台通知 | 同；未用前台服务，系统内存紧张时可能被回收（后续波次可评估 FGS/OEM 保活） |

- 遗留问题与对后续波次的建议：
  - **真机 MVP 清单（本 lane 未执行，需在 MIUI/HyperOS 真机逐项验收）**：
    1. 「更多」里开启 → 跳系统悬浮窗授权页，授权返回后浮窗立即出现；拒绝授权返回后开关回 false 且有提示；
    2. 播放/暂停/切歌时歌词按 150ms 提前量逐行切换，无闪烁/重复行；
    3. 拖动浮窗到任意位置，松手后杀进程再开、位置保持（整数百分比）；
    4. 开启 `isLock` 后浮窗不可触摸、背景透明、Android 12+ 透明度 0.8；关闭后可继续拖动；
    5. 关闭开关立即消失，`desktopLyric.enable` 持久化为 false；
    6. 息屏/锁屏后音乐继续时浮窗与歌词是否继续刷新；应用退到后台/被清理后的表现；
    7. 单行模式 marquee 与多行+翻译显示；小窗/分屏/旋转锁定的竖屏下窗口不越界。
  - 冷启动自动恢复：建议在应用初始化处加一次 `DesktopLyricController.get(context).sync()`（需集成会话确认 Application/生命周期入口归属）。
  - `SettingsStore` 数值类型：若后续波次需要与 RN 小数百分比完全互通，应支持 Double 读取或把这组键改成字符串/放大整数；本 lane 未动禁触文件。
  - 桌面歌词设置页（锁定、宽度、最大行数、字号、透明度、播放/未播放/阴影颜色、文字位置）与翻译/罗马音独立开关仍缺；`desktopLyric.style.lyricUnplayColor` 在 MVP 里未被渲染使用（只显示当前行）。
  - 锁定态切换、服务内实时接收设置变更（当前仅在服务启动后 `refreshConfig` 一次）建议后续补观察者。
  - 预存问题：首次全量闸门时 `:core` 既有用例 `PlaybackCoordinatorTest.loadFailureSchedulesNextTrack` 偶发失败（expected `b` but was `a`），单独重跑与该用例类重跑均通过，重跑全量后全绿；本 lane 未触碰 `core/.../player/`，疑似并行负载下的时序 flaky，建议集成会话留意。

