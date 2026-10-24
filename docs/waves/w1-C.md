# Wave 1 · Lane C 任务书 —— S11 B4 剩余弹层（定时关闭/倍速音量/更多菜单/歌词设置持久化）

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> 2026-10-25 重写：桌面歌词（旧 Lane C 的 S10）顺延到 Wave 2（属 B6，且要改
> AndroidManifest，与本波次并行收益低）。

## 背景

B4 首版骨架已完成封面/歌词/播控与列表 sheet，进度文档 B4 待办明确剩余弹层：
「分享卡、定时关闭、音质/音量/倍速、更多菜单、歌词设置持久化」。
其中分享卡依赖 B6 接线不做；本 lane 做其余四项。
B4 文档续接点已给出提示：音量/倍速可直接调 `PlayerRuntime.setVolume/setRate`。

RN 对照入口：`src/screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx`
（⋮ 菜单项与顺序）、`Vertical/Player/lyric/`（字号持久化）、
定时关闭在 RN 的 `useSleepTimer`/设置项（先读 RN 源码实证，再动手）。
注意：RN 侧这些文件在工作区有未提交改动，worktree 里看到的是上一提交版本——
以 worktree 内 RN 代码为准即可，发现的差异记入 lane 报告，不要动 `src/`。

## 任务

1. **更多菜单 sheet**：播放页加「⋮」入口（对照 RN MusicMoreSheet 的项与顺序），
   项目前收录：定时关闭、倍速、音量、歌词字号、译文/音译开关（已有开关的复用）；
   未实现项（分享、桌面歌词）按 RN 灰显或不列出，报告里注明。
2. **定时关闭**：纯逻辑放新文件 `core/.../player/SleepTimer.kt`（倒计时档位、
   取消、到点动作回调——对照 RN 实际语义先实证），JVM 单测锁档位与取消行为；
   UI 只做选择弹层与状态显示。
3. **倍速/音量弹层**：SaltUI `ItemSlider` 调 `PlayerRuntime.setRate/setVolume`
   （既有公开 API，不改 `player/` 内部）；档位范围与默认值对照 RN 设置键。
4. **歌词设置持久化**：播放页字号增减、译文/音译开关写入设置存储
   （`DefaultSetting.kt` 加键，逐键对照 RN `src/config/defaultSetting.ts`，
   RN 没有的不发明）；重启后播放页恢复。
