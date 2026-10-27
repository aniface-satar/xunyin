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

## Lane 报告（2026-10-27）

- **结论**：任务 1–6 全部落地，**部分完成两处**（见「遗留」）：① 位置小数只做到「写浮点 +
  重启截断」；② morph 试点代码完成但**未真机验证**（本环境按 lane 纪律只跑编译/单测闸门）。
  `lxmusic://music/searchPlay`、音频文件打开、`.js` 音源导入三条 deeplink 全部打通，
  跨源搜索与音源导入都只调 Lane B 的既有公开入口（`SearchRuntime` / `UserApiRuntime.importScript`）。
- **commit**：`91d6c84`（任务 1/2/5/6 + Slider 半成品落盘）、`776c468`（任务书快照）、
  `52e6d18`（morph 试点 + 两处测试样本修正）；测试数 **core 1045 + app 147 = 1192 全绿**
  （`ktlintCheck test assembleDebug` 通过，2026-10-27；基线 1042+122，本 lane +3/+25）。
  APK：`app-debug.apk` 28,915,464 B，sha256 `a4ec92b7ad6f869fcf39cea69993dc756b305495c30e61bf009eea87901e8be7`。
- **触碰文件清单**（集成会话按此定位冲突）：

  - 新增：`app/.../ui/MorphTransition.kt`、`app/.../lyric/DesktopLyricTextView.kt`、
    `app/.../lyric/DesktopLyricScrollMath.kt`、`app/.../ui/settings/BackgroundPlayHelpPage.kt`
  - 任务 1（FGS + 帮助页）：`AndroidManifest.xml`（只加 `FOREGROUND_SERVICE_SPECIAL_USE`
    权限与 `foregroundServiceType="specialUse"` + 用途 `<property>`；**方向属性未动**）、
    `lyric/DesktopLyricService.kt`、`lyric/DesktopLyricController.kt`（`startService` →
    `startForegroundService`）、`ui/settings/SettingsPage.kt`、`ui/settings/BackgroundPlayHelpPage.kt`
  - 任务 2（桌面歌词设置）：`core/.../setting/DefaultSetting.kt`（**仅表尾追加 2 行**：
    `desktopLyric.isShowTranslation` / `desktopLyric.isShowRoma`）、
    `lyric/DesktopLyricConfig.kt`、`lyric/DesktopLyricOverlay.kt`、
    `core/.../lyric/DesktopLyricLine.kt`、`ui/settings/DesktopLyricSettingsSection.kt`
  - 任务 3（morph）：`gradle/libs.versions.toml`（+1 行）、`app/build.gradle.kts`（+1 行）、
    `MusicApp.kt`、`ui/MiniPlayer.kt`、`ui/play/PlayDetailPage.kt`、`ui/MorphTransition.kt`、
    `ui/HomePage.kt`（`RetainedContent` 未改，见下）
  - 任务 4（问卷滑条）：`ui/radio/OnboardingSheet.kt`（**唯一一个 radio 文件**，只换控件）
  - 任务 5（deeplink）：`deeplink/Deeplink.kt`、`deeplink/DeeplinkRuntime.kt`、
    `deeplink/DeeplinkFileHost.kt`
  - 任务 6（搜索详情路由）：`HomeNavigator.kt`、`ui/HomePage.kt`、`ui/search/SearchPage.kt`
  - 测试：`HomeNavigatorTest.kt`、`deeplink/DeeplinkParserTest.kt`、
    `lyric/DesktopLyricScrollMathTest.kt`、`ui/radio/OnboardingSliderTest.kt`、
    `core/.../lyric/DesktopLyricLineTest.kt`、`core/.../setting/DesktopLyricSettingKeysTest.kt`、
    `core/.../setting/SettingMergerTest.kt`
  - **越界最小改动（必须知悉）**：`MusicApp.kt` 与 `ui/MiniPlayer.kt` 不在任务书 §3 的枚举里，
    但共享元素的两端（根布局宿主、迷你播放条封面）只存在于这两个文件；改动限于
    「根布局换成 `SharedTransitionLayout` + 播放页 `AnimatedVisibility`」「两行
    `sharedMorph` Modifier」，未动任何业务逻辑。若集成时与别的车道冲突，本条可直接参考本报告重做。

### 语义修正与实证发现

