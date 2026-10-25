# Wave 3 · Lane A 任务书 —— S8 播控与持久化二轮包

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> **已按 Wave2 并入后快照复核修订**（2026-10-25，协调会话；快照提交为
> `chore(wave3): 任务书按 Wave2 合并后快照修订` 的上一提交 `e7f390a`）。
> **验证基线**：`:core` 470 + `:app` 68 = **538** 全绿（协调会话 `--rerun-tasks`
> 强制实测：61 actionable tasks 全 executed，2m11s，failures/errors/skipped 全 0）。
> 开工自检只许等于或大于这个数。

## 背景

进度文档两处明确欠账都落在播控/持久化侧：
1. B3 待办：`player.volume` / `player.playbackRate` / `player.isSavePlayTime`
   **三键只有写、没有读**——设置页会写、能即时生效，但 `PlayerRuntime` 启动时
   不回读，播放进度记忆没有消费者。
2. B6 桌面歌词 MVP 后续（Wave2 Lane B 报告遗留）：冷启动自动恢复、完整设置页
   （宽度/行数/颜色）、锁定态实时切换、单行横向滚动、FGS/OEM 保活评估；
   以及 `SettingsStore` 数值类型若要和 RN 的小数百分比互通需改造。
3. Wave2 集成记录遗留 8：既有 flaky `PlaybackCoordinatorTest.loadFailureSchedulesNextTrack`
   ——本 lane 是 `app/.../player/` 波内唯一持有者，负责排查时序假设。

## 任务

1. **三键回读**：`PlayerRuntime` 启动路径按设置回读 volume/playbackRate 并下发；
   `isSavePlayTime` 打开时落盘/恢复播放进度（对照 RN `player.ts` 的
   `playerPlayTime` 读写时机与「进度记忆只在同曲恢复」语义，先实证再写，
   结论进报告「语义修正」节）。
2. **桌面歌词二轮**（对照 Wave2 Lane B 报告列的后续项，按投入产出排序执行，
   做不完的写明剩余）：
   - 冷启动自动恢复（开关为开 + 有在播曲时重建浮窗）
   - 设置页桌面歌词小节（宽度/行数/单行/字号/透明度/颜色，逐键对照 RN
     `src/config/defaultSetting.ts:55-69` 的 `desktopLyric.*`；入口放设置页，
     与播放页更多菜单开关同源）
     **复核结论：15 个 `desktopLyric.*` 键在 `DefaultSetting.kt:60-74` 已全量存在
     （含新年皮肤覆盖），`app/.../lyric/DesktopLyricConfig.kt` 的 `DesktopLyricKeys`
     也已把它们全部命名，预期 `DefaultSetting.kt` 零改动**；改为键契约测试即可，
     确缺键才在表尾追加。
   - 锁定态实时切换（不重启服务）
   - `SettingsStore` 数值互通改造（若动 `core/.../setting/SettingsStore.kt`，
     既有 8+ 用例不许变红，新增双格式用例）
3. **播控遗留收口**（进度文档 B4 续接点：Wave1 集成遗留项 1，Wave2 无播控车道未认领）：
   `SleepTimer.isPlayedStop` 现为近似实现，按 RN 语义上升为 `PlayerCore` 守卫点，
   并把到点退出从 `exitProcess(0)` 换成正规 Activity/服务收尾（对照 RN 停止链路）。
   这条是本 lane 独占 `player/` 后才可能做的，改前先在报告记录 RN 实证。
   **复核结论（2026-10-25，任务仍未收，Wave2 期间没人修）**：`SleepTimer.isPlayedStop`
   仍只存在于 `core/.../player/SleepTimer.kt`（`PlayerCore` 无守卫点）；
   `app/.../ui/play/TimeoutExitRuntime.kt:161` 仍是 `exitProcess(0)`。
   RN 守卫行号沿用进度文档 Wave1 遗留项 1 的完整清单（`core/player/player.ts:53/123/128`、
   `core/init/player/player.ts:19/25`、`playerEvent.ts:54/64/94`、
   `plugins/player/service.ts:134/143`、`player.ts:255/691` 清零点）。
4. **flaky 排查**：复现 `loadFailureSchedulesNextTrack`（并行负载/时序假设），
   修或给出定位结论；只动测试或 `PlaybackCoordinator` 的时序，不改失败重试语义。
5. OEM 保活评估：只调研写报告（FGS 类型/厂商白名单），不实现。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/player/`（整个目录，本波独占）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/lyric/`（整个目录，本波独占）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/`（加桌面歌词小节）
- `android-native/core/src/main/kotlin/cn/toside/music/core/setting/`（DefaultSetting 表尾追加；
  **复核后预期零改动**，见任务 2；SettingsStore 改造仅限数值互通）
- `android-native/core/src/main/kotlin/cn/toside/music/core/player/` 既有文件
  （仅 SleepTimer/flaky 相关的最小改动，逐处记报告）
- `android-native/app/src/main/AndroidManifest.xml`（仅桌面歌词服务 FGS 类型相关行；禁动方向属性）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`
  （播放页「更多菜单」sheet 的实际文件名；桌面歌词行现为 `:182 DesktopLyricRow()`，
  只调这一行接线）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/TimeoutExitRuntime.kt`
  （任务 3 的退出收尾；其余 `ui/play/` 文件仍禁触，`CoverImageLoader.kt` 归 Lane C）
- 新增测试放对应包

## 禁触

- `ui/HomePage.kt`、`HomeNavigator.kt`、`ui/songlist/`、`core/.../recommend/`（Lane B 范围）
- `ui/search/`、`data/SearchRuntime.kt`、`core/.../music/search/`、`ui/list/`（Lane C 范围）
- `userapi/`、`core/.../userapi/`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 三键回读/进度记忆有 JVM 单测（FakePlatform 注入）；设置键默认值单测；
- flaky 结论（修复或定位）写报告；真机清单（回读生效、冷启动恢复浮窗、锁定实时切换）写报告；
- lane 报告按 RULES 模板追加到本文件末尾并 commit。
