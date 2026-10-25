# Wave 3 · Lane A 任务书 —— S8 播控与持久化二轮包

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> ~~已按 Wave2 并入后快照复核修订（快照基点 `e7f390a`，基线 core 470 + app 68）~~
> **Lane A 已于 2026-10-25 完成并并入 main（`e6a31aa`），报告见文末「Lane 报告」节。**
> 本文件对 Lane B/C 会话现为只读参考：基线与冲突面以 w3-B/w3-C 为准
> （Lane A 并入后基线 **core 488 + app 72 = 560** 全绿，实测 APK 27,865,102 B）。

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

---

## Lane 报告（2026-10-25）

- **结论：完成 1–4；任务 5 按要求只调研未实现。** 三键回读、播放进度记忆、桌面歌词二轮
  （冷启动恢复 / 设置页小节 / 锁定态实时刷新）、`isPlayedStop` 上升为 `PlayerCore` 守卫并
  替换 `exitProcess(0)`、flaky 定位与加固全部落地；剩余为真机清单（本环境无真机）与 OEM
  保活的实现决策（本波明确不做）。
- **commit**：`7601d5d`（任务 1）、`e57063e`（任务 2/3）、`ed237bb`（任务 4）；测试数
  **core 488 + app 72** 全绿（`ktlintCheck test assembleDebug` 通过，2026-10-25）。
  注：`e57063e` 消息里写的 477+68 是当时局部任务的预估，实际全量为 488+72。

### 触碰文件清单

任务 1（三键回读 / 进度记忆）：

- 新增 `app/.../player/PlayInfoStore.kt`、`app/.../player/PlayerStartupSettings.kt`
- 改 `app/.../player/PlayerRuntime.kt`
- 新增 `core/.../player/PlayProgressMemory.kt`
- 改 `core/.../player/PlayerCore.kt`
- 新增测试 `app/.../player/PlayerStartupSettingsTest.kt`、
  `core/.../player/PlayProgressMemoryTest.kt`、`core/.../player/PlayerRestoreTest.kt`

任务 2/3（桌面歌词二轮 / 播控收口）：

- `app/.../lyric/DesktopLyricController.kt`、`app/.../lyric/DesktopLyricService.kt`
- 新增 `app/.../ui/settings/DesktopLyricSettingsSection.kt`；改 `app/.../ui/settings/SettingsPage.kt`
- 改 `app/.../ui/play/TimeoutExitRuntime.kt`
- 改 `app/.../player/PlayerRuntime.kt`
- 改 `core/.../player/PlayerCore.kt`、`core/.../player/PlaybackCoordinator.kt`、
  `core/.../player/SleepTimer.kt`、`core/.../setting/SettingsStore.kt`
- 测试 `core/.../player/PlaybackCoordinatorTest.kt`、`PlayerCoreTest.kt`、
  `SleepTimerTest.kt`、`core/.../setting/SettingsStoreTest.kt`

任务 4（flaky）：

- `core/.../player/PlaybackCoordinatorTest.kt`（仅测试）

未动 `AndroidManifest.xml`（现有 FGS 声明已满足）、未动 `DefaultSetting.kt`（15 个
`desktopLyric.*` 键复核齐全）、未动 `MainActivity.kt` / `MusicApp.kt`（用
`Application.registerActivityLifecycleCallbacks` 在 `PlayerRuntime` 内部跟踪前台 Activity）。

### 语义修正与实证发现