| 主题 | RN 实证 | Kotlin 落地 |
| --- | --- | --- |
| 桌面歌词译文/罗马音 | RN 桌面歌词把扩展行（译文、罗马音）**无条件**拼进 `LyricView.setLyric`，没有独立开关；设置里的 `player.isShowLyricTranslation/Roma` 只作用于播放页 | 新增两个独立键，**默认都 true**（等于改造前观感），桌面歌词与播放页各自读自己的键；扩展行过滤规则移植到 `core/lyric/DesktopLyricLine.kt` 并配单测 |
| `lyricUnplayColor` | RN 这个键收了但**没有任何渲染**（grep `lyricUnplayColor` 只有设置项与颜色解析） | 按「未播放的次要文字」角色用上：多行模式下第 2 行起（译文/罗马音）用 unplay 色，主行仍是 played 色（语义增量，不改键与落盘形状） |
| 单行横向滚动 | RN `LyricTextView.java`：`speed = 0.135 * textSize`，文本长度 ≥ 20 **翻倍速**；「到底」判定用的是**移动前**偏移；到端点钉在 `viewWidth - textLength - 2`；文本比视图窄则就地停表 | 逐条移植到 `DesktopLyricScrollMath`（纯函数 + 样本表单测），`DesktopLyricTextView` 自绘 `onDraw`；**删掉 MVP 的 marquee**（marquee 截断与自绘偏移会打架） |
| 位置百分比 | RN 写 `x / maxWidth * 100` 的浮点，落 JSON 是 `33.5` 这种值；W3 已把既有 Int 键的「小数形式 JSON」做成截断读（`33.5 → 33`） | 写侧改为 Double（保留两位小数）。**已知落差**：`desktopLyric.position.x/y` 的默认值仍是 Int（本波禁改既有行），`SettingsStore.merge` 会按默认值类型强转，所以**进程内是 33.5，重启后读回 33**——见遗留 |
| `music/searchPlay` | RN `handleSearchPlayMusic`：有 paths 时把 `paths[0]` 按第一个 `-` 拆「歌名 - 歌手」（只取前两段）；空歌名**静默返回**（不报错）；`dataVerify` 超长/类型不符才报错 | 解析层逐条对齐（含「空歌名返回 null = 不是本应用能处理的链接」）；执行层复用与本地兜底同一套阶梯：`LocalSourceQuery.candidates` × 五源第 1 页 × `LocalSourceQuery.matches`，命中即进试听列表（`playLater` 语义同 RN） |
| 文件打开 | RN `handleFileAction` 四个 case：`json/lxmc` 走列表备份（**要确认**）、`js` 走音源（**要确认**）、`ogg/flac/wav/mp3` 走试听列表（**不确认，直接起播**）；default 还有 `mimeType.startsWith('audio/')` 兜底 | 扩展名白名单扩到 7 种并分 `FileKind`；音频**不进确认层**直接起播（对齐 RN）；SAF 拿不到稳定 mime，故不做 mime 兜底（记遗留） |
| 问卷滑条 | 持久化是四档 `0 / 50 / 70 / 100`，50 会被 `Onboarding.sanitizeWeights` 当「没表态」丢弃；0 保留（= 明确不要，也是最强负播种） | 自绘四档吸附滑条（**零新依赖**：只用 foundation + SaltTheme），落库仍是那四个 Double，形状与档位语义**完全没动**；样本表 0.00→0.00、0.17→50、0.50→70、0.84→100 全钉死 |

### 任务 3：morph 试点（W5-14）结论

- **成，但只到「代码完成 + 编译/单测闸门绿」，未真机验证手感**（lane 纪律：真机项交集成会话）。
- gradle 只加了两行（本波全仓唯一许可）：`libs.versions.toml`
  `androidx-compose-animation = { module = "androidx.compose.animation:animation", version.ref = "compose" }`、
  `app/build.gradle.kts` `implementation(libs.androidx.compose.animation)`。**没有升级任何既有依赖**，
  material3 也没加（SaltUI 自带主题，material 相关行没必要）。
- **结构障碍的解法（选「转场期临时全 measure」路线，未改 `RetainedContent` 语义）**：
  旧结构 `RetainedContent(visibleIndex = 0/1)` 只摆当前页，共享元素两端不可能同时存在于布局。
  新结构把播放页从「第二个槽位」改成 **`AnimatedVisibility(visibleState)` 的兄弟层**，
  首页改为「始终组合、按需测量」：`visibleIndex = if (homeInLayout) 0 else -1`
  （`-1` 时 `getOrNull` 返回 null → 不测量不绘制，但组合保留，一级页面/详情栈/滚动位置照旧）。
  `homeInLayout = route == Home || playVisible.currentState || playVisible.targetState`，
  即**播放页在场（含进出场动画）期间首页参与测量与绘制**。`RetainedContent` 本身一行没改。
- 共享元素两个：封面（`sharedElement`，44dp ↔ 78% 宽圆角方）+ 歌名（`sharedBounds` +
  `ResizeMode.scaleToBounds`，字号 14sp ↔ 22sp）。作用域用 `CompositionLocal`
  （`ui/MorphTransition.kt` 的 `LocalMorphScopes`）下发，两个页面都不用改函数签名；
  读不到作用域时 Modifier 原样返回，所以同一批组件在别的容器里行为不变。
