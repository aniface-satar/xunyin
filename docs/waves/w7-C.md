# Wave 7 · Lane C 任务书 —— 桌面歌词收尾 + gradle 解锁（morph/Slider）+ deeplink 补全 + 搜索详情路由统一

> 本文件是 Lane C 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md`、`AGENTS.md`、
> `docs/kotlin-migration-progress.md`（B6 待办、Wave6 遗留 W6-6、Wave5 遗留 W5-6/W5-10/W5-14）与本文全文。
> 分支 `w7/laneC`，车道起点 = `main` 的 `baa4208`（core 1042 + app 122 = 1164 全绿）。

## 0. 起草时点复核（2026-10-26，全部实测）

| # | 事实 | 实证位置 |
|:--:|:--|:--|
| 1 | `DesktopLyricService` 是普通 `android.app.Service`，Manifest 无 `foregroundServiceType` | `app/.../lyric/DesktopLyricService.kt:3`（`import android.app.Service`）、`AndroidManifest.xml:41-43`（`exported="false"`，无类型）；FGS 化 + 「后台播放帮助」页是 `w3-A.md` 任务 5 调研的建议 2/3，拖了四波 |
| 2 | 桌面歌词设置缺：翻译/罗马音独立开关、单行横向滚动（MVP 是 marquee 截断）、位置小数**写侧**（读侧已通）、`lyricUnplayColor` 未被渲染 | `docs/kotlin-migration-progress.md` B6 待办（行 767 起）+ `ui/settings/DesktopLyricSettingsSection.kt` grep 无翻译/罗马音 |
| 3 | gradle 里**没有** `compose.animation`，也没有 material 相关依赖（只有 foundation/ui/runtime/text/graphics） | `gradle/libs.versions.toml:19-26`；morph（W5-14）与 Slider（W5-6）被这个卡了两波 |
| 4 | 问卷是四档档位，持久化形状与 RN 完全一致，注释明说「换滑条只改本文件」 | `app/.../ui/radio/OnboardingSheet.kt:41-46` —— **注意：该文件在 `ui/radio/`（Lane A 领地），见任务 4 的处置** |
| 5 | deeplink 文件打开只认 `json`/`lxmc`；`music/searchPlay` 当年因「需要跨源搜索」没做——**Wave6 Lane B 已把跨源搜索落了** | `app/.../deeplink/DeeplinkFileHost.kt:101`、`deeplink/Deeplink.kt:186` 注释 |
| 6 | SEARCH tab 三类详情（歌单/专辑/歌手）全是页内覆盖，不进导航栈 | `ui/search/SearchPage.kt:89/234/240/328`（`detailTarget`）、`:247`（AlbumDetailPage）、`:258`（ArtistDetailPage）；`HomeNavigator.Route` 只有 ListDetail/LeaderboardDetail/SonglistDetail/Radio |
| 7 | morph 的结构障碍：`RetainedContent` 只 measure 可见页 | `ui/HomePage.kt` `RetainedContent`（Layout 实现，Wave5 引入） |
| 8 | `userapi/**` 本波归 Lane B（W6-1 缓存接线） | 本总纲 §2 冲突面；`.js` 音源导入**只许调用既有公开方法** |

## 1. 背景

三条线收口：① B6 桌面歌词的服务身份与设置项欠账（拖了四波，后台被杀是线上最大风险）；
② morph 转场与问卷 Slider 两项 UI 升级，卡点都是 gradle 依赖——本波由本车道统一解锁；
③ deeplink 补全 `music/searchPlay` 与音频文件打开（前置已由 Wave5/6 备齐），外加搜索详情
路由统一（W6-6，三类详情页内覆盖导致返回丢状态的老毛病）。

## 2. 任务

1. **DesktopLyricService FGS 化 + 后台播放帮助页**（B6，对照 `w3-A.md` 任务 5 调研结论）：
   Manifest 加 `foregroundServiceType`（与权限，**禁动方向属性**）；服务改
   `foregroundServiceType="mediaPlayback"` 或专用类型并 `startForeground`；设置页加
   「后台播放帮助」入口页（厂商白名单引导，内容照 w3-A 调研表）。
2. **桌面歌词设置补齐**：翻译/罗马音独立开关（设置键走 `core/setting/DefaultSetting` 表尾追加，
   歌词页与设置页同源联动）；单行模式横向滚动（对齐 RN `LyricTextView`，替换 marquee 截断）；
   位置小数写侧互通（读侧 Wave3 已通，写侧改 Double/放大整数，注意 W3 未动契约的兼容读）；
   `lyricUnplayColor` 渲染接入。「新年皮肤」等特殊覆盖不做，写遗留。
3. **morph 转场试点**（W5-14）：gradle 加 `compose.animation`（本波唯一许动 gradle 的就是本车道，
   只许加 animation/material 相关行，**不许顺手升级别的**）；`SharedTransitionLayout` 试点
   **单元素**「首页迷你播放条 → 播放页封面/标题」；先解决 `RetainedContent` 只 measure 可见页的
   结构障碍（方案写报告：或改 measure 全部可见页，或转场期临时全 measure）。**失败降级**：
   试点不成即回退依赖外代码、留 gradle 行并写清原因，不许硬凑。
4. **问卷 Slider**（W5-6）：`OnboardingSheet` 在 `ui/radio/`（Lane A 领地）——处置写死：
   **本 lane 只许改这一个文件、只换滑条控件**（material3 Slider 或自绘拖动条，优先评估自绘
   零依赖；持久化形状与档位语义完全不动，写进报告与 Lane A 报告交叉确认）。Lane A 已知悉
   （总纲 §2）。
5. **deeplink 补全**（W5-10 部分，全在 `deeplink/` + `MainActivity`）：
   - `music/searchPlay`：跨源搜索已就绪，调 `SearchRuntime` 公开方法（Lane B Wave6 产物，
     只调用）；
   - 音频文件打开：扩展 `SUPPORTED_FILE_EXTENSIONS` 加音频扩展名，命中后调
     `LocalMusicRuntime` 公开入口（Lane B，只调用；签名不够就降级记遗留）；
   - `.js` 音源导入：调 `UserApiRuntime`/`UserApiManagePage` **既有**公开流程；
     缺方法 → 降级记遗留（`userapi/` 归 Lane B，禁触）。
6. **搜索详情路由统一**（W6-6）：`HomeNavigator` 加 `AlbumDetail`/`ArtistDetail` 两个 Route，
   `SearchPage` 三类详情（歌单/专辑/歌手）改走导航栈（返回保留关键词/结果/滚动位置——
   真机清单第 15 条的老毛病根治）。**只改跳转与 Route，不动搜索逻辑与详情页本体。**

## 3. 范围（只许改这里）

- `android-native/app/.../lyric/`（含 `DesktopLyricService.kt`）、`core/.../core/lyric/`（如有需要）
- `android-native/app/.../ui/settings/**`、`core/.../core/setting/DefaultSetting.kt`（仅表尾追加）
- `android-native/app/src/main/AndroidManifest.xml`（仅 FGS 类型与权限；**禁动方向属性**）
- **`gradle/libs.versions.toml` + `app/build.gradle.kts`**（仅 compose.animation / material 相关行）
- `android-native/app/.../deeplink/**`、`MainActivity.kt`、`HomeNavigator.kt`、`ui/HomePage.kt`
- `android-native/app/.../ui/play/`（morph 播放页侧）、`ui/search/SearchPage.kt`（仅详情跳转）
- `android-native/app/.../ui/radio/OnboardingSheet.kt`（仅滑条控件，见任务 4）
- 新增测试放对应包

## 4. 禁触

- `core/recommend/**`、`ui/radio/**` 其余文件（Lane A 范围；`OnboardingSheet.kt` 是唯一例外）
- `core/local/**`、`data/LocalMusicRuntime.kt`、`userapi/**`、`core/data/**`、
  `ui/list/**`（Lane B 范围——`LocalMusicRuntime`/`SearchRuntime`/`UserApiRuntime` 只许调用）
- `.github/`；gradle 里除 animation/material 外的一切（**不许升级别的依赖、不许动版本目录其他行**）

## 5. 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- deeplink 解析、搜索详情 Route、滑条持久化形状有 JVM/Compose 单测（样本表进用例）；
- 报告含：FGS 类型选型与厂商白名单表（引 w3-A 调研）、morph 试点结论（成/降级 + 原因）、
  gradle 变更清单、deeplink 支持矩阵更新、歌词增强（逐字 lxlyric/繁简转换/换源/工具模式）
  的立项输入评估（只评估不实现）、真机清单：① MIUI/HyperOS 杀后台→浮窗存活与恢复；
  ② 后台播放帮助页各厂商跳转；③ 翻译/罗马音开关即时生效；④ 单行横向滚动；⑤ 小数位置
  双端互通；⑥ morph 转场手感与竖屏全程；⑦ `lxmusic://music/searchPlay` 直达播放；
  ⑧ 音频文件经「打开方式」进本地导入；⑨ 搜索三类详情返回不丢状态。
- lane 报告按 RULES 模板追加到本文件末尾并 commit；做完停下等待集成。

---

## Lane 报告（待填）