| 主题 | RN 实证 | Kotlin 落地 |
| --- | --- | --- |
| `isPlayedStop` 归属 | 定时到点且「等待播完 + 正在播」时置 `global.lx.isPlayedStop`，不是退出应用；`player.ts:53/123/128`、`playerEvent.ts:54/64/94` 做延迟下一首/取链/加载/错误的守卫；`core/init/player/player.ts:19` 在暂停时停下，`:25` 在播完时以 `player__end` 收尾；`player.ts:255/691` 在手动播放/切换播放时清标记 | 标记上升为 `PlayerCore.isPlayedStop`（单一真源）；`PlaybackCoordinator` 在 paused/ended/loadstart/loadtimeout/failed 与延迟下一首回调前检查；`SleepTimer` 通过可空 provider 委托，未接 provider 时保留本地回退（既有单测不受影响） |
| 到点收尾 | `service.ts:25` 的 `handleExitApp` 清标记后走 `core/common.ts exitApp`：收桌面歌词 + 销毁播放器 + 关浮窗 + `utilExitApp` | `PlayerRuntime.shutdown()` 依次：800ms 限时 `stopPlayback` → 关桌面歌词服务 → 释放音量均衡 → 释放平台 → 停 `PlaybackService` → `finishAndRemoveTask()`；用 `shuttingDown` 防重入，替代原 `exitProcess(0)` |
| 进度记忆 | `playProgress.ts` 两处保存点：2 秒节流（仅播放中 + `isSavePlayTime` + 非临时曲 + 亮屏）与 `musicToggled` 无条件保存（此时进度已归零，仅记住曲目）；恢复只在**同列表同索引**成立，`isSavePlayTime` 只决定时间是否还原，`maxTime` 总是还原 | `PlayProgressMemory` 按同一判定实现（节流退化为「距上次不足 2 秒跳过」，最坏晚约 2 秒落盘）；`index` 明确为列表内索引；冷启动 `restorePlayInfo` 校验列表/索引后才恢复 |
| `SettingsStore` 数值互通 | RN 的 `desktopLyric.width` / `style.fontSize` 等经 JSON 落盘，可能出现小数形式（如 `72.0`）；Kotlin 原实现 `is Int` 分支只试 `toIntOrNull()`，小数会被丢弃回落默认值 | Int/Long 分支增加「先整数、再按 `toDouble()` 截断」的回退；新增小数 JSON 用例锁死（`72.0→72`、`200.0→200`、`33.5→33`，与 JS 数值转 Int 的截断一致） |
| 桌面歌词配置刷新 | Wave2 只能在服务启动时读一次配置 | `DesktopLyricService` 改为 `ensureLoaded()` 后先 `refreshConfig()`，再持续收集 `SettingsStore.state`；锁定/宽度/行数/字号/透明度/颜色/对齐均无需重启服务 |
| flaky 用例 | `loadFailureSchedulesNextTrack` 依赖「切歌一定在 100ms 内完成」，并行负载下是时序赌博 | 8 次隔离 `--rerun-tasks` + 全量 `:core:test` 均未复现；改为 `withTimeout(3s)` 轮询当前曲目 id 的条件等待。阴性对照：把 `nextDelayMs` 临时改成 5s（超出等待上限）后用例确定性失败，恢复 1ms 后通过；失败重试语义未改 |

### 任务 5：OEM 保活调研（仅调研，未实现）

**现状盘点**

- `PlaybackService` 已是 `MediaSessionService`，Manifest 声明 `foregroundServiceType="mediaPlayback"`，
  且已申请 `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MEDIA_PLAYBACK` / `POST_NOTIFICATIONS`；
  Android 14 起要求的类型与权限已满足，**无需为本波改 Manifest**。
- `DesktopLyricService` 是**普通 Service**（无 FGS 类型）。应用退到后台后它没有前台身份，
  是浮窗被 OEM 杀死的首要风险点；Wave2 MVP 报告已记「无前台服务」，本波未改变。
- `WAKE_LOCK` 与 `SYSTEM_ALERT_WINDOW` 已声明；media3 自带音频焦点与 MediaSession 通知。

**系统层约束（官方文档）**

- Android 14（API 34）：FGS 必须声明类型并持有对应权限；后台启动 FGS 受限，媒体会话/
  媒体按钮等系统入口属于常见豁免路径（具体以各版本 `BackgroundStartPrivileges` 文档为准）。
- Android 15（API 35）：`dataSync` / `mediaProcessing` 有 6 小时/24 小时运行上限；
  **`mediaPlayback` 不在限时范围内**，长时间播放不需要靠闹钟/JobScheduler 复活。
- Doze / App Standby 对前台服务进程不挂起，但低内存与 OEM 自定义策略仍可直接杀进程；
  被杀后系统可重建 `MediaSessionService`，重建时需保证 `PlayerRuntime` 单例状态可恢复
  （当前 `PlaybackService` 与 UI 共用单例，冷重建路径需真机复核）。

