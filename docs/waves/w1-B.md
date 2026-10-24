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

---

## Lane 报告（2026-10-25）

- 结论：**完成**（任务书 4 项全部落地）。自定义源管理页（按地址导入 / 粘贴脚本导入 /
  源列表 / 换源 / 更新地址编辑 / 检查更新 / 删除）、音源日志页、设置页补齐（缓存统计与清理、
  电池优化豁免、通知权限、音量与倍速滑杆、记住播放进度、音源更新三键）全部实现；
  源清单已从 `BuiltinSourceRepository` 抽象为可写目录（`UserApiSourceStore`），
  `list/find/scriptOf` 走同一份数据；`UserApiRuntime.updaterSettings` 的硬编码默认值
  已换成 `UpdaterSettingsFrom.of(settings.store)`。**剩下的是真机视觉与手感验收**（JVM 测不到）。
- commit：`79933e8`（纯规则 UserApiCatalog + 用例）、`cb5f451`（可写目录 + 更新设置读
  SettingsStore）、`a55761a`（三个页面 + 格式化 + 用例）；
  测试数 **core 333 + app 57 全绿**（基线 core 309 + app 19；`ktlintCheck test assembleDebug` 全绿）。
- 触碰文件清单（路径相对 `android-native/`）：
  - `core/src/main/kotlin/cn/toside/music/core/userapi/UserApiCatalog.kt`（**新**：源清单的纯规则
    ——播种、导入建条目、更新地址编辑与拉黑、下架交接、当前源挑选，含 `MAX_SOURCE_COUNT` / `canImport`）
  - `core/src/test/kotlin/cn/toside/music/core/userapi/UserApiCatalogTest.kt`（**新**：24 用例）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/userapi/UserApiSourceStore.kt`（改：由只读内置清单
    重写为可写目录落盘层；`importScript` 先查数量再验脚本）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/userapi/UserApiSourceSelector.kt`（新：当前源解析与回落）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/userapi/BuiltinSources.kt`（改：随包目录接口
    `BuiltinSourceCatalog`，脚本正文留在 assets）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/userapi/UserApiUpdater.kt`（改：
    `UpdaterSettingsFrom` 读 SettingsStore；`apply(id, preview, allowDowngrade)` 接受 `Older`）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/userapi/UserApiRuntime.kt`（改：`logsEnabled`
    开关门控脚本日志；暴露 `store / updater / sources() / importScript / importFromUrl /
    switchSource / removeSource / logs / clearLogs`）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/SettingsPage.kt`（改：三组新内容 +
    两个子页入口；子页用本地状态整页切换 + 内层 `BackHandler`）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/UserApiManagePage.kt`（新）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/UserApiLogsPage.kt`（新）
  - `app/src/main/kotlin/cn/toside/music/nativeapp/ui/settings/SettingsFormat.kt`（新：纯格式化）
  - `app/src/test/kotlin/cn/toside/music/nativeapp/userapi/UserApiSourceStoreTest.kt`（**新**：22 用例，
    含「导入→列表→启停→更新地址」全链路与数量上限）
  - `app/src/test/kotlin/cn/toside/music/nativeapp/userapi/UpdaterSettingsTest.kt`（新：4 用例）
  - `app/src/test/kotlin/cn/toside/music/nativeapp/ui/settings/SettingsFormatTest.kt`（新：12 用例）
  - `docs/waves/w1-B.md`（本报告）
