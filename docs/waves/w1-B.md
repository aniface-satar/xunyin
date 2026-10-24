# Wave 1 · Lane B 任务书 —— S5 设置页扩展 + 自定义源管理

> 本文件是 Lane B 会话的唯一任务指令。开始前先读本目录规则（上两节）与本文全文。
> 2026-10-25 按波前快照复核：任务仍全部未完成，任务书继续有效。
> 注意：`DefaultSetting.kt` 本 lane（音源更新设置键）与 Lane C（歌词设置键）都会加键，
> 只许**追加**、不动既有条目，集成会话保留两侧。

## 背景

B3 已完成音源运行时、更新流全链路，但自定义源仍无存储/列表（`UserApiSourceStore`
只读内置源清单）；B5 第四切片已建设置存储与设置页基础。本 lane 按 B3 续接点第 2 条
打通自定义源管理，并扩展设置页。

## 任务

1. **自定义源管理**：导入（URL/粘贴脚本）、列表、启停、更新地址编辑、日志页。
   把源清单从 `BuiltinSourceRepository` 抽象为可写目录，让 `UserApiSourceStore` 的
   `list/find/scriptOf` 走同一份数据（文档 B3 续接点明确此做法）。
2. **音源更新设置**：频率/自动更新/弹窗开关从硬编码默认值改为读 `SettingsStore`，
   替换 `UserApiRuntime.updaterSettings`。
3. **设置页补齐**（逐键对照 RN `src/config/defaultSetting.ts`，RN 没有的不发明）：
   - 缓存大小显示与清理（接已有 `AppCache`）
   - 电池优化豁免与通知权限入口（接已有 `SystemSettings`）
   - 倍速/音量偏好、播放进度记忆
4. **B3 已知差异评估**：`formData`（multipart）缺口是否实际需要，结论写 lane 报告。

## 范围（只许改这里）

- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/`（整个目录）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/userapi/`（QuickJS 引擎
  与运行时仅在接线必需时最小改动）
- `android-native/core/src/main/kotlin/cn/toside/music/core/userapi/`
- `android-native/core/src/main/kotlin/cn/toside/music/core/setting/`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/SettingsRuntime.kt`
- 新增测试放对应包。

## 禁触

- `core/.../music/leaderboard/`、`core/.../list/`、`ui/leaderboard/`、
  `LeaderboardRuntime.kt`、`ui/search/`、`data/SearchRuntime.kt`（其他 lane/会话范围）
- `ui/play/`、`lyric/`（Lane C 与 B4 范围）
- `.github/`、gradle 与版本目录、`AndroidManifest` 的 `screenOrientation`

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- 自定义源导入→列表→启停→更新地址编辑全链路有 JVM 单测（用 InMemory KvStore）；
- 更新设置接 SettingsStore 有单测；
- lane 报告 `docs/waves/w1-B.md` 按模板写好并 commit。