**厂商白名单（用户侧唯一可靠手段）**

| 厂商 | 需要打开的开关（路径名随系统版本略有差异） |
| --- | --- |
| 小米/红米（MIUI/HyperOS） | 省电策略 → 无限制；自启动打开；最近任务卡片下拉锁定 |
| 华为/荣耀（EMUI/MagicOS） | 应用启动管理 → 手动管理（自启动 / 关联启动 / 后台活动） |
| OPPO/一加/realme（ColorOS） | 允许自启动 + 允许后台运行；耗电管理 → 允许后台高耗电 |
| vivo/iQOO（OriginOS） | 自启动打开；电池 → 后台耗电管理 → 允许后台高耗电 |
| 三星（One UI） | 电池 → 后台使用限制 → 从「休眠应用」移除 |
| 原生 Android | 应用信息 → 电池 → 不受限制 |

**建议（留给后续波次拍板，本波不实现）**

1. 不做 1px 前台 Activity、定时闹钟拉起、双进程互拉等黑产式保活：耗电、违反商店政策、
   且在 OriginOS/ColorOS 上大多已被封堵。
2. 优先把「桌面歌词浮窗」做成有前台身份的组件：Android 14+ 可用 `specialUse` 类型并声明
   用途属性，或绑定到正在播放的 `mediaPlayback` 会话生命周期；这比引导用户点白名单更根本，
   但需要单独设计通知与权限退避，建议下一波单独立项。
3. 增加「后台播放帮助」页：按 `Build.MANUFACTURER` 展示对应厂商步骤；可选提供
   `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 入口（必须由用户点击触发，不自动弹）。
   该页放在设置页，属于后续 UI 工作，本波未改布局。

### 真机清单（本环境无真机，全部待验）

1. 三键回读：设置音量 60% / 倍速 1.25 后杀进程冷启，首曲音量与倍速生效；改回默认再冷启一致。
2. 进度记忆：开 `isSavePlayTime` 播到 1:30 暂停并杀进程 → 重进同列表同曲从 1:30 起；
   关闭开关 → 从 0 起但曲目仍记住；换列表/索引失效 → 不恢复且不崩溃。
3. 桌面歌词冷启动：开关为开且上次在播 → 冷启后浮窗重建、位置/样式正确；开关为关 → 不出现。
4. 设置页桌面歌词小节：宽度/行数/单行/字号/透明度/颜色/对齐逐项修改，浮窗即时生效（不重启服务）；
   与播放页更多菜单开关同源，任一侧修改另一侧同步。
5. 锁定态实时切换：播放中锁屏/解锁切换「锁定」开关，浮窗触摸穿透与透明度立即变化，服务不重启。
6. 定时退出：关「等到歌曲播完」到点 → 界面退出、通知消失、服务停止、无残留进程；
   开且正在播 → 到点只停播不退出，播完自动收尾；到点前手动下一首/切播放 → 取消等待标记，
   不误退。

### 遗留问题与对后续波次的建议

1. `DesktopLyricService` 无前台身份（见任务 5 建议 2），后台长时间亮浮窗仍可能被 OEM 杀；
   Wave2 遗留的「FGS 化」未在本波实现。
2. 桌面歌词设置页目前覆盖宽度/行数/单行/字号/透明度/颜色/对齐/锁定/动画；RN 的「新年皮肤」
   等特殊覆盖与自定义颜色输入未逐项对齐，若后续要求像素级一致需单独排期。
3. `PlayProgressMemory` 的节流是「距上次不足 2 秒跳过」，RN 是 leading+trailing 定时器；
   差异仅在最后一次进度最坏晚约 2 秒落盘，已写入注释，若真机验收发现丢进度可改为定时器。
4. `shutdown()` 依赖 `Application.ActivityLifecycleCallbacks` 跟踪前台 Activity；多 Activity
   或分屏场景未验证（本应用单 Activity + 固定竖屏，风险低）。
5. 进度文档「验证基线」仍记 core 470 + app 68，本 lane 后实际为 488 + 72，请集成会话汇总时更新。