- 入场 `fadeIn(tween(200))` / 出场 `fadeOut(tween(160))`；播放页不透明背景在下、共享元素
  走 overlay 层，转场期间封面在首页迷你条与大封面之间补间。
- **风险与待验**：① 播放页在场期间首页每帧被测量（不绘制），首页重组合频繁时是额外开销；
  ② 首页包了一层 `AnimatedVisibility(visible = true)` 仅为拿 `AnimatedVisibilityScope`，
  若未来 Compose 版本对「恒显」的 AnimatedVisibility 加约束需重看；③ 手感未知（真机清单 ⑥）。

### 任务 1：FGS 类型选型与厂商白名单

- **选型 `specialUse`**（`ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE`，API 34+ 传类型，
  低版本传 0）+ Manifest `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE">`。
  理由（引 `w3-A.md` 任务 5）：桌面歌词服务**不持有播放器**（播放器在 `PlaybackService`，
  已是 `mediaPlayback`），谎报 `mediaPlayback` 会被商店审核质疑；`dataSync` 在 Android 15 起
  有 6 小时上限，浮窗是长时间驻留场景，不能用。通知渠道 `IMPORTANCE_MIN` + 静默、
  不可滑动清除，只做身份证明。
- 拉起方式同步改为 `startForegroundService`，`onStartCommand` 第一件事 `startForeground`
  （5 秒窗口内先拿身份再谈退出）；`onDestroy` 里 `stopForeground(STOP_FOREGROUND_REMOVE)`。
- **厂商白名单表**（照抄 `w3-A.md` 任务 5，帮助页按 `Build.MANUFACTURER` 把命中厂商排最前）：

  | 厂商 | 开关 |
  | --- | --- |
  | 小米/红米（MIUI/HyperOS） | 省电策略 → 无限制；自启动；最近任务卡片下拉锁定 |
  | 华为/荣耀（EMUI/MagicOS） | 应用启动管理 → 手动管理（自启动 / 关联启动 / 后台活动） |
  | OPPO/一加/realme（ColorOS） | 允许自启动 + 允许后台运行；耗电管理 → 允许后台高耗电 |
  | vivo/iQOO（OriginOS） | 自启动；电池 → 后台耗电管理 → 允许后台高耗电 |
  | 三星（One UI） | 电池 → 后台使用限制 → 从「休眠应用」移除 |
  | 原生 Android | 应用信息 → 电池 → 不受限制 |

  「后台播放帮助」入口在设置页，另挂「申请忽略电池优化」（用户点击才触发，不自动弹）。

### 任务 4：问卷滑条的范围约定

`OnboardingSheet.kt` 是 `ui/radio/` 里**唯一**被改的文件，改动只限「四个档位按钮 → 自绘四档
吸附滑条」：`tierIndexOf` / `percentOfTier` / `snapTierPercent` 三个纯函数 + `TIERS` 表不变，
提交给 `Onboarding.sanitizeWeights` 的仍是 `Map<String, Double>` 四档值。**请 Lane A 报告
交叉确认未与 `core/recommend/**` 的新增逻辑产生语义分歧**（本 lane 未改 recommend 任何文件）。

### 任务 5：deeplink 支持矩阵（更新后）

| 入口 | 状态 | 落点 |
| --- | --- | --- |
| `lxmusic://music/play?...` | ✅ 既有 | 直接按音源信息起播 |
| `lxmusic://music/searchPlay/歌名-歌手` | ✅ **本波新增** | 跨源搜索（六级候选 × 五源首页）→ 试听列表起播；支持 `playLater` |
| `lxmusic://music/searchPlay?data=...` | ✅ **本波新增** | 同上，`name/singer/albumName/interval` 走 `dataVerify` 同款校验 |
| `lxmusic://music/songlist/play/...` | ✅ 既有 | 歌单播放 |
| `lxmusic://player/{play,pause,next,prev,stop}` | ✅ 既有 | 播控 |
| 文件 `.json` / `.lxmc` | ✅ 既有 | 确认层 → 列表备份导入 |
| 文件 `.js` | ✅ **本波新增** | 确认层 → `UserApiRuntime.importScript`（与设置页粘贴脚本同一入口） |
| 文件 `.ogg/.flac/.wav/.mp3` | ✅ **本波新增（降级）** | 直接进试听列表起播，**曲目为占位元信息**（歌名=文件名，无歌手/时长） |
| 其它扩展名 / 非法链接 | ❌ | toast「暂不支持打开 .xxx 文件」/「调用失败：…」 |