- 语义修正与实证发现（对照 RN 源码实证）：

  | RN 实际行为（易误解点） | Kotlin 移植遵循 |
  |:--|:--|
  | `ImportBtn.tsx` 拦的是 `list.length > 20`，也就是能存到 **21** 个，和它自己那句「最多只能同时存在 20 个源」差一个 | 原生按文案来：`UserApiCatalog.MAX_SOURCE_COUNT = 20`，满 20 拒收；core 与 app 各一条用例锁死 |
  | 自定义源没有「停用」开关：`userApi.list` 里存在的源都可被选中，删除走长按确认 | 界面用「使用这个源」+「删除这个源」表达启停；正在用的源与随包内置源都不许删 |
  | `global.lx.isEnableUserApiLog` 默认关且不落盘，重启回到关 | `UserApiRuntime.logsEnabled` 同为进程级、不持久化；更新检查/回滚这类结论不受开关影响，始终记录 |
  | 随包脚本正文在 RN 走 `builtinSources` 常量、导入即写 KV | 原生不复制进 KV（assets 才是正文），因此「下架内置源交接」规则收紧为 `hasOwnUpdateUrl(info, definitions) && 存储里确有该源自己的脚本`（B3 已知差异第 1 条延续） |
  | `src/core/init/userApi/request.js` 的 `formData` 分支是**坏代码**：置 `Content-Type: multipart/form-data` 后从 `options.form`（此时不存在）取条目，`Object.entries(undefined)` 直接抛错，最终 `options.body = options.formData` 又把对象当 body 交给 fetch | 原生 `UserApiHttp` 保持显式拒绝 `formData`（错误信息比 RN 的崩溃更明确）；`form`（x-www-form-urlencoded）与 `body`+`Content-Type: application/json` 两条真实在用的路径已支持 |
  | `sizeFormate` 超过第五档会拼出 `undefined` | `formatCacheSize` 停在 TiB，负数显示 `0 B` |
  | 倍速/音量在 RN **不在设置页**，是播放页 SettingPopup 的滑杆（本车道禁触） | 任务书第 3 条点名要求，设置页仍加这两条，但写的是同一批 key（`player.volume` / `player.playbackRate`），播放页原生接入时不会再长出一份独立事实来源 |

  另：`DefaultSetting.kt` **本 lane 无需追加任何键**（所需键全部已存在），因此与 Lane C 的共享文件冲突面为零。

- 遗留问题与对后续波次的建议：
  1. **只有写、没有读的三键**：`player.volume`、`player.playbackRate`、`player.isSavePlayTime`
     设置页会写、也会即时调 `PlayerRuntime.setVolume/setRate`，但 `PlayerRuntime` 启动时不读这些值，
     播放进度记忆也没有消费者。补齐点在 `app/.../player/`（本车道范围外），建议 Wave 2 与 B2/B4 一起收。
  2. **缓存口径只覆盖 AppCache**：RN 设置页那行是「应用缓存 + 播放器音频缓存」相加，清理时还会
     一并清 musicUrl 缓存并重置权限位。原生 `AppCache` 只统计/清理 `cacheDir + externalCacheDir`，
     缺口在 `player/` 与取链缓存侧，界面文案已按实际范围写（「只清临时缓存，不动收藏、歌单和已下载的脚本」），
     没有假装覆盖更大。
  3. **子页导航**：`MusicApp.kt` / `NavStack` 不在范围内，音源管理与音源日志用 `SettingsPage`
     内的 `SettingsSubPage` 本地状态整页切换实现（带内层 `BackHandler`）。若要接全局导航栈，
     把枚举换成路由即可，页面本身无需改。
  4. **更新检查触发时机**：仍只有启动时一次 `runStartupCheck()`（与 RN 同语义——daily/weekly 都是
     「启动时判断是否到期」）。长时间不重启不会跨天检查，这不是差异，但要靠 B3 的定时任务补齐时
     记得 `updaterSettings` 已经会读最新设置。
  5. **真机验收清单**（JVM 闸门测不到）：坏脚本报「无效的自定义源文件」；粘贴几百行脚本可导入；
     换源后能正常取链播放；检查更新弹确认框、失败时回滚 Toast；清理缓存后大小回落到 0 B；
     电池优化/通知页返回后标签刷新；音量与倍速滑杆松手即生效且重启后仍在（受第 1 条限制）。
  6. **formData 结论（任务书第 4 项）**：不补。RN 桌面端 `needle/request` 的选项形状被直接抄进
     mobile 的 `request.js`，那条分支在 RN 自己就跑不通；五源脚本实际用的是
     `form`（已支持）和 JSON body。留 Wave 2 只有在真实第三方源报「需要 multipart」时才实现。
