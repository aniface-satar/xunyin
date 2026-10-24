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