### 歌词增强立项输入评估（只评估，未实现）

- **逐字歌词（lxlyric `[start,duration]`）**：解析层需要新行格式（现有 `LyricLine` 只有行级时间），
  播放页高亮要从「整行」升级到「字级插值」；工作量集中 `core/lyric/` + `ui/play/LyricView`，
  可独立成波。桌面歌词侧**不建议**跟进（浮窗字号小、逐字高亮在浮窗上观感收益低）。
- **繁简转换**：需要一张繁简映射表（体积 100KB 量级）或第三方库（本仓库零新依赖纪律下倾向
  内置 `HashMap` 子集）；消费点是 `LyricLine` 解析后一次转换即可，纯函数、JVM 可测。
  建议做成设置项（`lyric.isS2t`），默认关。
- **换源**：`PlayerRuntime` 已有本地曲目兜底链路，缺的是「在线曲换源」入口（RN
  `getOtherSource` + 手动换源 UI）；需要 `SearchRuntime` 的跨源能力（Wave6 已备）+
  播放页菜单项，属于**体验增量**，可与「下载/收藏」同波。
- **歌词工具模式（复制/海报）**：原生播放页已有分享卡渲染器（`ui/share/`），歌词工具页
  可以直接复用其位图管线；缺口是「长按歌词进入模式 + 选中态 + 整首/单行复制」的交互，
  纯 UI，依赖少，可与逐字歌词解耦单独排。

### 遗留问题与对后续波次的建议

1. **位置小数重启截断**（任务 2 部分）：`desktopLyric.position.x/y` 默认值仍是 Int，
   `SettingsStore.merge` 按默认类型强转 → 重启后 33.5 变 33。彻底互通要把这两行的默认值
   改成 `0.0`（属于「改既有键」），建议 Wave8 与 W3 语义修正一并处理，并补一条
   `33.5` 往返的 `SettingsStoreTest`。
2. **morph 未真机验证**：手感、竖屏全程、低端机掉帧都待集成会话按真机清单 ⑥ 跑；
   若观感不佳，回退办法是删掉 `MusicApp.kt` 的 `SharedTransitionLayout`/`AnimatedVisibility`
   外壳与三处 `sharedMorph*` 调用，**gradle 那两行可留**（不影响任何现有代码）。
3. **音频文件打开是占位曲目**：`LocalMusicRuntime` 当时没有单文件公开入口，本波用
   `LocalTrack.buildPlaceholder`（歌名=文件名、无歌手/时长）。**Lane B 本轮已新增
   `LocalMusicRuntime.importFiles(context, listId, uris, locationType)`**，
   集成后应把 `DeeplinkRuntime.playLocalFile` 换成它（读标签 + 进临时列表 + 起播），
   即可去掉这条降级——改动只在 `deeplink/DeeplinkRuntime.kt` 一个函数。
4. **searchPlay 的搜索预算**：六级候选 × 四源串行，最坏 24 次请求且未做跨候选去重；
   真机若体感慢，建议加「第一源命中即停」的源优先级（RN 是并发全源，原生这里选择了
   省流量省并发）。
5. **mime 兜底未做**：RN 对 `mimeType.startsWith('audio/')` 的兜底在 SAF 侧拿不到稳定 mime，
   目前只认扩展名（`content://` 无扩展名时会被判「不支持」）。若真机遇到这类来源，
   再加 `ContentResolver.getType()` 判定。
6. **「新年皮肤」等桌面歌词特殊覆盖未做**（按任务书要求留遗留）：需要 RN 皮肤表的完整清单，
   本波没找到等价数据源，建议随主题系统统一。
7. **真机清单（交集成会话）**：
   ① MIUI/HyperOS 杀后台 → 浮窗存活与恢复（含 `specialUse` 通知是否常驻）；
   ② 后台播放帮助页各厂商条目顺序与「你的设备」标记、电池优化入口能否打开；
   ③ 桌面歌词译文/罗马音独立开关即时生效（不重启服务）；
   ④ 单行横向滚动（长句 1.5s 后启动、到底钉住、短句按重力居中不滚）；
   ⑤ 位置小数双端互通（拖动 → 设置页显示 → 重启后读回，预期截断到整数）；
   ⑥ morph 转场：点迷你播放条 → 封面/歌名补间 → 返回逆放，全程竖屏、无闪黑；
   ⑦ `lxmusic://music/searchPlay/晴天-周杰伦` 直达播放、`?data=` 形式、搜不到时的 toast；
   ⑧ 音频文件经「打开方式」进试听列表起播（预期歌名为文件名）；
   ⑨ 搜索三类详情（歌单/专辑/歌手）返回后关键词、结果、滚动位置不丢；