5. **音质显示**：更多菜单只读展示当前音质档位即可，切换仍走设置页（Lane B 范围，
   不重复做）。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/`（整个目录）
- `android-native/core/src/main/kotlin/cn/toside/music/core/player/SleepTimer.kt`（新建）
- `android-native/core/src/main/kotlin/cn/toside/music/core/setting/DefaultSetting.kt`
  （**只许加键**——Lane B 同文件加键，预期纯新增型冲突，集成时保留两侧）
- 新增测试放对应包

## 禁触

- `app/.../player/`、`core/.../player/` 其余文件（PlayerRuntime/PlayerCore 只调用既有
  公开 API；确需新增公开入口时改动最小化并在报告显著标注）
- `ui/settings/`、`userapi/`、`core/.../setting/SettingsStore.kt`、`SettingsRuntime.kt`
  （Lane B 范围；写设置走 SettingsStore/SettingsRuntime 既有公开 API）
- `ui/search/`、`data/SearchRuntime.kt`、`ui/list/`、`data/ListRuntime.kt`
- `core/.../music/leaderboard/`、`ui/leaderboard/`、`data/LeaderboardRuntime.kt`（Lane A 范围）
- `AndroidManifest.xml`、`.github/`、gradle 与版本目录、`src/`（RN 只读）

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- SleepTimer 有 JVM 单测；新增设置键有默认值单测；
- lane 报告按 RULES.md 模板追加到本文件末尾并 commit。

## 真机验收清单（写进报告，由用户执行）

- 定时关闭到点停播、中途取消；倍速/音量滑杆即时生效且切歌后符合 RN 语义；
- 歌词字号/译文开关切页与重启后保持。

---

## Lane 报告（2026-10-25）

- **结论**：S11 五项任务全部落地（更多菜单 sheet / 定时关闭 / 倍速·音量 / 歌词设置持久化 / 音质只读），闸门全绿。剩余只有两类：①「等待歌曲播放完毕再退出」的完整 RN 守卫落在本车道禁触区，本波用可观察状态近似（见遗留问题第 1 条）；②真机验收清单未跑（见文末，需用户执行）。分享卡、桌面歌词按任务书不做。
- **commit**：`5f92c82`（SleepTimer 纯逻辑 + 22 用例）、`fd638fd`（弹层 + 接线 + 剩余用例）、`3b10547`（弹层文案逐条对齐 RN zh-cn）。测试数 **core 335 + app 24 = 359 全绿**（波前实测基线 309 + 19 = 328；本车道新增 SleepTimer 22 + PlaySheetSettingKeys 4 + PlaySettingSheet 5 = 31，无删除）。ktlint 干净；APK `app-debug.apk` 27,489,019 B（波前实测 27,455,355 B，+33,664 B）。最后一次闸门用 `--rerun-tasks --no-build-cache` 强制真跑：61 actionable tasks: 61 executed，1m08s。
- **触碰文件清单**（全在任务书「范围」内；测试按「新增测试放对应包」放置）：
  - `android-native/core/src/main/kotlin/cn/toside/music/core/player/SleepTimer.kt`（新建）
  - `android-native/core/src/test/kotlin/cn/toside/music/core/player/SleepTimerTest.kt`（新建，22 用例）
  - `android-native/core/src/test/kotlin/cn/toside/music/core/setting/PlaySheetSettingKeysTest.kt`（新建，4 用例）
  - `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/TimeoutExitRuntime.kt`（新建）
  - `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/MoreActionSheet.kt`（新建）
  - `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/play/PlayDetailPage.kt`（改：⋮ 入口、字号/译文/音译改为以设置为唯一来源、挂 MoreActionSheet）
  - `android-native/app/src/test/kotlin/cn/toside/music/nativeapp/ui/play/PlaySettingSheetTest.kt`（新建，5 用例）
  - **未改**：`core/.../setting/DefaultSetting.kt`（见语义修正第 14 条，与 Lane B 的同文件冲突因此消除）；`app/.../player/PlayerRuntime.kt`、`core/.../player/PlayerCore.kt`（只调用既有公开 API：`setVolume/setRate/setLyricTranslation/setLyricRoma/playQuality/settings.store` 全部够用，**没有新增公开入口**）

### 语义修正与实证发现（对照本 worktree 内已提交的 RN 源码）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| 任务书指向的 `useSleepTimer` 在 RN **不存在**（全库 grep 无命中）；定时关闭是 `src/core/player/timeoutExit.ts` 的 `timeoutTools` 模块级单例 + 钩子 | 文件按任务书命名 `SleepTimer.kt`，语义逐条对齐 `timeoutExit.ts`；单例挂点放在 app 层 `TimeoutExitRuntime` |
| 到点动作是 **`exitApp('Timeout Exit')` 退进程**，不是暂停/停播（timeoutExit.ts:16-21） | `onDeadlineReached` → `onExitApp`；`TimeoutExitRuntime.exitApp()` = `stopPlayback()` + `exitProcess(0)` |
| `getTime()` = `max(time - round((now-start)/1000), -1)`，差值用**四舍五入**而非 floor | `remainingSeconds()` 用 `roundToInt()`；边界已锁测（真实经过 400ms 就少 1 秒：400→60、500→59） |
| `clearTimeout()` 在没有活动计时器时**直接 return**，既不重置也不通知（:33） | `cancel()` 同语义（否则 UI 会收到多余的 -1 事件） |
| 到点顺序是「先 `clearTimeout()` 再 `exit()`」（:45-47），监听者先看到已关闭 | `onDeadlineReached()` 先 `cancel()`（UI 见 OFF）再置 `isPlayedStop` 通知（UI 见 WAITING_EXIT） |
| `exit()` 只在 `player.timeoutExitPlayed && playerState.isPlay` 时置标志；**暂停态到点 = 直接退进程** | `waitUntilSongEnd() && isPlaying()` 两支，单测都锁了 |
| `player.timeoutExit` 只用于**回填输入框**（TimeoutExitEditModal.tsx:157），RN 没有开机续跑定时 | 同样只回填，不起表 |
| 任务书说「倒计时档位」，RN 没有预设档位：自由输入分钟数 + `MAX_MIN=1440` + `rxp=/([1-9]\d*)/` 抽取（"abc12"→12、"30分钟"→30、"0"→输入错误、空→静默 return） | `SleepTimer.parseMinutes` 四支（Valid/TooLong/Invalid/Empty）逐条对齐并锁测；UI 用 `InputDialog` 输入分钟 |
| `removeTimeHook` 用 `splice(indexOf(hook),1)`（:58），传未注册钩子时 indexOf=-1 会**误删最后一个钩子** | 按身份 `remove(listener)`，不复现该缺陷（RN 侧建议核查） |
| 定时关闭入口在**控制排** `MoreBtn/TimeoutExitBtn.tsx`（图标 music_time）+ `TimeoutExitEditModal`；音量/倍速/字号在**头部** `LyricSettingSheet.tsx`（slider 图标，仅歌词页可见）；RN 的 ⋮（`MusicMoreSheet.tsx:47-51`）装的是「下一首/不感兴趣/加歌单/换源/下载」 | 按任务书把三类合成一张 ⋮ 面板（面板 KDoc 已写明）。**形状与 RN 不一致，属产品决策**，见遗留问题第 3 条 |
| 歌词字号**拖动不预览**：歌词行直接 `useSettingValue()/10`（`Vertical/Lyric.tsx:101-103`），滑杆只在 `onSlidingComplete` 写设置（`SettingLrcFontSize.tsx:27-34`） | 字号滑杆只在松手提交；音量/倍速则是拖动即时作用播放器、松手落库、与已存值相同不写（`SettingVolume.tsx:24-33`、`SettingPlaybackRate.tsx:30-42`） |
| RN 取值一律 `Math.trunc(setting*100)`（音量/倍速） | `storedVolumePercent/storedRatePercent` 用 `.toInt()` 截断，**不用 roundToInt**（0.99999 不能被读成 100） |
| 「重置速率」在已 1 倍速时**什么都不做**（`SettingPlaybackRate.tsx:44-45`） | 同语义（本地 `ratePercent` 也不回写） |
| 任务书要求 `DefaultSetting.kt` 追加的键（`player.timeoutExit`/`timeoutExitPlayed`/`playDetail.vertical.style.lrcFontSize`/`player.volume`/`playbackRate`/`isShowLyricTranslation`/`isShowLyricRoma`/`player.playQuality`）**已全量存在**（从 RN `defaultSetting.ts:27-51` 移植） | 不改 `DefaultSetting.kt`；新增 `PlaySheetSettingKeysTest` 钉住「键存在 + 默认值与 RN 一致 + 弹层用的 getter 读写往返不丢类型」 |
| `SettingsStore._state` 初始值就是默认表，未 `load()` 也读得到正确默认（不会读成 0/false） | 播放页仍显式 `ensureLoaded()`，并用测试锁住这条，防止日后改成空表 |
| SaltUI 3.0.0-beta03：`Slider` 是 internal，公开入口只有 `ItemSlider`；仓库无公开 Modal/BottomSheet；`Item/ItemSlider/ItemSwitcher/InputDialog` 都带 `UnstableSaltUiApi` | 面板沿用本页 `PlaylistSheet` 的手写底部面板形状；`@OptIn(UnstableSaltUiApi::class)` **漏标是编译器错误（OPT_IN_USAGE_ERROR）而非警告** |
| Kotlin 语言事实：lambda 参数的隐式标签是**函数名**而不是参数名 | `return@onValueChangeFinished` 报 Unresolved label，已改正向条件判断（语义不变） |
| Kotlin 语言事实：`Flow.drop` 需要 `import kotlinx.coroutines.flow.drop`，漏 import 报 Unresolved reference | 该处改用本地标记位跳过初始快照，少一个导入 |
| `PlayerRuntime.setLyricTranslation/setLyricRoma` 会把读取 lambda **覆写成常量**并落库（既有实现，本车道未改） | 播放页与 Lane B 设置页都以 `settings.state` 为显示来源，两处写同一个 key，无冲突 |
| `StateFlow` 被 collect 时先吐当前快照：到点置位后立刻订阅会「一到点就退」而不是「等这首歌放完」 | `watchUntilSongEnd()` 跳过第一帧，等曲目/播放态真的变化再退（近似 RN `service.ts:134/143`） |
| 面板各处文案在 RN 里有权威 i18n 键：`play_detail_setting_title`=播放器设置、`play_detail_setting_volume`=音量大小、`play_detail_setting_playback_rate`=播放速率、`play_detail_setting_playback_rate_reset`=**重置**（不是「重置速率」）、`play_detail_setting_lrc_font_size`=歌词字体大小、`setting_play_show_translation`=显示歌词翻译（如果可用）、`setting_play_show_roma`=显示歌词罗马音（如果可用）、`timeout_exit_tip_off/on/max/cancel`、`timeout_exit_label_isPlayed`、`timeout_exit_btn_wait_tip`、`input_error`=**不要乱输好吧😡**（zh-cn.json:116，原文带表情） | 全部逐字对齐（`PlaySettingSheetTest` 锁了 `timeout_exit_tip_off/on` 两支文案）；表情文案照抄 RN，若产品想换温和说法，改 `MoreActionSheet` 里那一行即可 |
| RN 的定时关闭走 `ConfirmAlert`，**弹窗没有标题**（只有状态行 + 输入框 + 「分钟」后缀 + 复选） | 本波用手写底部面板，标题自加「定时停止播放」；另自加一处「设置定时 / 更新定时」行的 sub（回填上次分钟数，RN 靠输入框本身回填）。输入框提示仍是 RN 的 `timeout_exit_input_tip`；`SleepTimer.formatTime` + `timeout_exit_tip_on` 拼出的字符串与 RN 完全一致 |

### 遗留问题与对后续波次的建议

1. **「等待歌曲播放完毕」只做到近似（本车道最重要的一条）**。RN 靠 `global.lx.isPlayedStop` 在播控内部多道守卫生效：`core/player/player.ts:53/123/128` 挡住取链与自动下一首，`core/init/player/player.ts:19/25` 在状态变化时 `pause()`，`playerEvent.ts:54/64/94`，`plugins/player/service.ts:134/143` 在 `PlaybackState`/`PlaybackTrackChanged` 时 `handleExitApp('Timeout Exit')`；并且 `player.ts:255/691` 会在用户主动播放/切歌时 `isPlayedStop &&= false`（即**用户手动继续播放就撤销待退**）。`app/.../player/` 与 `core/.../player/` 其余文件是 Lane C 禁触区，所以本波：**没有挡住「播完自动跳下一首」**，实际表现可能是切到下一首之后才退；也**没有**「用户按播放即取消待退」这条清零路径（只能靠面板里的「取消退出」）。→ 建议 Wave 2 由播控车道把 `SleepTimer.isPlayedStop` 上升为 PlayerCore 的守卫点（逐条对照上面 RN 行号），并把退出从 `exitProcess(0)` 换成 Activity 收尾。
2. **退出实现**：`exitApp()` = `stopPlayback()`（800ms 宽限）+ `exitProcess(0)`。用 `exitProcess` 是因为定时可能在本页之外到点，而 `MainActivity` 在本车道范围外拿不到句柄；RN 侧对应的是原生模块 `exitApp()`。真机需确认通知/前台服务是否随进程一并拆掉。
3. **⋮ 的形状需要产品拍板**：本波把「播放设置」合进了 ⋮，而 RN 的 ⋮ 是「歌曲操作」（下一首/不感兴趣/加歌单/换源/下载），设置走头部 slider 图标且只在歌词页出现。后续移植 `MusicMoreSheet` 时会撞同一个入口位置——建议集成会话二选一：①本面板改名「播放设置」并把入口换成 slider 图标，⋮ 留给歌曲操作；②维持合并。
4. **RN `LyricSettingSheet` 里本波未收录的两项**：`SettingLrcAlign`（歌词左/中/右对齐）与 `SettingLyricProgress`（进度显示开关）。Kotlin 歌词页目前恒居中、无进度显示，任务书也没列，属后续波次。
5. **A-/A+ 与 RN 不同**：committed RN 播放页没有 ±字号按钮（只有滑杆，步进 2 即 0.2sp）；Kotlin 的 A-/A+ 是 B4 首版自加。本波把它的 ±1sp 改成**直接写设置**（唯一来源已收敛到 store），并夹在 RN 区间 100..300（10.0–30.0sp）。若要完全对齐 RN 可去掉这两个按钮。
6. **RN 侧潜在缺陷（不动手，仅登记）**：`timeoutExit.ts:58` 的 `removeTimeHook` 见语义修正表；主仓库里播控相关文件有未提交改动，本车道按 RULES 只对照 worktree 内已提交版本，未查看主仓库。
7. **给集成会话的文档修正**：进度文档「验证基线」的 APK 27,589,564 B 与波前实测 27,455,355 B 不一致（-134,209 B），建议按实测更新；测试基线建议同步为 core 335 + app 24。
8. `SettingsPage.kt:60` 对 `player.isShowLyricTranslation` 的兜底写的是 `?: false`，RN 默认是 `true`（`defaultSetting.ts:41`）。当前不会触发（store 里有默认表），但若日后改成可空来源就会静默变关——属 Lane B 文件，本车道未动。

### 真机验收清单（由用户执行；本车道只保证 JVM 闸门全绿）

1. 播放页头部出现「⋮」，点击从底部升起标题为「播放器设置」的面板；点遮罩能把面板关掉。
2. 定时关闭：输入 `1` → toast「01:00 后停止播放」，面板首行与 ⋮ 里「定时关闭」的副标题同步倒计时；输入 `abc` → toast「不要乱输好吧😡」（RN 原文案）且不启动；输入 `1441` → toast「最多只能设置 1440 分钟哦」且不启动；清空后直接确定 → 无任何反应。
3. 倒计时进行中退出播放页、回首页、甚至杀掉播放页，表**不停**（进程级单例）。
4. 「取消定时」→ 倒计时行回到「设置定时停止播放」，到点不再退出。
5. 打开「等待歌曲播放完毕」且正在播放 → 到点**不立刻退**；记录实际退出时机（本波近似：下一次曲目/播放态变化才退，可能先切到下一首，见遗留问题第 1 条）。
6. 关掉「等待歌曲播放完毕」→ 到点直接退出应用。
7. 待退状态下按「取消退出」→ 不再退出（RN 里用户手动播放也会撤掉待退，本波不会，见同条）。
8. 音量滑杆：拖动即时变响度；松手后杀进程重进，音量保持（试 0 / 50 / 100 三点）。
9. 倍速滑杆：0.60x / 1.00x / 2.00x 拖动后歌词跟随速度符合预期；「重置」按钮在非 1x 时回到 1.00x，已是 1x 时按下去无反应（按钮文案就是 RN 原文「重置」，不是「重置速率」）。
10. 歌词字号：拖动滑杆时歌词**不变**、松手才变（对齐 RN）；A-/A+ 每次 ±1sp 并立即生效；切页、杀进程重进后保持；脏值（如 9999）夹回 30.0sp。
11. 译文 / 罗马音两个开关：与设置页同名字开关状态一致，切页与重启后保持；无译文/无音译的歌曲上开关不报错、歌词行不占位。
12. 面板底部「当前音质 · xxx」与设置页所选音质一致（只读，不可点）。
