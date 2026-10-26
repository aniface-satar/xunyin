# Kotlin + SaltUI 迁移进度

> 跟踪 `kotlin-saltui-migration-feasibility.md` §七 分批次方案的执行状态。
> 每批一节，含完成项、遗留项、验收边界。

## 批次状态速查（更新于 2026-10-26，Wave5 三车道已并入）

| 批次 | 状态 | 备注 |
|:--:|:--|:--|
| B0 工程骨架 | ✅ 完成 | 本地构建全绿；真机装包抽查待用户 |
| B1 数据与领域层 | ✅ 完成 | lxmc 导入导出数据层闭环；63 用例 |
| B2 播放内核与原生桥 | 🔄 进行中 | 决策层+Media3 平台+crypto+预热+状态同步/通知栏命令+实例接线/失败重试/加载超时/音量均衡已完成；**Wave3 Lane A 补齐三键回读/播放进度记忆/`isPlayedStop` 上升为 PlayerCore 守卫/退出收尾（替代 `exitProcess(0)`）**；**Wave4 Lane A 补 `@play_history` 原生写入方与 `playedList` 唯一写入点（`onMusicToggled` → 电台）**；代码项收口，剩余真机验收 |
| B3 音源生态 QuickJS | 🔄 进行中 | QuickJS 桥 + 原生 HTTP + 内置源运行时 + 取链 + **更新流全链路（调度/解析/语法闸门/写入回滚/启动检查/updateAlert）** + **自定义源管理页/音源日志页/设置页补齐（Wave1 Lane B）** 已完成；代码项收口，剩余真机取链与更新流验收（见下方 B3 节） |
| B4 全屏播控页 | 🔄 进行中 | 首版骨架 + **B4 剩余弹层（Wave1 Lane C：播放器设置面板 = 定时关闭/音量/倍速/歌词字号/译文/音译/当前音质只读，歌词设置以设置为唯一来源）** 已完成；**分享卡（Wave4 Lane B：音乐卡/歌词卡/五档比例/保存相册，主动重绘保证预览=成品）**；**分享卡「分享卡片」（Wave5 Lane C：MediaStore Uri + `ACTION_SEND` + `ClipData` 授权，同预览内复用已存图）**；本批剩余真机视觉与手感验收（见下方 B4 节） |
| B5 主界面与列表 | 🔄 进行中 | 第一切片：ListStore→播放器接线、歌单页、首页列表入口；第二切片：酷我搜索→试听列表→播放；第三切片：新建/重命名/删除/清空列表、单曲移除、搜索结果加入指定歌单；第四切片：设置存储与设置页（音质/歌词开关/音量均衡/加歌位置）；第五切片：首页迷你播放条、歌单多选批量删除/移动、长按拖拽排序；第六切片：三一级 tab/独立详情栈/发现二级 tab 导航壳与搜索一级 tab 嵌入；第七切片：五源搜索核心与全源聚合规则（app 层尚未接线）；第八切片：五源搜索 app 接线（transport/并发/代次/缓存/源选择/翻页 UI）；第九切片：排行榜内容（五源榜单清单 + kw/kg 榜单详情 + 30 条本地分页 + 临时列表起播，tx/wy/mg 详情未接）；第十切片：排行榜 tx/wy/mg 三源榜单详情收口 + 三源接线 + 25 条用例（Wave1 Lane A，第九切片的「详情未接」到此关闭）；第十一切片：在线歌单五源（标签/列表/详情 + 30 条展示分页）与发现页推荐官方内容通道（推荐歌单/新歌速递，Wave2 Lane A）；第十二切片：歌单详情排序 9 档 + 自定义排序（Wave2 Lane C）；第十三切片：推荐画像 M1 重排（Wave3 Lane B）+ 歌单搜索五源与在线歌单详情二轮（Wave3 Lane C）；第十四切片：歌单长尾（Wave4 Lane C：列表菜单去重、lxmc SAF 导入导出、整单导入为新歌单、歌单链接打开、封面磁盘缓存）；第十五切片：个性电台 M2（Wave4 Lane A：bandit 全家桶 + 候选池/队列/选曲/安全模式 + 电台页与喜欢/不感兴趣闭环）；**第十六切片：S17 本地曲库（Wave5 Lane B：SAF 目录树扫描 + `MediaMetadataRetriever` 标签/内嵌封面 + `source=local` 的 `content://` 直连取链 + 同名 `.lrc` + 列表操作行第 8 项）；第十七切片：推荐 M3（Wave5 Lane A：语种四级判定与配额、问卷播种、相似度/MMR、时段权重、通道 E 相似歌手异步供货、探索通道 C 接货）+ 首页长按九项菜单与 `lxmusic://` deeplink（Wave5 Lane C）**。本批剩余：「更多」分页、M3 两项供给层接线（W5-1）、音频特征（已评估未实现）、真机验收 |
| B6 长尾屏幕与桌面歌词 | 🔄 进行中 | **桌面歌词浮窗 MVP（Wave2 Lane B）**：悬浮窗服务 + 逐行滚动（150ms 提前量）+ 更多菜单开关 + 悬浮窗权限流程 + 位置持久化（整数百分比）已完成；**Wave3 Lane A 补齐冷启动自动恢复、设置页桌面歌词小节、锁定/样式实时刷新、`SettingsStore` 小数数值互通**；剩余前台服务/OEM 保活（**Wave4 决议：不实现，见 B6 待办**）与真机验收（见下方 B6 节） |
| B7 收官 | ⬜ 未开始 | — |

**验证基线**：`cd android-native && gradlew.bat ktlintCheck test assembleDebug`
（Git Bash 下用 `GRADLE_USER_HOME=E:/GradleHome ./gradlew ...`）
→ 当前应为 `:core` 883 + `:app` 111（合计 **994**）全绿，APK **28,925,062 B**
（sha256 `0103f7832c69096ccb35001a6d4b7e4ed7060bff0ba02f7e14de2116158ecf92`；
QuickJS 四 ABI + 9 个内置源脚本 + Wave1~Wave5 十五条车道成果）。
> 数字取自主仓库 `a4f714b`（Wave5 三车道并入 + 本地曲库装配之后的最终闸门：
> BUILD SUCCESSFUL，failures/errors/skipped 全 0）。
> Wave5 三车道并完的中间基线：合并提交 `66a15d7`，core 883 + app 106 = **989**，
> APK 28,925,062 B，sha256 `c86989f9…`；`a4f714b` 只补跨车道装配（+5 app 用例），
> core 与 APK 体积均未变。
> Wave5 各 lane 的闸门数（便于回溯定位是谁的改动）：Lane B core 775 + app 83（新增 core 33 +
> app 7：`core/local` 五件套与导入弹层文案）；Lane C core 742 + app 99（新增 app 23：
> deeplink 16 + 菜单规则 7，**core 一位没动**）；Lane A core 850 + app 76（新增 core 108：
> M3 五件套 + 通道 E + 探索通道 C + 端到端）。
> 可加性核对：core `742 + 33 + 0 + 108 = 883`、app `76 + 7 + 23 + 0 = 106`（+5 装配用例 = 111），
> 与实测一致，说明合并**没有丢测试、没有互相覆盖**。
> Wave4 基线（历史）：合并提交 `f214bd8`，core 742 + app 76 = 818，APK 28,860,935 B。
> Wave3 基线（历史）：合并提交 `8bdb799`，core 558 + app 76 = 634，APK 28,142,274 B。
> Wave2 基线（历史）：合并提交 `3a83b8c`，core 470 + app 68 = 538，APK 28,049,076 B。
> Wave1 基线（历史）：合并提交 `63e4715`，core 384 + app 62 = 446，APK 27,602,811 B。
ktlint 已升级到 **14.2.0**（12.2.0 在 AGP 9 内建 Kotlin 下只检查 `.kts`，app 的 Kotlin 源码此前实际未被 lint）；
全工程统一为 ktlint official 4 空格缩进（`android-native/.editorconfig`）。

## B4 全屏播控页

**状态：进行中（首版骨架 + 剩余弹层完成）**（首版 2026-10-24；B4 剩余弹层由 Wave1 Lane C 于
2026-10-25 完成并并入；并入后基线 `:core` 384 + `:app` 62 全绿）

### 已完成（B4 首版）

- [x] **LRC 解析器**（`:core/lyric/LyricParser.kt`，17 用例）：`lrc-file-parser@2.4.2`
      的静态解析语义逐条移植——标签（ti/ar/al/by/offset）、一行多时间戳、同时间戳
      文字并入 `extendedLyrics`、翻译/音译只挂到匹配时间点、`[mm:ss.xxx]` 存在时
      全曲按毫秒解释小数、`[1.00]` 按秒而非分、无小数标签整行丢弃、空白行剔除；
      行号 `indexAt` 对齐库的 `_findCurLineNum`（含插件固定 100ms 与 `[offset:]`）
- [x] **歌词加载**（`PlayerRuntime.observeLyrics`）：当前曲变化时走
      `UserApiRuntime.getLyric` 取 `lyric/tlyric/rlyric`，旧曲结果按 musicKey 丢弃；
      保留原文，翻译/音译开关只重解析不重下载（`refreshLyrics`）
- [x] **播放页骨架**（`app/.../ui/play/`）：
      - 背景：封面模糊 + 压暗渐变；API 31+ 用 `Modifier.blur`（RenderEffect），
        低版本用 32px 小图放大 + `FilterQuality.Low` 近似
      - 封面台 / 歌词台左右翻页（foundation `HorizontalPager` + 页码点）
      - 歌词列：逐帧按播放位置算当前行、自动居中、用户拖动期间不抢滚动、
        点击行 seek；翻译行缩字号跟随
      - 播控：进度条（点按/拖动 seek，拖动中本地预览）、上一首/播放暂停/下一首、
        时间标签、播放模式轮转、译文开关、歌词字号增减
      - 播放列表 sheet：读取 `PlayerRuntime.playerList()`，当前曲高亮、点击切曲
      - 封面直取 `meta.picUrl`（`CoverImageLoader`，内存 LRU 6 张）
- [x] **播放模式状态**：`PlayerState.playMethod` + `toggleNextPlayMethod`（轮转顺序
      对照 RN `MUSIC_TOGGLE_MODE_LIST`，1 用例）；`PlayerRuntime` 把决策读取器指到
      状态本身，保证按钮与切歌逻辑同源
- [x] 首页临时「打开播放页」入口已移除，改由 B5 第五切片的迷你播放条进入播放页
      （B0「进入组件抽查页」已在 B5 第六切片移除）

### 已完成（Wave1 Lane C：B4 剩余弹层 S11，2026-10-25）

- [x] **定时停止播放核心**（`core/.../player/SleepTimer.kt` 新建，22 用例）：
      对照 RN `src/core/player/timeoutExit.ts` 的纯状态机——倒计时用 `roundToInt`
      （RN `Math.round`）、无活动计时器时 `cancel()` 直接 return、到点顺序「先清表再通知
      监听者」、`parseMinutes` 四支（Valid/TooLong/Invalid/Empty）复刻 RN 的
      `rxp=/([1-9]\d*)/` 抽取与 `MAX_MIN=1440`、三态按钮模式
- [x] **`TimeoutExitRuntime`**（`app/.../ui/play/` 进程级单例）：1 秒 ticker、
      `player.timeoutExit`（只用于回填输入框）与 `player.timeoutExitPlayed` 两个键的落库、
      到点动作 `stopPlayback()`（800ms 宽限）+ `exitProcess(0)`
- [x] **播放器设置面板**（`MoreActionSheet.kt` + `TimeoutExitSheet.kt`）：定时关闭（含
      「等待歌曲播放完毕」开关与 `InputDialog` 输入分钟）、音量/倍速/歌词字号三条
      `ItemSlider`、译文与罗马音两个 `ItemSwitcher`、当前音质只读行；沿用本页
      `PlaylistSheet` 的手写底部面板形状（SaltUI 无公开 Modal/BottomSheet）
- [x] **歌词设置以设置为唯一来源**（`PlayDetailPage.kt`）：字号/译文/音译不再存本地
      state，改为 `settings.state` 派生 + 松手写回，切页与重启后自然保持；
      头部 44dp 占位换成 ⋮ 入口（`Glyph.More` 三圆点自绘）
- [x] **新增用例**：`SleepTimerTest`（22）、`PlaySheetSettingKeysTest`（4，core/setting）、
      `PlaySettingSheetTest`（5，app/ui/play）
- [x] **范围纪律**：`DefaultSetting.kt` 最终**未改**（任务书要求追加的 8 个键从 RN
      `defaultSetting.ts:27-51` 移植时已全量存在，改为新增键契约测试）；
      `PlayerRuntime.kt`/`PlayerCore.kt` 只调用既有公开 API，**没有新增公开入口**

### B4 语义修正记录（播控弹层，Wave1 Lane C 对照 RN 源码实证）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| 任务书指向的 `useSleepTimer` 在 RN **不存在**；定时关闭是 `timeoutExit.ts` 的模块级单例 + 钩子 | `SleepTimer.kt`（文件名按任务书）语义逐条对齐 `timeoutExit.ts`；单例挂点放 app 层 |
| 到点动作是 **`exitApp('Timeout Exit')` 退进程**，不是暂停/停播（timeoutExit.ts:16-21） | `onDeadlineReached` → `onExitApp`；停止播放只是退前的收尾 |
| `getTime()` 差值用**四舍五入**而非 floor | `remainingSeconds()` 用 `roundToInt()`，边界锁测（真实经过 400ms 就少 1 秒） |
| `clearTimeout()` 无活动计时器时**直接 return**，既不重置也不通知（:33） | `cancel()` 同语义，避免 UI 收到多余的 -1 事件 |
| 到点顺序「先 `clearTimeout()` 再 `exit()`」（:45-47），监听者先看到已关闭 | `onDeadlineReached()` 先 `cancel()` 再置标志通知 |
| `exit()` 只在 `player.timeoutExitPlayed && playerState.isPlay` 时置标志；**暂停态到点 = 直接退进程** | 两支分开实现并各自锁测 |
| `player.timeoutExit` 只用于**回填输入框**（TimeoutExitEditModal.tsx:157），RN 没有开机续跑定时 | 同样只回填，不起表 |
| RN 没有倒计时预设档位：自由输入分钟 + `MAX_MIN=1440`（"abc12"→12、"30分钟"→30、"0"→输入错误、空→静默 return） | `parseMinutes` 四支对齐；UI 用 `InputDialog` 输入分钟 |
| 定时关闭入口在**控制排**（TimeoutExitBtn），音量/倍速/字号在**头部** `LyricSettingSheet`（仅歌词页可见）；RN 的 ⋮（MusicMoreSheet）装的是歌曲操作 | 按任务书三类合成一张 ⋮ 面板，**形状与 RN 不一致，属产品决策**（见 Wave1 集成记录遗留项） |
| 歌词字号**拖动不预览**：歌词行直接 `useSettingValue()/10`（Lyric.tsx:101-103），滑杆只在 `onSlidingComplete` 写设置 | 字号滑杆只在松手提交；音量/倍速拖动即时作用、松手落库、与已存值相同不写 |
| RN 取值一律 `Math.trunc(setting*100)`（音量/倍速） | 用 `.toInt()` 截断而非 `roundToInt`（0.99999 不能读成 100） |
| 「重置速率」在已 1 倍速时**什么都不做**（SettingPlaybackRate.tsx:44-45） | 同语义，本地值也不回写 |
| `SettingsStore._state` 初始即默认表，未 `load()` 也读得到正确默认 | 播放页仍显式 `ensureLoaded()`，并用测试锁住，防日后改成空表 |
| SaltUI 3.0.0-beta03：`Slider` 是 internal，公开入口只有 `ItemSlider`；`Item/ItemSlider/ItemSwitcher/InputDialog` 都带 `UnstableSaltUiApi` | 面板手写底部形状；`@OptIn` **漏标是编译器错误（OPT_IN_USAGE_ERROR）而非警告** |
| `StateFlow` 被 collect 时先吐当前快照：到点置位后立刻订阅会「一到点就退」 | `watchUntilSongEnd()` 跳过第一帧，等曲目/播放态真的变化再退（近似 `service.ts:134/143`） |
| 面板文案有权威 i18n 键：`play_detail_setting_title`=播放器设置、`..._rate_reset`=**重置**、`setting_play_show_translation`=显示歌词翻译（如果可用）、`input_error`=**不要乱输好吧😡**（zh-cn.json:116） | 全部逐字对齐，测试锁了 `timeout_exit_tip_off/on` 两支 |

### 已完成（Wave4 Lane B：分享卡 S14，2026-10-26）

- [x] **core 决策层**（`core/share/`，7 文件 61 用例）：`CardTheme`（深浅两套配色）、
      `Rounding`、`CardTextSizes`（字号档位）、`CardScale`（五档比例只做 `scale ≤ 1` 等缩）、
      `FitLyricBlock`（歌词块字号下探/截断）、`CardFileName`（清非法字符/72 字符上限/同名 `(n)`）、
      `ShareCardLayout`（卡片几何与高度预算）
- [x] **绘制执行器**（`app/.../ui/share/ShareCardRenderer.kt`）：`Bitmap + Canvas + Paint`
      按 core 决策直接排版；预览与导出用同一张位图（WYSIWYG），不存在两套排版
- [x] **保存相册**（`ShareCardSaver.kt`）：PNG 写 `MediaStore` `Pictures/寻音`（29+ 免权限）
- [x] **分享弹层**（`ShareCardOverlay.kt`）：音乐卡/歌词卡、五档比例、预览、保存、关闭；
      入口接在播放页「更多」菜单（`MoreActionSheet` 只加 1 import + 1 状态 + 1 Item + 1 段调用）
- 导出路线：**弃「截屏」改「主动重绘」**，选型理由与实证见 `docs/waves/w4-B.md`

### B4 语义修正记录（分享卡，Wave4 Lane B 对照 RN 源码实证）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 音乐卡元素 | `MusicCard.tsx` 只有封面/歌名(3 行)/歌手(2 行)/品牌行，**没有进度条**（任务书原文有误） | 按 RN 实现，未画进度条；要加需先改 RN 并同步 core 的 `MUSIC_CARD_TEXT_RESERVE=200` |
| 歌词来源 | `lyricLines` 来自歌词工具页勾选行 | 原生无工具页，用 `runtime.lyrics.parsed` 全量（丢全空行）；`fitLyricBlock` 接口不变 |
| `visibleCount = -1` 哨兵 | JS 兜底初值 -1，`slice(0,-1)` 会少最后一句 | 两条路径都返回 ≥0（首档即写 `best` / 五档 0 > -1 接管）；用例锁死「预算 0 → 0 行」 |
| 卡色来源 | 取 `appTheme.isDark`（播放页封面取色主题**不参与**，RN 回挂 `SheetThemeProvider` 即为此） | 取 `isSystemInDarkTheme()`，与 `MusicApp.kt` 主题同源 |
| 比例默认 | `DEFAULT_RATIO = 'fullscreen'` | 同；卡片按基准屏算一份整体，其余档只等比缩，卡内比例不动 |
| 行高 | 音乐卡歌手、歌词卡页脚歌名/歌手无显式 `lineHeight`（吃平台默认） | 统一按 1.25× 字号排；单行无差异，两行每行差 <2dp，仍在预算内 |
| 字距单位 | RN `letterSpacing: 0.2` 是 dp | `TextPaint.letterSpacing` 是 em，取 `0.2 / 17` |
| 品牌图形 | 裁到墨迹的 `app-icon-glyph.png`（218×204 唱片+音符） | 包内无该图，改用 `ic_launcher_foreground` 按墨迹框 contain + `SRC_IN` 染色（**只剩音符，已知近似**） |
| 糊底 | Fresco 20dp 框糊（边缘读到图外、留暗边） | `blurSource`（32px 缩略图）center-crop 放大 + 20% 黑 scrim（边缘干净、颗粒更粗） |
| 导出路径 | `view-shot` 的 `captureRef` 抓已上屏组件（需真实上屏、异步、受遮挡影响） | Compose 无按组件出图 API，`PixelCopy` 异步且依赖上屏 → 改主动重绘，同一个 Bitmap 既预览又导出 |

### 待办（B4 剩余）

- [ ] 真机视觉验收：背景模糊观感、歌词滚动流畅度、翻页/切歌无闪烁（需用户）
- [ ] 播放列表 sheet 接真实列表（依赖 B5 的 `listResolver`）
      → **已于 B5 第一切片接通**（`ListRuntime`，2026-10-24）
- [x] 其余弹层：~~定时关闭、音质/音量/倍速、更多菜单、歌词设置持久化~~
      → **已由 Wave1 Lane C 完成**（2026-10-25，见上方 Lane C 小节）；
      ~~分享卡~~ → **已由 Wave4 Lane B 完成**（见上方 S14 小节）
- [ ] **分享卡遗留**：①系统分享 chooser（RN `shareCapturedCard`）未做，需保存后拿 MediaStore
      Uri 发 `ACTION_SEND`，建议与「更多菜单其它动作」一起接；②`share.*` 偏好持久化
      （分享类型/默认比例）未做，`core/setting/` 无人认领，需在 `DefaultSetting` 表尾追加后接线；
      ③Android 26–28 无法免权限写公共相册（manifest 禁触、无 `WRITE_EXTERNAL_STORAGE`），
      现为「需要 Android 10 及以上」提示，要支持需改 manifest 或改走 SAF；
      ④去重只看得见本应用条目（作用域存储下 `RELATIVE_PATH` 查询范围受限），重装/跨应用写入
      可能重名，最终由系统改显示名，不覆盖原文件
- [x] **Wave2 播控侧遗留**：「等待歌曲播放完毕」~~只做到近似~~ → **已由 Wave3 Lane A 收口**
      （`isPlayedStop` 上升为 `PlayerCore` 单一真源，`PlaybackCoordinator` 在
      paused/ended/loadstart/loadtimeout/failed 与延迟下一首前守卫，手动播放清零；
      到点退出从 `exitProcess(0)` 改为 `PlayerRuntime.shutdown()` 收尾。
      详见下表 B2 语义修正与 Wave3 Lane A 小节）
- [x] ~~封面链路补齐：RN `getPicPath` 的校验/磁盘缓存/失败占位尚未移植~~
      → **磁盘缓存已由 Wave4 Lane C 完成**（`CoverImageLoader.init(context)` + `cover_images/`
      sha1 命名 + 坏图删除 + 300 张上限 + 原子写）；仍余：**本地曲目 `picUrl` 为路径时无封面**
      （`normalizeUrl` 只认 http(s)，属既有 API 限制）、**行式列表无小图缓存**
      （LRU 6 张，逐行取图会挤掉播放页缓存，故歌单搜索结果为行式而非网格）
- [ ] 歌词增强：逐字歌词（lxlyric）、繁简转换、歌词搜索换源、工具模式（B6 一起）
- [ ] 播放页与迷你播放条/详情页的共享转场（morph）留到 B5 导航接线后评估

### 续接点（下一会话从这里开始）

**B4 首版骨架 + 剩余弹层已完成；B5 第一~十三切片已完成（列表读取/歌单页 + 酷我搜索起播 + 列表管理 + 设置存储/设置页 + 迷你播放条/多选批量/拖拽排序 + 首页导航壳 + 五源搜索核心/全源聚合规则 + 五源搜索 app 接线 + 排行榜内容 + 排行榜三源收口 + 在线歌单与推荐内容通道 + 列表排序 9 档 + 推荐画像 M1 与歌单搜索/歌单详情二轮）。
下一步：推荐 M2/M3 → 分享卡 → B6 收尾（FGS 保活/桌面歌词真机）。**

1. 三条车道都只保证 JVM 闸门全绿，**真机验收项一律未跑**：B3 取链/更新流、B2 通知栏/后台存活/缓存清理入口、B4 视觉与手感、B5 排行榜三源。汇总清单见文末「Wave1 集成记录」。
2. 播控侧唯一带功能缺口的地方（`SleepTimer.isPlayedStop` 近似实现）**已由 Wave3 Lane A 关闭**：
   标记上升到 `PlayerCore` 单一真源，退出从 `exitProcess(0)` 换成 `PlayerRuntime.shutdown()`。
3. B5 接线时保持竖屏约束；音量均衡开启时 `isEnableAudioOffload` 必须置 false。
4. B5 搜索已接线完成（第八切片）：`SearchRuntime` → `SearchCoordinator` 五源并发/聚合；
   真机验收五源取链与聚合翻页手感（尤其 tx/wy 签名请求与 kg/mg 的实际响应）。
5. 排行榜（第九切片）：kw 用 wbd 加密（AES-ECB-PKCS5 + MD5 签名——RN 的
   `ECB_128_NoPadding` 枚举实际映射 Android `Cipher.getInstance("AES")` 即 PKCS5，
   已实证并在测试中锁定）；kg 走 v3 rank API；tx/wy/mg 榜单详情**已由 Wave1 Lane A
   实现并接线**（B5 第十切片：tx 需 HTML period 抓取、wy 需 weapi+musicDetail 两段链、
   mg 需 `newRateFormats` 整榜），「该源的榜单详情暂未接入」提示已不再触发，但
   `ui/HomePage.kt` 里那条分支代码仍在（见 Wave1 集成记录遗留项）。wy 链路只证到
   「加解密与请求形状对齐 RN」，**服务端是否接受只能靠真机**。
   排行榜播放走临时列表：`listMusicOverwrite(TEMP)` → `playListById(TEMP)` →
   后台 `getListDetailAll` 补全（对照 RN `Leaderboard.listAction.handlePlay`）。

## B5 主界面与列表

**状态：进行中（第一~十三切片完成）**（第一~九切片 2026-10-24；第十切片 = Wave1 Lane A
排行榜三源收口，2026-10-25 并入；第十一/十二切片 = Wave2 Lane A/C；第十三切片 A/B =
Wave3 Lane B/C，2026-10-26 并入；并入后基线 `:core` 558 + `:app` 76 全绿，APK 28,142,274 B）

### 已完成（B5 第一切片）

- [x] **列表运行时**（`app/.../data/ListRuntime.kt`）：DataStore → ShardedKvStore →
      DataRepository → ListStore 单例接线；`ensureLoaded` 用互斥锁保证用户歌单只加载一次
- [x] **播放列表接线**：`PlayerRuntime.listResolver` 改为读取 `ListRuntime.musics(listId)`，
      播放页的列表 sheet / 切歌决策与歌单页共用同一份 ListStore 缓存
- [x] **导航支持参数路由**：`NavStack.Route` 由 enum 改为 sealed interface，
      新增 `ListDetail(listId, title)`（data class 按值相等，回退/去重语义不变；
      第六切片已迁移为 `HomeNavigator.Route.ListDetail`）
- [x] **歌单详情页**（`app/.../ui/list/ListDetailPage.kt`）：读取列表歌曲、当前曲高亮、
      「播放全部」整表起播、点行从所点歌曲起播并进入播放页；空列表有占位文案
- [x] **首页列表入口**：试听列表 / 我的收藏 + 用户自建歌单（ListStore.state 驱动，加载后自动出现）

### 已完成（B5 第二切片：搜索起播）

- [x] **酷我搜索移植**（`core/.../music/search/KwSearch.kt`）：对照 RN
      `musicSearch.js` + `toNewMusicInfo`，输出同形状 MusicInfo（`kw_<rid>`、
      albumName/picUrl/albumId/qualitys/_qualitys）；`SHOW=0` 限流与空结果按 RN 规则重试，
      最多 3 次；HTTP 由调用方注入，解析可在纯 JVM 测
- [x] **真实响应金标测试**（`core/src/test/.../KwSearchTest.kt` + `kw-search.json`）：
      2026-10-24 抓取的「周杰伦」真实响应落盘，锁定 id/时长/封面/音质顺序与大小写
- [x] **搜索运行时**（`app/.../data/SearchRuntime.kt`）：`HttpURLConnection` + UA/超时，
      IO 线程执行；网络错误以异常上抛给 UI
- [x] **搜索页**（`app/.../ui/search/SearchPage.kt`）：输入框 + 搜索按钮、加载/空结果/错误三态；
      点结果 = 写入试听列表（`listMusicAdd`）→ `playListById` → 进播放页
- [x] **明文 HTTP 放行**：`AndroidManifest` 加 `usesCleartextTraffic="true"`，
      与 RN 的 `network_security_config` 对齐（酷我搜索 + 自定义源更新地址都走 HTTP）

### 已完成（B5 第三切片：列表管理）

- [x] **列表管理核心**（`core/.../list/ListStore.kt`）：`normalizeListName`（trim + 100 字符截断）、
      `hasUserListNamed`、`createUserList`（`userlist_<时间戳>`，空名不建）、
      `renameUserList`（内置列表拒绝）——语义对齐 RN `ListNameEdit` / `core/list.ts#createList`
- [x] **核心用例**（`ListStoreTest` +3）：命名规范化、空名拒绝与 id/时间戳落库、改名与内置列表拒绝
- [x] **首页新建列表**：SaltUI `InputDialog` 输入 + 同名时 `YesNoDialog` 二次确认
- [x] **歌单页编辑**：用户歌单「重命名/删除列表」，任意列表「清空」；单曲「移除」无二次确认
      （对齐 RN 单曲移除语义）；删除当前活跃列表时回退到试听列表
- [x] **列表变更同步随机队列**：增删/清空/删除后调用 `PlayerCore.handleListMusicsUpdated`
- [x] **搜索页加入指定歌单**：每条结果「加入」→ 列表选择弹层（试听/收藏/用户歌单），
      重复时 toast「该列表已经有这首歌啦」，否则「添加成功」

### 已完成（B5 第四切片：设置存储与设置页）

- [x] **设置核心**（`core/.../setting/SettingsStore.kt`）：默认表 + 持久层覆盖，
      只接受已知键且按默认值类型解析（布尔/整数/小数/字符串），未知键与 null 忽略；
      `version` 每次写回都对齐 `DefaultSetting.SETTING_VERSION`（对齐 RN 设置合并语义）
- [x] **核心用例**（`SettingsStoreTest` +3）：无存储时取默认值、覆盖值生效且脏数据忽略、
      `set` 跨实例持久化并保持 version
- [x] **设置运行时**（`app/.../data/SettingsRuntime.kt`）：DataStore → ShardedKvStore →
      DataRepository → SettingsStore 进程级单例，与 ListStore 共用 `@setting_v1`
- [x] **播放运行时接线**：`PlayerRuntime` 的音质/歌词翻译/歌词音译/音量均衡开关与档位
      全部改为读设置；启动时先加载设置再按开关挂均衡
- [x] **设置页**（`app/.../ui/settings/SettingsPage.kt`，首页「设置」入口）：
      音质四档选择（128k/320k/flac/flac24bit）、歌词翻译与罗马音开关、音量均衡开关
      + 轻/中/强档位（立即重挂音效，设备不支持时 toast）、加歌位置顶部/底部
- [x] **加歌位置生效**：搜索页「点歌起播」与「加入指定歌单」都按设置写入列表
      （不再固定顶部）
- [x] **歌词开关双向持久化**：播放页与设置页的翻译开关写同一份设置，切页后状态一致

### 已完成（B5 第五切片：迷你播放条与歌单编辑）

- [x] **首页迷你播放条**（`app/.../ui/MiniPlayer.kt`）：订阅 `PlayerRuntime.core.state`，
      显示封面/歌名/歌手 + 播放暂停（Canvas 绘制，无额外图标依赖），点条进入播放页；
      首页底部预留高度，滚动内容不会被遮住
- [x] **歌单多选模式**：列表页「多选」进入编辑态，行点击切换选中、圆形勾选标记
      （Canvas 绘制），支持全选/取消全选与已选数量提示
- [x] **批量删除**：选中后二次确认，一次 `listMusicRemove` 落库并同步随机队列
- [x] **批量移动**：选中后选择目标列表（试听/收藏/用户歌单，排除当前列表），
      走 `listMusicMove`（先删后加，加歌位置遵循设置），完成后 toast 提示
- [x] **长按拖拽排序**：编辑态行尾拖拽手柄（Canvas 三横线），
      `detectDragGesturesAfterLongPress` + LazyColumn 稳定 key 实时让位，
      靠近上下边缘自动滚动；松手用 `listMusicUpdatePosition` 落库
- [ ] **真机验收**：迷你播放条、多选批量、拖拽手感与自动滚动尚未在真机上跑过

### 已完成（B5 第六切片：首页正式版导航壳）

- [x] **三个一级 tab 与独立详情栈**：底部顺序固定为「发现 / 我的 / 搜索」；`HomeNavigator`
      为每个 tab 保存详情栈，切 tab 不清栈，重复选择清空当前栈，根页面 back 返回 false 且不跳回发现
      （`HomeNavigatorTest` 6 用例）
- [x] **发现二级导航壳**：顺序固定为「推荐 / 排行榜 / 歌单」，默认推荐；重复选择底部发现会回到推荐。
      三项当前仅导航与空态入口壳，推荐算法/内容、排行榜及在线歌单数据均未移植
- [x] **我的与歌单详情接线**：保留新建列表、试听列表、我的收藏、用户歌单和设置入口；
      原歌单详情复用 `ListDetailPage` 并改走 `HomeNavigator.Route.ListDetail`
- [x] **搜索成为第三个一级 tab**：直接嵌入现有 `SearchPage`，嵌入态不显示返回按钮；
      保留酷我搜索、写入试听列表起播与加入指定歌单，不再 push 全局搜索详情路由
- [x] **状态与播放条保留**：三个一级页面保持组合状态；设置与全屏播放仍为全局覆盖页，
      返回后保留进入前的 tab/详情状态；迷你播放条在三个一级页面与首页详情页均可见，全屏播放页不显示
- [x] **B0 首页内容清理**：移除版本/颜色 token 调试文案与组件抽查入口；全局 `NavStack`
      仅保留 Home/Settings/PlayDetail，设置不是第四个 tab

### 已完成（B5 第七切片：五源搜索核心与聚合规则）

- [x] **传输中立的搜索模型**（`core/.../music/search/SearchModels.kt`）：
      `SearchRequest`（url/method/headers/body/form）与 `SearchPage`
      （list/total/allPage/limit/source）；core 不依赖 Android 或具体网络库，
      各源注入 `suspend` fetch，解析逻辑可在纯 JVM 测
- [x] **tx 单曲搜索**（`TxSearch.kt`）：RPC body 与 `zzcSign`（SHA1 → 固定索引拼段 →
      20 字节 XOR → Base64 去 `/\\+=` → 小写）；保留 strMediaMid/albumMid/数值 id；
      默认 limit 50，响应不合法最多重试 6 次
- [x] **wy 单曲搜索**（`WySearch.kt`）：eapi batch，MD5 摘要 + AES-128-ECB；
      默认 limit 30，最多 3 次
- [x] **kg 单曲搜索**（`KgSearch.kt`）：`song_search_v2`，保留 hash/各音质 hash/lang；
      默认 limit 30，最多 3 次；Grp 子项按 RN 父 key 去重语义跳过
- [x] **mg 单曲搜索**（`MgSearch.kt`）：`searchAll` + MD5 签名；嵌套 resultList 展平、
      copyrightId 去重、相对图片补全、lrc/mrc/trc 字段；默认 limit 20，
      非 `000000` 立即失败不重试
- [x] **全源聚合**（`SearchAggregator.kt`）：无状态纯规则——`allPage >= page` 过滤、
      RN 同款相似度排序与 `sortInsert` 同分稳定顺序、失败源空页、
      跨页 id 稳定去重、maxPage/total 回退
- [x] **黄金测试与真实响应 fixture**：五源 2026-10-24 公开接口「周杰伦」响应原样落盘；
      签名黄金值（tx zzc、wy eapi 密文、mg MD5）；搜索相关 30 用例
      （kw 11 / tx 4 / wy 4 / kg 4 / mg 4 / 聚合 3）
- [x] **审查修复**：kw 单项缺 `N_MINFO` 改为整页重试；kw 缺/`null` `abslist` 与
      tx 缺 `song.list` 视为合法空页不重试；错误 JSON 类型的 `abslist`
      仍返回 null 触发重试
- [x] **wy 填充方式差异（已实证）**：RN 的 `AES/ECB/NoPadding` 对真实搜索明文
      （195 字节，非 16 字节对齐）会抛 `IllegalBlockSizeException`；公开 eapi
      接受 PKCS#7，因此只在 eapi 调用点用 `AES/ECB/PKCS5Padding`
      （AES 下与 PKCS#7 等价），未改全局 `Crypto` 的既有模式

### 已完成（B5 第八切片：五源搜索 app 接线与分页）

- [x] **搜索编排进 core**（`core/.../search/SearchCoordinator.kt`，8 用例）：
      对照 RN `core/search/music.ts` + `store/search/music/action.ts` 的搜索侧——
      每源一个 `listInfos` 缓存槽（list/total/maxPage/page/key）、
      同 `page__text` key 命中直接复用不发请求、发请求前抢占 key（并发重复提交
      由首个完成者落缓存）、翻页用 `<page>__<keyword>` 后缀匹配判定同关键词累计、
      「全部」五源**并发**（coroutineScope + async，对照 RN `Promise.all(task)`）、
      失败源转 `emptyPage` 继续聚合（对照 RN catch 的 allPage=1 空结果）、
      关键词代次（generation）在返回前校验——旧关键词的迟到响应返回 null 且不落缓存、
      `reachedEnd`（maxPage<=page 到底）与 `clearListInfo` 语义、
      limit 固定 30（RN 各源与 all 的 listInfos 初始值）
- [x] **app 传输层**（`SearchHttpTransport`）：`HttpURLConnection` 执行
      `SearchRequest`（GET/POST/body/form 编码、请求头优先缺省补桌面 UA、
      IO 线程、连接 10s/读 15s 超时）；kw 走纯 GET、其余四源按各自
      `buildRequest` 描述执行
- [x] **SearchRuntime 重组装**：注入 `SearchHttpTransport` + 五个 `:core` 搜索器
      （自带签名与重试）到 `SearchCoordinator`；对外暴露
      `search/reachedEnd/clear` 与源表（`SOURCES`：kw/kg/tx/wy/mg/all 顺序与
      RN `musicSdk/index.js` 一致，展示名对齐 `source_real_*` 文案）
- [x] **搜索页 UI 扩展**（`SearchPage.kt`）：
      - 源选择横滑条（五个单源 + 「聚合搜索」），换源立即按当前关键词重查
        （对照 RN `handleSourceChange` → `loadList`；缓存命中不发请求）
      - 翻页/加载更多：接近列表尾（最后 6 项内）自动取下一页并累计
        （对照 RN OnlineList `onEndReached`），尾部「加载中…」与「到底啦~」
        态（对照 `list_loading`/`list_end` 文案）
      - 迟到响应（`search` 返回 null）直接丢弃不刷列表
- [x] **测试**：`SearchCoordinatorTest` 8 用例（单源缓存复用/翻页累计与
      total 回退/换关键词不串页/全部聚合失败转空页/allPage 过滤/代次丢弃/
      reachedEnd 与 clear/空关键词）
- [ ] **真机验收**：五源实际取数（tx/wy 签名请求、kg/mg 响应）、聚合搜索排序
      观感、翻页加载更多手感、换源即时切换——需用户配合

### 已完成（B5 第九切片：排行榜内容第一批）

- [x] **五源榜单静态清单**（`core/.../leaderboard/Leaderboards*`）：对照 RN
      各源 leaderboard.js 的 boardList 逐项录入（kw 43 / kg 51 / tx 25 / wy 42 /
      mg 18），RN 的 getBoards 已固定为本地清单、这里同样不发请求
- [x] **kw 榜单详情**（`KwLeaderboard.kt`，4 用例）：wbd 加密链——JSON →
      Base64 → AES-128-ECB（实证 RN `AES_MODE.ECB_128_NoPadding='AES'` 在
      Android `Cipher.getInstance("AES")` 下是 ECB/PKCS5Padding，非 NoPadding）
      → Base64 → `data&time&appId&sign`（MD5 大写签名）；响应 percent 解码后
      AES 解密；musiclist 映射对齐 RN filterData（n_minfo 音质 Set 去重 +
      档位升序、artist `&`→`、`、实体解码）；失败重试 3 次
- [x] **kg 榜单详情**（`KgLeaderboard.kt`，4 用例）：`api/v3/rank/song`（rn=100），
      filesize/320filesize/sqfilesize/filesize_high → 128k/320k/flac/flac24bit
      各带 hash；authors[].author_name 拼接歌手；errcode 门禁 + 重试 3 次
- [x] **榜单本地分页**（`BoardPager.kt`，5 用例）：RN `core/leaderboard.ts`
      getListLimit 的纯规则移植——源页 100 条按 30 切展示页、尾段不足 30 且源
      还有下一页时暂存 tempList 与下一源页拼满、展示页缓存命中不重发、
      isRefresh 清缓存、getListDetailAll 拉全整表、去重发生在切分之前
- [x] **ListStore.listMusicOverwrite**（+1 用例）：RN `list_music_overwrite`
      整表覆盖（临时列表/排行榜播放入口），覆盖后旧歌清除、持久层同步
- [x] **LeaderboardRuntime**（app 组装层）：boards/board 查表、每榜一个
      BoardPager、`getListDetail/getListDetailAll/reachedEnd/isDetailSupported`；
      HttpURLConnection 传输（10s/15s 超时、桌面 UA）
- [x] **发现页排行榜面板 + 详情页 UI**：源选择横滑条 + 榜单列表（SaltUI Item）；
      `HomeNavigator.Route.LeaderboardDetail` 路由进详情栈；详情页含
      「播放全部」、30 条展示页接近尾部自动加载、错误重试、前三名序号高亮
- [x] **排行榜播放入口**（对照 RN `Leaderboard.listAction.handlePlay`）：
      点歌/播放全部 → `listMusicOverwrite(TEMP, 当前页)` → `playListById(TEMP)`
      → 进播放页 → 后台 `getListDetailAll` 补全临时列表并同步随机队列
- [x] tx/wy/mg 榜单详情：tx 需 HTML period 抓取（`c.y.qq.com` 正则）、
      wy 需 weapi + musicDetail 两段链、mg 需 filterMusicInfoList
      → **已由 Wave1 Lane A 收口**（见下方第十切片），「该源的榜单详情暂未接入」提示不再触发
- [ ] 真机验收：kw wbd 接口实际加解密往返、kg 榜单取数、分页与起播链路

### 已完成（B5 第十切片：排行榜 tx/wy/mg 三源收口，Wave1 Lane A，2026-10-25）

- [x] **半成品审计**：波前快照里 `TxLeaderboard.kt`/`WyLeaderboard.kt`/`WyWeapi.kt`
      是上一被叫停会话的半成品，本切片先逐条对照 RN 审计，修正 5 处语义偏离
      （tx `topid` 传成字符串、tx 封面按 `album.mid` 而非 `album.name` 判定、
      wy 无效响应被吞成空榜且不重试、wy `size` 缺失时丢条目、
      weapi 第二轮 AES 把 Base64 串当 b64 输入），另有 1 处是 Lane A 初稿自己在
      mg 重试计数上引入的**死循环风险**（parse 返回 null 时不计数），
      已改为按次数硬闸门——全部逐条见下方语义修正表
- [x] **tx 榜单详情**（`TxLeaderboard.kt` 修正，7 用例 + 真实 fixture
      `tx-leaderboard-26.json`）：`bangid` 按 RN `parseInt` 走数字 `topid`；封面按
      `album.name` 空/「空」回退歌手图 `T001R500x500M000{mid}`，否则 `T002…{album.mid}`；
      无 `mid`/无 `file` 的条目丢弃；新增 `getPeriods`——GET
      `c.y.qq.com/node/pc/wk_v15/top.html` 取 `data-date` 建期号表（实测 `2026-10-24`），
      命中才 POST `musicu.fcg`，实例内缓存
- [x] **wy 榜单详情**（`WyLeaderboard.kt` 7 用例 + `WyWeapi.kt` 5 用例，合成 fixture
      `wy-playlist-detail.json`/`wy-song-detail.json`）：无效响应抛错走外层 6 轮重试
      （对齐 RN 递归重试，半成品会吞成空榜导致 UI「暂无歌曲」且不重试）；`trackIds`
      空数组是合法空榜；第二段 `song/detail` 内部 3 次上限 + 固定 `User-Agent`/`origin`；
      `privileges` 先按下标配对、id 不匹配才按 id 回找；音质档位表按 RN fall-through
      语义（192000 与 128000 都只给 128k）+ `types.reverse()`，`size` 缺失保留 null 条目
- [x] **weapi 加解密金标**：用 node crypto 复刻 RN 链路复算出 encParams 金标（108 字符）
      与 encSecKey 金标 hex，落 `WyWeapiTest`——加解密形状已证，服务端接受与否只能真机
- [x] **mg 榜单详情**（`MgLeaderboard.kt` 新建，6 用例 + 真实整榜 fixture
      `mg-leaderboard-27553319.json`）：`querycontentbyId.do` **不分页**（RN `getUrl`
      忽略 page），一次拉整榜、`limit=200`；门禁 `body.code === '000000'`；
      `newRateFormats` 的 ZQ 常只有 `androidSize`，用 `size ?: androidSize` 回退
      （真实新歌榜 50 首：43 首全序、6 首到 SQ、1 首到 HQ）；时长从 `length` 用
      `(\d\d:\d\d)$` 取尾段，取不到写 `JsonNull`；重试改为**按次数**硬闸门（3 次）
- [x] **三源接入 `LeaderboardRuntime`**（app 组装层）：`detailSupported` 恒真后的
      取数分派、每源一个 BoardPager、`getListDetail/getListDetailAll/reachedEnd` 全通
- [x] **UI 核对结论：`ui/leaderboard/` 无需改动**——`LeaderboardDetailPage` 只消费
      `id/name/singer` 与 BoardPager 的 30 条展示分页，三源产出形状一致；
      mg 一次返回整榜时 `maxSourcePage = ceil(total/limit)` 恒为 1，本地分页照常
- [x] **新增用例 25 条**（Tx 7 / Wy 7 / WyWeapi 5 / Mg 6），fixture 为真机外网可达的
      公开接口原样落盘（tx/mg）或合成（wy，见下方实证记录）

### B5 语义修正记录（排行榜三源，Wave1 Lane A 对照 RN 源码实证）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| tx `getList` 先 `parseInt(bangid)`，请求体 `topid` 是**数字**；半成品把字符串塞进 `topid` | `toLongOrNull()` 否则直接报错（照 RN 走数字）；`code=2000` 实测来自**期号写错**，不是 topid |
| tx 封面按 **`album.name`** 判定（''/「空」→ 歌手图，否则专辑图）；半成品按 `album.mid` | 改为按 `album.name` 空/「空」分支，单测覆盖 T001 回退 |
| tx 期号只能从 `c.y.qq.com/node/pc/wk_v15/top.html` 的 `data-date` 取；自己拼 `2026_10_24` 一律 `code=2000` | 移植 `getPeriods`：GET HTML + 正则建期号表，命中才 POST；实例内缓存 |
| wy 响应无效时 RN **递归重试**（最多 6 次）后 reject；半成品吞成空榜 → UI「暂无歌曲」且不重试 | 无效响应抛错走外层 6 轮；`trackIds` 空数组是**合法空榜**，不再请求第二段 |
| wy `filterList` 的 privileges **先按下标配对**，id 不匹配才按 id 回找 | `privileges.getOrNull(index)?.takeIf{id 匹配} ?: firstOrNull{id 匹配}` |
| wy 音质 `maxbr` 999000/320000/192000/128000 是 **fall-through**（192000 与 128000 都只给 128k）；`size` 缺失时**保留 null 条目** | 同档位表 + `asReversed()`；`sizeOf()` 返回 null 仍写入 `qualitys`（半成品会丢条目） |
| **wy weapi 第二轮 AES 的输入是「第一轮 Base64 文本」的 utf8 字节**（RN 写 `aesEncrypt(btoa(round1), btoa(secretKey), iv)`，native 会先解码 btoa）；半成品把 round1 的 Base64 串当 b64 输入 → 加密的是密文，服务端解不开 | 两轮都改用 `Crypto.aesEncrypt(ByteArray,…)` 明确字节；node 复刻链路复算金标落测试 |
| 纯 JVM 没有 `AES/CBC/PKCS7Padding` 拼写（实测 `NoSuchAlgorithmException`） | 沿用 WySearch/KwLeaderboard 先例用 `PKCS5Padding`（16 字节块下即 PKCS#7）；`encrypt(objectJson, secretKeyOverride)` 开测试缝 |
| mg `querycontentbyId.do` **不分页**（RN `getUrl(id, page)` 忽略 page），一次返回整榜 | 整榜一次拉全，`page` 只作记账；`limit=200` |
| mg ZQ 常**只有 `androidSize`**，`size ?? androidSize` 才有值 | 同回退；音质表 PQ/HQ/SQ/ZQ → 128k/320k/flac/flac24bit |
| mg 时长从 `length`（`00:03:23`）取**尾段**，取不到就是 null | `LENGTH_REGEX` 尾段捕获；缺失写 `JsonNull`（UI 不显示时长） |
| mg `getList` 的重试闸门是 `if (++retryNum > 3) reject` ⇒ **最多 3 次请求**，业务码不合格与传输异常**同计数** | 本车道初稿只在异常时计数（parse 返回 null 会**死循环**），已改为按次数硬闸门并断言 3 次后抛错 |
| BoardPager 对「一次返回整榜」的源同样成立：tx/wy/mg 恒 1 源页，展示页按 30 条切 | 三源无需特殊分支，`reachedEnd` 用 `total/30` 判定 |

> 其他实证记录：wy `weapi/v3/playlist/detail` 本机直连持续返回 **HTTP 200 + 空体**
> （node https 两次、curl 带浏览器 UA/cookie 各一次均如此）→ 按任务书改用**合成 fixture**
> （3 首覆盖 hires/999000、320000、pc 后备 + 128000），已在测试类注释标注；
> 加解密金标不依赖该接口。tx/mg fixture 为本机公开接口真实响应原样落盘。
> Lane A 开工首跑带 `--rerun-tasks` 曾出现一次瞬时红（与并行构建争用），干净重跑即全绿。

### 已完成（B5 第十一切片：在线歌单五源与发现页推荐内容通道，Wave2 Lane A，2026-10-25）

- [x] **五源歌单源接口**（`core/.../songlist/`，新增 9 文件）：`SonglistModels.kt` 定义
      传输中立 `SonglistRequest`/`SonglistSort`/`SonglistTag(s)`/`PlaylistItem`/
      `SonglistPage`/`SonglistDetail` 与 `SonglistSource` 接口；`SonglistUtils.kt` 移植
      RN `formatPlayCount/sizeFormate/formatPlayTime/dateFormat`；`KwSonglist/KgSonglist/
      TxSonglist/WySonglist/MgSonglist` 各自实现 `getTags/getList/getDetail`
- [x] **五源取数与签名链**：kw wbd AES、wy linuxapi（实测修正，见下表）、kg 网关固定 key
      + HTML `global.data`、tx `uniform_get_Dissinfo` POST、mg `querycontentbyId`；
      `normalizeId` 对不支持的入口**显式抛错**，不请求错误 URL
- [x] **30 条展示分页**（`SonglistDetailPager.kt`）：源页切成 30 条展示页、尾段 tempList
      与下一源页拼满、缓存与 isRefresh、`getDetailAll` 拉全、按 id 去重；**新增跳页补齐**
      （从最近的已加载展示页续拉），修正 RN 只在顺序翻页时成立的记账缺口
- [x] **推荐冷启动选择规则**（`RecommendSelection.kt` + 10 用例）：新歌榜优先、组内取名字最短；
      最热排序按 `name+tid` 匹配；标签扁平化与轮换；RN 的 `Math.random` 改为**可复现轮换**
- [x] **app 装配层**（`data/SonglistRuntime.kt`）：五源注册、tags/list 缓存、每歌单一个 Pager、
      `reachedEnd` 的 `limit*page` 兜底；`RecommendRuntime` 组织「推荐歌单 6 张 + 新歌速递 3 首」
- [x] **UI**：发现页「歌单」面板（源/排序/标签/分页列表）、歌单详情页（信息头 + 30 条分页 +
      播放全部 + 后台补全）、发现页「推荐」面板（两个分区各自「换一批」）；路由
      `Route.SonglistDetail(source,id,title)` 进现有详情栈
- [x] **起播复用临时列表链路**：`listMusicOverwrite(TEMP) → playListById(TEMP) →
      handleListMusicsUpdated → 进播放页 → 后台 getListDetailAll 补全`，未新建第二套播放入口
- [x] **新增用例 55 条**（core 49 + app 6），fixture 27 个（26 响应 + linuxapi 金标；
      仅 kw child[0]、kg recommend、wy trackIds 三处为合成数据，已在测试注释标注）
- [ ] 真机验收（清单见文末 Wave2 集成记录）

### B5 语义修正记录（在线歌单五源与推荐冷启动，Wave2 Lane A 对照 RN 源码与线上实测）

| 主题 | RN 实证 / 线上实测 | Kotlin 落地 |
|:--|:--|:--|
| wy linuxapi 加密 | RN 用 ECB/NoPadding 加密 **Base64(JSON) 文本**；实测同接口原始 JSON 字节 + PKCS7 → code 200，`Base64(JSON)` + PKCS7 → code 400 | 原始 JSON 字节 + PKCS7（JVM 侧 `PKCS5Padding` 拼写），金标 fixture 固化 |
| tx 歌单详情 | GET `musicu.fcg` 被 `subcode 4000` 拒；改 POST `uniform_get_Dissinfo` 后可用 | POST 表单实现；两种响应都落盘留证 |
| kg 歌单详情 | HTML `global.data` 有 30 行，网关只回 26 条有效 `audio_info`；RN 直接 map 会抛异常 | 跳过不可播条目，`total = list.size`，测试注释记录差异 |
| Java 正则差异 | kg `global = {…};` 在 JS 无碍 | 裸 `{` 在 Java `Pattern` 抛 `Illegal repetition`，已转义并注释 |
| kw 线上数据怪癖 | `rcm` 的 total=1753；tag 10000 请求 rn=36 实际只回 35 条；详情 uname 形如 uid | 分页仍按 total；uname 原样透传 |
| wy 音质尺寸 | flac 尺寸取 `sq.size`；缺字段不补零 | 格式化为 `xx.xx MiB`，缺失写 `JsonNull`；`###` cookie 归一为 `MUSIC_U=<token>` |
| 详情分页 | RN `getListDetailLimit` 只在顺序翻页时成立，跳页会丢 `sourcePage` 记账 | `SonglistDetailPager` 从最近已加载展示页续拉补齐；拼接页 sourcePage 记当前源页 |
| 列表 total 兜底 | RN `songlistActions.setList` 在翻页空响应/无 total 时用 `limit * page` | `SonglistRuntime.reachedEnd` 同规则，app 单测覆盖 |
| 推荐冷启动 | RN `pickPlaylistTag` 无画像时等价 `ranked[rotation % size]`；`pickNewSongBoard` 新歌组优先且组内名字最短；源顺序用 `shuffledSources + Math.random` | 同规则；随机改**轮次轮换**（可复现），代价是同一进程内顺序固定 |
| 路由形状 | RN 用 `source__id` 复合键 | `PlaylistItem.id` 是源本地 id（kw `digest-8__x`、kg `id_…`），路由显式带 `source`，避免拆分歧义 |

### 已完成（B5 第十二切片：列表排序 9 档 + 自定义排序，Wave2 Lane C，2026-10-25）

- [x] **排序规则**（`core/.../list/MusicSort.kt` + 16 用例）：9 档 = 标题 / 专辑（音轨）/
      时长（短→长）/ 时长（长→短）/ 添加时间 / 添加时间降序 / 歌手 / 年份 / 播放次数，
      另加「自定义排序」；字符串比较用 `java.text.Collator(zh-CN)`（Android 委托 ICU，
      与 RN `localeCompare` 同源），`localeId` 做 `_`→`-` 归一化
- [x] **UI 接入**（`ui/list/ListDetailPage.kt`）：排序弹窗 10 项、选中档位高亮；
      `customSortMode` 与多选 `editMode` 互斥；多选态排序按钮灰显不可点
- [x] **落库复用既有能力**：整表重排直接调 `ListStore.listMusicUpdatePosition(listId, 0, allIds)`，
      未新增 ListStore 方法
- [x] **差异锁定用例**：一致用例断言 8 组；JVM/JS 已知 6 组反向差异单独锁成特征用例，
      换比较实现时该用例失败 → 必须同步复核
- [ ] 真机验收：弹窗 10 项滚动、拖拽手感、排序后随机队列同步、Collator 边角与 RN 比对

### B5 语义修正记录（列表排序，Wave2 Lane C）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 字符串比较 | RN 用 `localeCompare(b,'zh-CN')`；Android `java.text.Collator` 委托 ICU，同源 | 用 Collator，不用 `String.compareTo` |
| 已知不一致 | JVM 实测 6 组反向：阿/b、a-b/ab、ab/"a b"、é/e、「，」/a、阿/啊 | 一致组断言；差异组锁成特征用例，**真机 ICU 未复核** |
| 边界 | null 永远在前；排序稳定；`parseInt` 前缀语义（NaN 视同相等） | 同；非法时长片段按 0 |
| 上次档位 | RN 模块级变量，跨歌单/页面记忆 | 页面级 `remember`：切歌单保留、退出详情页重置 |
| 添加时间/播放次数 | RN 读 `add_time`/`play_count` | 当前无读写者 → 0 兜底，对现有数据是**稳定空操作** |
| 排序按钮文案 | RN「排序歌曲」 | 操作条还承载重命名/清空/删除，用「排序」防小屏溢出；10 项档位文案与 zh-cn.json 逐字一致 |

### 已完成（B5 第十三切片 A：推荐画像 M1 重排，Wave3 Lane B，2026-10-26）

- [x] **core `recommend/` 纯规则包**（10 个文件 + 40 用例）：
      `RecommendModels` / `TrackKeys` / `ArtistPrior` / `NameTokenFeedback` / `ThemeFeedback` /
      `PlaylistRank` / `RecommendProfile` / `RecommendProfileStore` / `RecommendSignals` /
      `RecommendSampling`——归一化键、歌手先验、词面反馈、主题反馈、歌单排序、画像装配与
      持久化、信号收集、卡片抽样的逐条移植
- [x] **接线**：新增 `app/.../data/RecommendProfileRuntime.kt`；`SonglistRuntime` 只改
      `object RecommendRuntime` 的分类挑选/排序行（取数逻辑未动），发现页推荐歌单与新歌速递
      已吃画像（UI 未动）
- [x] **越界最小修复（RULES 4，接线必需）**：`ListRuntime` 加 `appContext` +
      `Companion.current()`、`PlayerRuntime` 加 `Companion.current()`，均为只读访问器；
      原因：`RecommendRuntime` 是无参 `object`，而消费方 `ui/songlist/RecommendPanel.kt`
      本波禁改，拿不到 `Context`/播放器实例
- [x] **黄金/契约测试**：`RecommendFactorsTest` / `PlaylistRankTest` / `RecommendProfileTest`
- [ ] 真机验收（7 条）：收藏 10 首后推荐卡片前移且集合不变；新歌速递前 3 首出常听歌手；
      刷新后分类随画像关键词变化；全新安装顺序与 Wave2 一致；清空收藏重启回空画像；
      60s 内反复进出不重复读列表；`@xunyin_recommend_state_v2` 有可解析写入

### B5 语义修正记录（推荐画像 M1，Wave3 Lane B）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 文本归一空白 | RN `normalizeText` 的 `/\s+/g` 含全角空格 U+3000，Java 默认只认 ASCII 空白 | `TrackKeys` 改用 `(?U)\s` + `trim{isWhitespace()}`，否则「A　B」会粘成一个词（单测 `textNormalizationMatchesRn` 复现过） |
| 限额归属 | `themeWeightLimit=200` 同时管 `themeWeights` 与 `tokenWeights`；`artistStats` 用独立 `artistStatsLimit=800`（storage.ts:120-137） | 同参数归属；初版用例把 200 传给 `artistStats`，属测试写错，已改断言参数（未删测试） |
| 词面学习 | RN 用 segmentit 词典分词 | Kotlin/JVM 无等价纯 Java 分词，按空白切分：**中文无空格歌名在 M1 基本学不到词面**（命不中即因子 1，不会误加成）；歌手先验为主信号，分词留 M2/M3 前置 |
| 画像存储形状 | 同在 `xunyin_recommend_state_v2` 键下存原始学习状态 | 存装配好的 `LearnedProfile`；两版数据互不解析（解析失败=空画像重建），键名对齐只为将来统一预留（原生与 RN 本就不共享存储，B1 决策） |
| 信号来源 | 收藏/自建歌单/`@play_history`/`playedList`；踩雷/「不感兴趣」/`themeWeights` 有各自写入方 | 用收藏 `@list__love`、用户自建歌单（≤20 张）、`@play_history`（解析器就绪但**原生无写入方 → 恒空**）、`PlayerCore.playedList`（**仅个性电台**实时曲目，无时间戳按装配时刻计入）；踩雷/隐藏名单以空规则调用 |
| 分类挑选 | 主题级反馈结算出 `themeWeights` | M1 无 `themeWeights` 学习来源 → 分类排序只吃画像关键词亲和度，「歌手名 vs 分类名」通常不命中，**分类挑选大多等于原序**，只有风格词（如「国风」）能被分类名命中；这是 M1 边界不是缺陷 |
| 随机源 | 卡片取样 `Math.random` | 沿用 Wave2 轮次轮换（可复现）；`RecommendSampling.pickCardPlaylists` 保留注入式随机源供后续接真随机 |

### 已完成（B5 第十三切片 B：歌单搜索五源与在线歌单详情二轮，Wave3 Lane C，2026-10-26）

- [x] **core 歌单搜索五源**（`music/search/` 新增 8 文件 + 30 用例）：
      `SonglistSearchModels`（模型 + 聚合器：`SOURCE_LIMIT=18`、`ALL_LIMIT=15`、
      相似度排序、total 兜底）、`SonglistSearchCoordinator`（`page__source__keyword` 缓存 +
      代次 + 全源并发/`maxPages` 跳过 + `reachedEnd`/`clear`）、`SonglistSearchSupport`
      （编码/解码名/播放量/日期/单引号转 JSON）、`Kw/Kg/Tx/Wy/MgSonglistSearch`；
      每源 ≥3 用例 + 真实响应落盘 fixture `songlist-search-{kw,kg,tx,wy,mg}.json`（2026-10-26）
- [x] **app 接线**：`data/SonglistSearchRuntime.kt`（五源并发 + 分源查询/到底/清缓存）；
      搜索页新增「歌曲/歌单」类型切换（`SearchPage`），歌单结果为行式
      （名称 2 行 + 作者·播放量·N 首，`全部` 时显示来源标签；**不取行封面**，避免挤掉
      播放页 `CoverImageLoader` 的 6 张 LRU）；翻页到底显示提示，换源/换类型即时重查
- [x] **歌单详情二轮**（`ui/songlist/SonglistDetailPage.kt`）：
      单曲「加入」走 `AddToListDialog`（试听列表/我的收藏/自建歌单）→ `ListStore.listMusicAdd`
      （加歌位置遵循设置），重复提示「该列表已经有这首歌啦」；
      多选模式（`SelectMark` 勾选 + 全选/取消全选 + 批量加入），批量预演 `AddToMylist.plan`
      去重（批内 + 与目标列表已有），部分重复提示「已添加 N 首，跳过 M 首重复」，
      全重复提示同单曲文案；完成后退出多选
- [x] **头图封面**：`LaunchedEffect(info?.img)` 只加载详情页头图一张（72dp，
      `ContentScale.Crop`），`CoverImageLoader` 零改动（复核结论成立）
- [x] **批量去重单测**：`AddToMylistTest` 4 例（批内重复/全重复/空选/缺 id）
- [ ] 真机验收（7 条）：五源歌单搜索显示与「全部」排序；类型/源切换与翻页到底；
      点行进详情并返回；详情分页与「播放全部」队列补全；单曲加入去重文案与 top/bottom；
      多选批量加入提示；全程竖屏

### B5 语义修正记录（歌单搜索与详情，Wave3 Lane C）

| 主题 | RN 实证（worktree 提交版） | Kotlin 落地 |
|:--|:--|:--|
| 单源「到底」判定 | `store/search/songlist/action.ts#setList` 只写 list/total/page/limit，**从不写 `maxPages`**；UI 用 `maxPages[source] == page`，单源恒 0 ⇒ 永不显示到底 | `SonglistSearchAggregator.single` 按 `total/limit` 推算 `allPage`，`reachedEnd` 用 `maxPage <= page`（有意修正 RN 的失效判定） |
| 聚合页源跳过 | page>1 时跳过 `page > maxPages[source]`；失败源 catch 成空页后仍写 `maxPages=0` | 同条件跳过；失败源按 `emptyPage(id, limit)` 参与聚合、`maxPages` 记 0 |
| 去重 | `deduplicationList` 导入被注释，单源/聚合直接拼接（仅单曲搜索去重） | 聚合器不做 id 去重；用例 `single does not deduplicate ids` / `all page two appends without deduplication` 锁死 |
| limit | 单源 18；`all` 15 且把 15 传给每个源 | 同（`SOURCE_LIMIT=18`、`ALL_LIMIT=15`） |
| 聚合排序 | `similar(keyword, item.name)` → `sortInsert` → 整体 `reverse()` | 复刻同一算法与比较插入顺序 |
| total 兜底 | page==1 或 (total && list.length) 用 total，否则 `limit*page`（聚合用 `maxLimit*page`） | 同 |
| 关键词代次 | `key = page__source__text`，响应回来校验 key 不一致返回 `[]` | 缓存 key 同形；代次不符返回 `null`，界面丢弃（空数组 vs null 的表示差异） |
| 缺 id 条目 | 各源 map 后未显式过滤 id（缺 id 也可进列表） | 五个解析器跳过空 id，避免落库/播放出空 key（有意收紧，KDoc 记录） |
| 酷我响应 | 单引号 JS 对象，`objStr2JSON` 转换 | 同规则只替换结构位置的 `'`（保留 `It's` 这类正文撇号），用例覆盖 |
| 酷我播放量 | `formatPlayCount(playcnt)`，小数值仍是字符串（如「566.4万」） | `SonglistUtils.formatPlayCount`，字段保持 String |
| 企鹅重试 | `retryNum > 5` 抛错 ⇒ 最多 6 次；UA=MSIE9 + Referer=y.qq.com | 同 6 次与请求头（用例验证 3 次成功/6 次失败） |
| 网易 eapi | AES-128-ECB；Node `NoPadding` 实测报 `wrong final block length`，PKCS7 服务端返回 code=200 | JCE `AES/ECB/PKCS5Padding`（与既有 `WySearch` 同），KDoc 记实测 |
| 咪咕签名 | md5(keyword + 固定串 + appKey + deviceId + time)，`searchSwitch` 仅开 songlist | 同式，`clock` 可注入；黄金签名用例 |
| 日期 | `dateFormat('Y-M-D')`：数字按毫秒，字符串 `-`→`/` 后取年月日 | `SonglistSearchSupport.date` 同规则；酷狗 `2023-01-10 19:31:00` → `2023-01-10` |
| 搜索结果形态 | 封面网格 | 行式（`CoverImageLoader` LRU 6 张，逐行取图会挤掉播放页缓存；待独立小图缓存再换网格） |

### 已完成（B5 第十四切片：歌单长尾，Wave4 Lane C，2026-10-26）

- [x] **列表菜单去重**：`core/list/DuplicateMusic.kt`（分组/判重）+ `ui/list/DuplicateMusicDialog.kt`
      （分组排序、单条移除、确认移除）；列表详情操作行改为横向滚动以容纳 9 项
- [x] **lxmc 导入导出**（`app/.../util/SafDocuments.kt`）：`CreateDocument`/`OpenDocument`，
      `*/*` + 读后按扩展名（json/lxmc/bin）校验；导出确认弹窗明示「同名由系统加 (1)，不覆盖」
- [x] **整单导入为新歌单**：`core/list/SourceListMatch.kt` 判「同源同单」已存在
      （兼容 `sourceListId == id` 与 `${source}__${id}` 两种历史形态）
- [x] **歌单链接打开入口**：`core/songlist/SonglistLinkParser.kt`（五源链接/id 解析）
- [x] **封面磁盘缓存**：`CoverImageLoader.init(context)`（新增 API，未调用退化原行为）+
      `cacheDir/cover_images/<sha1(url)>.cover`、坏图解删回源、tmp+rename 原子写、
      >300 张按 mtime 淘汰；`object`/`load(rawUrl:String?)`/`CoverArt`/LRU 6/最长边 1200/
      RGB_565/blur 32 全部不变
- 任务 4（本地文件 / 同步）**只评估未实现**，结论见下方待办

### B5 语义修正记录（歌单长尾，Wave4 Lane C 对照 RN 源码实证）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 同名导出 | `MyList/listAction.ts:66` 固定文件名，`tools.ts:159` 直接 `gzipFile` 覆盖写，**无存在性检查/序号** | 交给 SAF `CreateDocument`：系统自动改 `(1)`、不覆盖；弹窗文案已明示 |
| 列表菜单可导入类型 | `readListData` 只接受 `playListPart(_v2)`，其余 `showImportTip` 拒绝 | 额外接受整表备份（`playList_v2`/`allData_v2`/`playList`/`allData`）并套用 RN 设置页 `importPlayList` 二次确认——原生暂无设置页备份入口，否则整表导入无入口（**语义选择，非对齐**） |
| 内置列表冲突 | `handleImportListPart` 冲突且取消覆盖 = id 追加 `__<ts>` 后 `createList`，内置列表本身不动 | 按 RN 修正（此前是「追加进内置列表」），用例 `partRenameCopyOfBuiltinCreatesUserList` 钉住 |
| 爱心同认人 | 靠 `source`/`sourceListId` 判来源身份 | 原生爱心列表无这两个元数据（也没有「收藏在线歌单进爱心」的写入路径），整单导入去重只覆盖 userLists，记遗留 |
| kw 链接跨域 | `normalizeId` 不校验 host，任意域名同路径都接受 | 保持一致，跨源粘贴需手选来源；提示文案照抄 RN 四条 |
| id 判定链 | kg 仅 `id_<数字>` 与 `/special/single/<数字>.html`；mg 纯 id / `playlistId=` / `id=` / `/playlist/<id>`；wy `###token` 整段透传 | 同；酷狗码、mg 短链（需跟重定向）、wy 私人雷达按 RN 文案保留说明，实际由详情接口报错 |
| 封面缓存 | RN `getPicPath` 只解析 URL，图片缓存由 Fresco 内部完成，**无显式目录/键规则** | 自设计：sha1 命名 + 坏图删除 + tmp/rename 原子写 + 300 张上限 + 命中刷 mtime |
| SAF 类型过滤 | picker 层按扩展名过滤 | `OpenDocument` 用 `*/*` + 读后校验（部分 provider 把 `.lxmc` 报成 octet-stream/gzip，绑死 MIME 会误伤） |

### 已完成（B5 第十五切片：个性电台 M2，Wave4 Lane A，2026-10-26）

- [x] **`:core` M2 引擎**（`core/recommend/radio/` 21 文件 + 103 用例）：`Bandit`（Thompson 采样，
      RNG 全注入）、`Channels`（A/B/C/D 配额与 fallback）、`RadioPool`（合并/补池/冷却）、
      `RadioCandidates`、`RadioSelection`（配额/间隔/去重）、`RadioQueue`（pending/committed）、
      `RadioFilter`（踩雷/排除集）、`RadioListening`（收听区间/结算）、`SessionHealthLogic`
      （安全模式）、`RadioDeferral`、`TempQueueOrder`（补位排在手动「稍后播放」之后）、
      `RadioState(+Codec)`、`RadioConfig`、`RadioTrackKeys`、`RadioRequestPolicy`、`RadioEngine`
- [x] **app 编排与接线**：`RadioRuntime`（抓取/补位/播放历史写入/停播让位/tempQueue 重排/
      喜欢与不感兴趣闭环）、`RadioStateStore`（`xunyin_recommend_radio_state_v1`，1500ms 防抖）、
      `DislikeStore`（`@dislike_list`，与 RN 同键同格式）
- [x] **UI**：发现页推荐区「个性电台」入口卡 + `ui/radio/RadioPage.kt`（队列预览/状态/
      喜欢/不感兴趣/换一批/停止）+ `HomeNavigator.Route.Radio`
- [x] **M3 零触碰**：依赖处一律降级，清单见下方遗留 2

### B5 语义修正记录（个性电台 M2，Wave4 Lane A 对照 RN 源码实证）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| `playedList` 写入 | `radio.ts:141-153` 仅「临时曲 + 属电台队列」写 | `PlayerCore` 只发 `onMusicToggled`；`RadioRuntime` 判定后写（详见 B2 Wave4 Lane A 表） |
| 停播让位 | `radio.ts:146-149` 切到「非临时曲且有 listId」即 `stopRadio()` | 同判据；停播撤队并清电台写的历史 |
| JS 正则不能直接搬 | `trackKey.ts:52` `/[([][^)\]]*[)\]]/g` | **原样照抄会抛 `PatternSyntaxException`**（Java 字符类里裸 `[` 非法）→ 对象初始化失败、整个 radio 包 `NoClassDefFoundError`；已改 `[\\[(][^)\\]]*[)\\]]`。教训：只编译不跑测试的移植等于没移植 |
| 踩雷规则写侧 | `dislikeManage.updateDislikeInfo` 逐行归一化、去重、`@`→`#` 转义后整体重写 `rules` | `DislikeRulesParser.normalize/appendRule` 同语义（以首个 `@` 切分，其后 `@` 转义为 `#`；RN `split` 只取前两段会丢多段，这里保留并转义） |
| RNG 可复现 | 全程 `Math.random()`（bandit 抽样、softmax、曲目间隔） | 全部走 `rng: () -> Double` 注入：core 用 `RadioFixtures.seededRandom(seed)`，app 侧 `Random(seed)`；三条用例守住可复现性 |
| 存储键位 | 整个 `RecommendationState` 存 `xunyin_recommend_state_v2` | 形状不同（M2 子集 + `JsonObject` 曲目表），另起 `xunyin_recommend_radio_state_v1`，不与 RN/M1 互解析 |

### 待办（B5 剩余）

- [ ] 默认列表的「随机播放/收藏全部」等批量操作仍缺；
      ~~列表级菜单另缺 duplicateMusic / 本地文件 / 同步 / 导入 / 导出 5 项~~
      → **duplicateMusic / 导入 / 导出 已由 Wave4 Lane C 完成**（去重弹层 + SAF lxmc 导入导出）；
      **本地文件 / 同步只做评估未实现**：本地文件缺 `source=='local'` 直接读 `meta.filePath` 的
      播放分支 + `MediaMetadataRetriever` 读标签/内嵌封面/歌词 + SAF 目录持久授权，预计独立
      M 级任务（建议 Wave5 单列）；同步的数据层已齐（`getListDetailAll` /
      `listMusicOverwrite` / `locationUpdateTime` + 整单导入已写 source/sourceListId），
      只差列表菜单加「同步」+ RN `list_sync_confirm_tip` 确认，**下一波可直接做**
- [ ] 排序的两个空操作档位：`add_time_up/down` 与 `play_count` 仍按 0 兜底
      （Wave3 Lane C 的可选任务 4 经评估未做：`listMusicAdd` 未附加时间元数据；
      对现有数据是稳定空操作，待 data.ts 等价层落地后自动生效）
- [x] **个性化推荐 M1（画像重排）** → **已由 Wave3 Lane B 完成**（core `recommend/` +
      画像装配/持久 + 发现页推荐歌单/新歌速递排序接线；见上方第十三切片 A）
- [x] **个性化推荐 M2（电台全家桶）** → **已由 Wave4 Lane A 完成**（core `recommend/radio/`
      21 文件 + 103 用例；候选池/队列/选曲/安全模式/收听结算；电台页 + 喜欢/不感兴趣闭环；
      见上方第十五切片）
- [ ] **个性化推荐 M3（音频相似与 MMR）**：
      - **M3**：`audioEmbedding`/`melSpectrogram`/`nativeAudio` 音频相似与 MMR
        （`diversity`/`similarity`），需 native 方案评审
      - M2 的降级清单（接 M3 后回填）：`RadioPool` 画像亲和度目前是「种子重合归一 + 弱主题
        加成」而非 `similarity.ts`；`RadioSelection` 无同作品软降频/分类轮换/语种硬配额；
        `RadioModels` 无 `langHint`；**探索通道 C 无候选来源**，配额按 `Channels` fallback
        让给 A/B/D（电台能跑，但「撞新」弱于 RN）；候选抓取只有三路（画像歌手 A / 榜单 D/A
        / 推荐歌单 B），相似歌手 E 与种子搜索未接；`RadioRequestPolicy` 与
        `createSimilarArtistCandidates` 暂无调用方（M3 接入点，有单测覆盖）
- [ ] **画像 M2 剩余细项**：`themeWeights` 与显式反馈结算（`applyThemeFeedback`）、
      隐藏歌单 UI、`rankState` 的 `blocked/hidden` 消费（参数已预留）；
      `importedOrigins` 恒返回空——M1 未保存「本地收藏来自哪个网络歌单」的映射，
      导入归因 `creditImportedOrigins` 当前不生效，需数据层补映射
- [ ] **踩雷解析两侧不一致**：`DislikeRulesParser.parse` 未做 `@`→`#` 归一，而
      `PlayerCore.DislikeInfo.key` 的 `norm` 做了；歌名/歌手中含 `@` 时两处判重会不一致
      （RN 两侧都归一）。M1 文件行为差异，Wave4 只新增写侧函数未改，建议后续统一
- [ ] **onboarding 问卷与推荐区「更多」分页**（Wave4 Lane A 按任务书留遗留）：
      `onboarding.ts` 未移植；电台页目前只展示 6 首队列预览，队列全量查看建议随「更多」分页一起做
- [ ] **歌单搜索与在线歌单详情真机验收**（第十三切片 B 代码完成）：五源歌单搜索、类型切换、
      翻页到底、详情加入/多选批量、头图封面（7 条清单见上方小节）
- [x] ~~歌单详情遗留：RN 提交版 ActionBar 是「整单导入为自建歌单」~~ → **已由 Wave4 Lane C 完成**
      （`handleImportAsList` 语义：整单导入为新歌单并写 source/sourceListId，同源同单再点提示已存在，
      与单曲加入/多选批量并存）；仍缺 **下载 / 分享 / 相似歌曲** 三个菜单项
- [ ] 搜索页点歌单的**路由残留**：`Route.SonglistDetail` 已由 Wave4 建立（发现页推送走导航栈），
      但 `SearchPage` 仍是页内覆盖 `SonglistDetailPage`（返回即回搜索、结果滚动位置重置）；
      改成 `navigator.push` 需给 `SearchPage` 传导航回调（本波未做）
- [ ] **首页「我的」列表行长按菜单**未做：RN 首页列表可长按出菜单；原生当前所有列表操作
      只在**列表详情页顶部操作行**（Wave4 Lane C 已扩到 9 项并支持横滑），`ui/HomePage.kt` 未加长按
- [ ] **deeplink intent filter** 未做：外部链接直接进歌单详情（`SonglistLinkParser` 已能解析五源
      链接，缺 `AndroidManifest.xml` 的 intent filter 与启动参数分发；Manifest 归 Lane A，
      Wave4 未认领）
- [x] 设置页继续接：~~自定义源管理（B3）、缓存清理与缓存大小、倍速/音量偏好~~
      → **已由 Wave1 Lane B 完成**（自定义源管理页 + 音源日志页 + 缓存统计清理 +
      电池优化/通知权限 + 音量/倍速滑杆 + 记住播放进度开关）；
      ~~剩 `player.isSavePlayTime` 尚无消费者、`player.volume`/`playbackRate` 启动时不回读~~
      → **已由 Wave3 Lane A 关闭**（三键回读 + 进度记忆接线，见 B2 Lane A 小节）
- [ ] **首页导航壳真机验收**：三 tab 切换/重复选择、各栈系统返回、设置/播放返回状态保留、
      迷你播放条，以及搜索起播/加入列表尚未在真机上验收
- [ ] **五源搜索真机验收**（第八切片代码完成）：五源取数、聚合排序、翻页加载更多、
      换源即时切换
- [ ] **排行榜真机验收**（第九+第十切片代码完成）：kw 加密链路、kg 取数、分页、起播；
      另加 tx 期号跨天重抓、wy weapi **服务端是否接受**（JVM 侧只能证形状）、mg 整榜 50 条

## B6 长尾屏幕与桌面歌词

**状态：进行中**（桌面歌词浮窗 MVP 由 Wave2 Lane B 于 2026-10-25 完成并入；Wave3 Lane A
补齐冷启动恢复、设置页小节、锁定/样式实时刷新与 `SettingsStore` 数值互通；OEM 保活/前台
服务、单行横向滚动、RN 特殊皮肤与真机验收仍缺）

### 已完成（B6 首版：桌面歌词浮窗 MVP，Wave2 Lane B，2026-10-25）

- [x] **core 纯规则**：`DesktopLyricLine.kt`（逐行提前量与行集合，11 用例）、
      `DesktopLyricColor.kt`（rgba/#hex 解析，5 用例）、`DesktopLyricSettingKeysTest`（5 用例，
      默认键契约）；合计 core +21
- [x] **悬浮窗服务**（`app/.../lyric/DesktopLyricService.kt` + `DesktopLyricOverlay/Row`）：
      `TYPE_APPLICATION_OVERLAY` 窗口、宽 `maxWidth*widthPercent/100`、高
      `fontMetrics.height*maxLineNum` 封顶 `maxHeight-100`、百分比定位后夹在屏内（负坐标归 0）
- [x] **逐行滚动**：`OFFSET_MS = 150`（对齐桌面 RN；播放页 Kotlin 仍是 100，未动）；
      当前行 + 扩展行，单行模式只显示当前行；纯空白扩展行跳过
- [x] **开关与权限流程**：更多菜单新增「桌面歌词」行；未授权先 toast 再跳
      `ACTION_MANAGE_OVERLAY_PERMISSION`，返回后按系统事实起服务或回滚开关
- [x] **位置持久化**：`position.x/y` 统一写四舍五入后的**整数百分比**（见下表类型强转差异）
- [x] **Manifest**：新增 `SYSTEM_ALERT_WINDOW` 与 `DesktopLyricService`；
      `screenOrientation="portrait"` 未动
- [ ] 真机验收（清单见文末 Wave2 集成记录）

### 已完成（Wave3 Lane A：桌面歌词二轮，2026-10-26）

- [x] **冷启动自动恢复**（`PlayerRuntime.observeDesktopLyricRestore()`）：
      进程内第一次出现「当前播放曲目」且开关为开时调 `DesktopLyricController.sync()`；
      每进程只尝试一次（避免每次切歌重复 `startService`），无当前曲目不拉起
- [x] **设置页桌面歌词小节**（新增 `ui/settings/DesktopLyricSettingsSection.kt`）：
      开关复用播放页同一个 `DesktopLyricRow`；覆盖宽度/行数/单行/字号/透明度/
      播放与未播放颜色/对齐/锁定/动画
- [x] **锁定与样式实时生效**（`DesktopLyricService`）：`ensureLoaded()` 后先
      `refreshConfig()`，再持续 `collect` `SettingsStore.state`；宽度/行数/字号/透明度/
      颜色/对齐/锁定全部 `updateViewLayout` 即时刷新，**不用重启服务**
- [x] **`SettingsStore` 数值互通**：Int/Long 分支在 `toIntOrNull()` 失败时回退
      `toDouble()` 截断，锁死 `72.0→72`、`200.0→200`、`33.5→33`（与 JS 数值转 Int 一致）
- [x] **退出收尾**：到点退出 `PlayerRuntime.shutdown()` 先关桌面歌词服务（见 B2 Lane A）

### B6 语义修正记录（桌面歌词二轮，Wave3 Lane A）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 配置刷新时机 | RN 设置即时作用于浮窗 | Wave2 只在服务启动读一次 → 改为先 `refreshConfig()` 再订阅设置流；锁定/几何/样式全程实时 |
| 数值落盘形态 | RN 设置经 JSON 落盘，可能出现 `72.0`、`33.5` 等形式 | `SettingsStore` Int/Long 分支「先整数、再 `toDouble()` 截断」；小数 JSON 用例锁死，避免回落默认值 |
| 冷启动恢复 | `core/init/player/lyric.ts:33-35`：启动时若 `enable=true` 自动恢复，异常落 false | `observeDesktopLyricRestore` 在首次出现当前曲目时 `sync()`；每进程一次；若拉起失败由 `DesktopLyricController` 按系统事实回滚开关 |
| 退出时收浮窗 | `handleExitApp` 先收桌面歌词 | `shutdown()` 里 `runCatching { DesktopLyricController.get(appContext).shutdown() }` |

### B6 语义修正记录（桌面歌词，Wave2 Lane B 对照 RN 源码实证）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| 逐行提前量 | 桌面 `LyricPlayer.offset = 150`；Kotlin 播放页 `LyricParser.DEFAULT_OFFSET_MS = 100` | 桌面独立 `OFFSET_MS = 150`；单测锁 850ms 停第一行、851ms 切第二行 |
| 显示哪些行 | `LyricView.setLyric`：当前行 + 扩展行，`maxLineNum>1` 且非单行时最多 `maxLineNum` 行 | 同规则；RN `Lyric.java` 只滤空串，Kotlin 连纯空白扩展行也跳过；`maxLineNum<=0` 仍显示当前行一次 |
| 翻译/罗马音开关 | `Lyric.java:193-196` 扩展行受 `isShowTranslation`/`isShowRoma` 控制，并跟随播放页开关 | MVP 无桌面独立开关，直接用 `ParsedLyric.extendedLyrics`（与播放页 `ui/play/LyricView.kt:92` 一致）；**Wave3 Lane A 设置页小节也未加这两项**，差异仍在 |
| 窗口几何 | 宽 `maxWidth*widthPercent/100`；高 `fontMetrics.height*maxLineNum`，封顶 `maxHeight-100`；百分比定位后夹在屏内 | 像素级照搬；RN 窗口大于屏幕时会出现负坐标，Kotlin 统一归 0 贴左上 |
| 颜色解析 | `LyricView.parseColor`：先匹配 `rgba?()`（alpha 0-1 小数），否则 `Color.parseColor`，失败回退黑 | `DesktopLyricColor` 移植；RN 正则只允许逗号后空格，`rgb( 7 , 197 , 86 )` 会回退黑（已写成用例）；支持 #RGB/#ARGB/#RRGGBB/#AARRGGBB |
| 位置持久化 | `mergeSetting` 原样复制 JS 原始值，RN 写小数百分比 | **关键差异**：`SettingsStore.merge` 按默认值类型强转，`position.x/y` 默认 Int 0，小数会被丢弃成 0 → Kotlin 统一写四舍五入整数百分比；RN 旧版小数在 Kotlin 读侧可能变 0（契约测试固化）。`SettingsStore` 属禁触区，未改 |
| 权限流程 | `DesktopLyricEnable.tsx` 先弹确认框，再跳系统悬浮窗页；回来自检，失败开关落回 false | MVP 直接 toast 后跳系统页；`ON_RESUME` 按系统事实起服务或回滚，未授予时提示并关闭 |
| 冷启动恢复 | `src/core/init/player/lyric.ts:33-35` 启动时若 enable=true 自动恢复，异常落 false | ~~无 Application 级钩子~~ → **Wave3 Lane A 已补**：`PlayerRuntime.observeDesktopLyricRestore()` 在首次出现当前曲目时 `sync()`（每进程一次） |
| 锁定态 | `isLock`：窗口不可触摸、背景透明、Android 12+ 透明度 0.8 | 同左；MVP 只读取设置、运行中改 `isLock` 需重开服务 → **Wave3 Lane A 已改为设置流驱动实时刷新**（触摸监听切空/恢复、`updateViewLayout`） |
| 单行模式 / 服务形态 | `LyricTextView` 横向滚动；普通 Service + 悬浮窗，无前台通知 | MVP 用 marquee 截断；同为普通 Service，未用前台服务，内存紧张时可能被回收 |

### 待办（B6 剩余）

- [x] ~~冷启动自动恢复~~ → **Wave3 Lane A 完成**（`observeDesktopLyricRestore`，每进程一次）
- [x] ~~桌面歌词设置页：锁定、宽度、最大行数、字号、透明度、播放/未播放/阴影颜色、文字位置~~
      → **Wave3 Lane A 完成**（`DesktopLyricSettingsSection`）；仍差**翻译/罗马音独立开关**，
      以及 RN 的「新年皮肤」等特殊覆盖与自定义颜色输入（若要求像素级一致需单独排期）
- [x] ~~锁定态切换与服务内实时接收设置变更~~ → **Wave3 Lane A 完成**（设置流驱动 `refreshConfig`）
- [ ] 单行模式横向滚动（对齐 RN `LyricTextView`，MVP 是 marquee 截断）
- [ ] **OEM 保活 / 前台身份：Wave4 决议——本波不实现**（`docs/waves/w4-A.md` 任务 5 复核）：
      `PlaybackService` 已是 `MediaSessionService` 且类型/权限齐备，电台主线（含后台自动补位）
      没有硬需求，故 **Manifest 未改动**（方向属性自然未动）；`DesktopLyricService` 仍是普通
      Service，仍是后台被杀的首要风险点，其 FGS 化与「后台播放帮助」页按 `w3-A.md` 建议 2/3
      单独立项。`desktopLyric.style.lyricUnplayColor` 在 MVP 里仍未被渲染使用
- [ ] 真机验收（MIUI/HyperOS 优先；Wave3 新增 6 条清单见文末 Wave3 集成记录，叠加 Wave2 的 7 条）
- [ ] 位置小数百分比互通：Lane A 已让 `SettingsStore` 读小数（截断为 Int），但写侧仍是整数百分比；
      若要与 RN 小数完全互通，需把 `position.x/y` 改成 Double 或字符串/放大整数（W3 未动契约）

## B1 数据与领域层移植

**状态：已完成**（2026-10-24；`:core` 63/63 + `:app` 9/9 全绿，DataStore 接线完成）

### 已完成（B1）

- [x] `:core` 纯 Kotlin JVM 模块（kotlin-jvm 2.4.20 + serialization 插件 +
      kotlinx-serialization-json 1.12.0 + coroutines 1.11.0），独立于 Android 平台
- [x] **主题表生成器迁移**：`theme/` 三件套——createThemes.js/utils.js/colorUtils.js
      的精确 Kotlin 移植，17 个内置主题配置全量录入，黄金测试对照 RN 生成物
      themes.ts 逐值锁死（含 JS 拼接怪癖、parseInt 截断、暗色 c-theme 规则）
- [x] **AsyncStorage 分片编解码 + 存储抽象**：`storage/PartStore.kt`（v1/v2 双格式）、
      `storage/KvStore.kt`（接口 + InMemory 测试实现）、
      `storage/ShardedKvStore.kt`（RN saveData/getData 全协议兼容门面）、
      `storage/StorageKeys.kt`（storageDataPrefix 全表 40+ 键）
- [x] **KvStore 的 DataStore 实现**（app 模块）：`data/DataStoreKvStore.kt`
      （androidx.datastore-preferences 1.3.0）；`:core` 经由 app 依赖接入
- [x] **持久化数据仓库**：`data/DataRepository.kt`（utils/data.ts 核心：设置、
      用户列表含 PC 数字 id ".0" 修复、列表歌曲、歌词、音乐 URL、其他源、
      滚动位置、临时列表元信息）
- [x] **列表状态层（Redux slice → StateFlow/MVI 定调）**：`list/ListStore.kt`
      ——RN list slice（state+action+事件）合并为单 store，StateFlow 驱动，
      Mutex 串行替代事件时序；listManage.ts 全操作移植：
      listDataOverwrite/userListCreate(重复 no-op)/userListsRemove/userListsUpdate/
      userListsUpdatePosition/listMusicAdd(top/bottom 去重)/Remove/Move/
      UpdateInfo/UpdatePosition/Clear
- [x] **.lxmc 备份导入导出**：`backup/BackupManager.kt`——gzip(JSON) 编解码
      + importPlayList 全类型 switch（playList_v2/playList/allData_v2/allData/
      playListPart_v2/playListPart），v1→v2 旧格式自动转换、flac32bit 修复、
      冲突 id 追加时间戳；导出固定 playList_v2
- [x] **设置层**：`setting/DefaultSetting.kt`（80 键默认表+新年皮肤）+
      `setting/SettingMerger.kt`（mergeSetting 算法+compareVer+版本迁移钩子）

### B1 验收对照（评估文档 §七）

- [x] 「单测覆盖核心 reducer/state 迁移」→ **`:core` 63 用例**（主题黄金对照 9、
      分片 6、gzip 3、ShardedKvStore 8、音乐工具 11、设置 8、ListStore 13、
      BackupManager 8）
- [x] 「数据导入（lxmc 备份文件）在原生壳里跑通」→ BackupManagerTest 覆盖：
      导出→导入往返、v1 旧格式转换（kg hash id）、Part 冲突改名、音质修复、
      坏档报错；**文件选择器/确认对话框属 UI 层留 B5 接入**，数据层链路已闭环
- [x] Redux → MVI 映射定调：slice 边界 = Store 边界（ListStore 先行示范，
      B5 的其余 slice 沿用此模式）
- [x] 最终构建：`ktlintCheck` + `test`（72/72）+ `assembleDebug`（20.16 MB）
      全绿；`./gradlew test` 聚合双模块，CI 无需改动

### B1 决策记录

| 决策 | 理由 |
|:--|:--|
| MusicInfo 用 JsonElement 动态模型而非强类型 data class | LX.Music.MusicInfo 的 meta 按源形状多变（kg hash/tx strMediaMid/local filePath），备份导入导出只需结构级操作；与 JS 动态对象行为一致 |
| `:core` 纯 JVM 模块 + KvStore 接口抽象 | 领域逻辑零 Android 依赖，JVM 单测秒级反馈；DataStore 实现留在 app 模块，`:core` 可测可复用（B3 QuickJS 桥直接受益） |
| DataStore 文件独立于 RN AsyncStorage（不共享） | 双版本并行期各管各的存储更安全；B7 收官批做一次性迁移导入（用 ShardedKvStore 兼容层读 RN 分片格式） |
| 黄金值对照法移植主题生成器 | 不抄 4,289 行生成物，移植生成逻辑 + 用 themes.ts 抽值锁等价——生成器改动（B4 主题定制）有测试兜底 |
| ListStore 用 Mutex 串行 + 写穿 | RN 靠全局事件时序保证一致性；StateFlow/MVI 下用锁+同步持久化最直接，B5 大列表时可加节流 |

### 下一批（B2 播放内核与原生桥）

Media3 ExoPlayer + MediaSessionService、rn-track-player 定制对照、
缓存/文件/电池优化等 48 个 Java 文件的等价物拆解。

## B2 播放内核与原生桥

**状态：进行中**（2026-10-24 起；决策层 + Media3 平台 + crypto + cacheTrack 预热 + 状态同步/通知栏命令 + 实例接线/失败重试/加载超时/音量均衡完成，`:core` 111/111 + `:app` 13/13 全绿）

### 已完成（B2）

- [x] **播放决策核心**：`player/PlayerCore.kt`——RN src/core/player
  （player.ts + utils.ts filterList + randomList.ts + prevHistory.ts）的
  切歌编排移植：playNext/playPrev（listLoop wrap、list 保持、random、
  singleLoop；手动切歌对 list/singleLoop/none 按 listLoop 处理）、
  playListById、togglePlay、tempPlayList 优先、playedList 历史回退
  （含临时曲锚点 resolvePrevAnchor、stale 条目清理）、不喜欢过滤、
  随机队列全生命周期（生成/同步/取上下曲回绕/列表增删同步）
- [x] **PlayerPlatform 抽象**：Media3 由 app/android 层实现，`:core`
  决策逻辑全部可 JVM 单测（FakePlatform 注入）；12 用例锁死切歌语义
- [x] **Media3 平台实现**（app 模块）：`player/Media3PlayerPlatform.kt`
  （media3 1.11.1）——对照 rn-track-player fork（LocalPlayback/MusicManager，
  fork 基于 1.8.0）的定制点：LRU 音频缓存（SimpleCache +
  LeastRecentlyUsedCacheEvictor，filesDir/TrackPlayer）、audioOffload 开关
  （AudioOffloadPreferences + gapless 必需）、handleAudioFocus
  （setAudioAttributes 第二参）、C.WAKE_MODE_NONE + 自管 wakeLock、
  CONTENT_TYPE_MUSIC + USAGE_MEDIA、DefaultHttpDataSource（默认超时 +
  跨协议重定向 + 移动 UA，与 fork Track.java 播放路径一致）、
  FLAG_IGNORE_CACHE_ON_ERROR；播放事件回调（Playing/Paused/Ended/Error）
- [x] **播放服务**：`player/PlaybackService.kt`（MediaSessionService，
  manifest 已注册 foregroundServiceType=mediaPlayback + 权限）
- [x] **crypto/ 等价物**（`:core`）：`crypto/Crypto.kt`——RSA.java
  （2048 X509/PKCS8、可配 padding）+ AES.java（CBC/ECB、短 IV 补零 16 字节、
  Base64 串接口）+ SHA1 的精确移植，7 用例（含 RSA/AES 往返、错误密钥空串、
  SHA1 黄金值）；B3 音源脚本加密直接受益
- [x] **下一首预热纯表**（`:core`）：`player/PreloadPlan.kt`——RN
  `src/core/player/preloadPlan.ts` 的逐条移植：60s 解析门限 / 10s 时长下界 /
  3s 反悔窗口 / 8MB head 档 / 缓存装得下前缀才发音频字节；`doneSteps` 集合
  替代 RN 的 Record，16 用例逐条对照 `tests/preload-next-music-plan.mts`
- [x] **缓存预热与缓存管理**：`player/PlayerCache.kt` 接口 +
  `Media3PlayerPlatform` 实现（对照 fork LocalPlayback.java:72-200）：
  `cacheTrack`（复用播放器同一份 SimpleCache、与播放路径同一套请求头
  ——UA 走 setUserAgent、其余进 defaultRequestProperties、maxBytes<=0 →
  C.LENGTH_UNSET、token→CacheWriter 注册表**在调用线程登记**再起 worker、
  读循环结束 token 仍在表内才算成功）、`cancelCacheTrack`、`isCached`、
  `getCacheSize`、`clearCache`；`release()` 先取消在途预热再放缓存
- [x] **应用缓存大小/清理**：`cache/AppCache.kt`（CacheModule.java 等价物）——
  cacheDir + externalCacheDir 求和、清 WebView 库与两个缓存目录；
  设置页入口已建（B5 第四切片），缓存大小/清理入口待接
- [x] **状态同步**：`PlayerPlatform` 增加 `positionMs/durationMs`（未知长度归一化为 0，
  不把 `C.TIME_UNSET` 漏给上层）；`PlayerCore` 增加 `syncProgress/setVolume/setRate/seekTo`；
  `player/PlaybackCoordinator.kt` 移植 RN `player.ts` 事件映射与 `playProgress.ts` 轮询：
  Playing→isPlay=true+立即取一次进度、每 `1000/playRate` ms 再取（息屏停更）、
  Paused→停表、Ended→进度归零+自动下一首、Failed→置暂停并报错
- [x] **通知栏元数据**：`updateMetadata` 支持封面 URL（`setArtworkUri`，
  media3 session 自带 http BitmapLoader）
- [x] **通知栏/耳机键切歌**：`PlaybackCommands` 接口 + `CorePlaybackCommands`
  （转发 PlayerCore）；Media3 侧用 `ForwardingPlayer` 把
  COMMAND_SEEK_TO_NEXT/PREVIOUS 加进可用命令并转发给 PlayerCore
  （media3 1.11 已废弃 `onPlayerCommandRequest`，官方替代即此法）
- [x] **系统设置能力**：`util/SystemSettings.kt`（BatteryOptimizationUtil +
  NotificationPermissionUtil 等价物）——电池优化豁免查询/申请、
  通知权限（含通道 IMPORTANCE_NONE 检查）/跳设置页；设置页已建（B5 第四切片），这两个入口待接
- [x] **实例接线**：`app/.../player/PlayerRuntime.kt`——PlayerCore +
  Media3PlayerPlatform + PlaybackCoordinator + CorePlaybackCommands 组装成
  进程级单例（服务与 UI 共用，避免第二份 ExoPlayer/SimpleCache）；
  `PlaybackService` 改用 runtime 挂 MediaSession；切歌时从状态流同步通知栏
  元数据（name/singer/meta.albumName/meta.picUrl）；通知栏 play/pause 也转给
  PlayerCore（空播放器时重新取链，对照 service.ts RemotePlay/RemotePause）
- [x] **取链失败与重试**（对照 playerEvent.ts:91-118 + player.ts:140-161）：
  播放错误先刷新 URL 两次（计数按曲重置、刷新前 `syncProgress` 保住位置；
  第二次刷新失败或第三次仍错 → 停播并报错）；前台 5 秒后、后台立即
  `playNext(true)`；取链失败（RN setMusicUrl catch）同样 5 秒后自动下一首；
  到点时已停播/已换曲则不再跳
- [x] **加载超时**（对照 playerEvent.ts:17-43）：`PlaybackEvent.LoadStarted`
  （平台 setResource 后发出，不用语义更宽的 media3 STATE_BUFFERING）起
  25 秒计时；同一首第一次超时刷新 URL，第二次超时直接 `playNext(true)`；
  `Playing`/`Ended`/`Failed`/`stop` 清表；换曲清掉「上次超时曲目」
- [x] **音量均衡**（VolumeBalancerModule.java + volumeBalancer.ts 等价物）：
  `app/.../player/VolumeBalancer.kt`——DynamicsProcessing MBC 三档
  （low/mid/high：ratio 2/4/8、threshold -12/-18/-24dB、postGain 0/1/2dB）、
  limiter 只开不改参；`PlayerRuntime` 在 `isPlay` 变 true 时对齐 session
  （NO_SESSION 5×600ms 重试，失败一次提示后本进程不再试）；三档纯参数有
  JVM 单测。audioOffload 互斥规则（RN player.ts:251）留给 B5 设置层接线

### B2 语义修正记录（对照 RN 源码实证）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| `playedList` 仅个性电台经 musicToggled 写入临时曲（radio.ts:151）；普通切歌**不写** playedList | handlePlay 不写 playedList；历史回退读 playedList（**写入点已由 Wave4 Lane A 补齐：`PlayerCore.onMusicToggled` 只发事件，`RadioRuntime` 判定「临时曲 + 属电台队列」后写**） |
| `playerPlayIndex` 在 setPlayMusicInfo 时按 getPlayIndex 计算（非播放事件回调） | setPlayMusicInfo 内同步计算（含 playIndex<0 时 playerPlayIndex-1 回退语义） |
| list 模式播完最后一首：playNext 直接 return，**不停播**，当前曲保持 | nextIndex<0 时 return（不 handleToggleStop） |
| addPlayHistory 只写持久化 play_history 存储，与内存 playedList 无关 | 移除二者耦合；持久化播放历史由 B2 后续接入 |
| RSA/AES decrypt 返回**明文串**（非 Base64 回编码） | Crypto 保持同语义（测试期望曾写错，已修） |
| media3 1.11 的 WAKE_MODE 常量在 `C.WAKE_MODE_NONE`（Player 接口已移除，setWakeMode 移至 ExoPlayer.Builder） | javap 实证后使用 C.WAKE_MODE_NONE |
| 刷新 URL 途中若取链本身失败，RN 也直接 5 秒后跳下一首（不会用满两次播放错误重试） | `onLoadFailed` 与播放错误重试分开：取链失败只排「跳下一首」 |
| RN RemotePlay/RemotePause 走 core.play/pause（空播放器会重新取链），不是直接操作播放器 | ForwardingPlayer 覆盖 play()/pause() 转发 PlayerCore |

### 已完成（Wave3 Lane A：三键回读、进度记忆与播控收口，2026-10-26）

- [x] **三键回读**（`app/.../player/PlayerStartupSettings.kt` + `PlayInfoStore.kt`）：
      启动时读 `player.volume` / `player.playbackRate` / `player.isSavePlayTime`，
      首曲音量与倍速立即生效；`PlayerRuntime` 内部用
      `Application.registerActivityLifecycleCallbacks` 跟踪前台 Activity，
      未改 `MainActivity.kt` / `MusicApp.kt`
- [x] **播放进度记忆**（`core/.../player/PlayProgressMemory.kt`）：
      2 秒节流保存（仅播放中 + `isSavePlayTime` + 非临时曲 + 亮屏）+ 切歌无条件保存；
      恢复只在**同列表同索引**成立，`isSavePlayTime` 只决定时间是否还原、`maxTime` 总是还原
- [x] **`isPlayedStop` 收口**：从 `SleepTimer` 局部状态上升为 `PlayerCore` 单一真源；
      `PlaybackCoordinator` 在 paused/ended/loadstart/loadtimeout/failed 与延迟下一首回调前
      检查，手动播放/切歌清零；`SleepTimer` 通过可空 provider 委托（未接 provider 时保留
      本地回退，既有用例不受影响）
- [x] **到点退出收尾**：`PlayerRuntime.shutdown()` 依次 800ms 限时停播 → 关桌面歌词服务 →
      释放音量均衡 → 释放平台 → 停 `PlaybackService` → `finishAndRemoveTask()`；
      `shuttingDown` 防重入，替代原 `exitProcess(0)`
- [x] **flaky 加固**：`loadFailureSchedulesNextTrack` 由「切歌必在 100ms 内完成」改为
      `withTimeout(3s)` 轮询当前曲目 id 的条件等待；8 次隔离 `--rerun-tasks` 未复现，
      阴性对照（`nextDelayMs` 临时改 5s）确定性失败
- [x] **桌面歌词二轮**（冷启动恢复/设置页小节/锁定态实时刷新/`SettingsStore` 小数互通）
      归 B6，见下方 B6 Lane A 小节

### B2 语义修正记录（Wave3 Lane A 对照 RN 源码实证）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| `isPlayedStop` 归属 | 定时到点且「等待播完 + 正在播」时置 `global.lx.isPlayedStop`，不是退出应用；`player.ts:53/123/128`、`playerEvent.ts:54/64/94` 做延迟下一首/取链/加载/错误守卫；`core/init/player/player.ts:19` 暂停时停下、`:25` 播完以 `player__end` 收尾；`player.ts:255/691` 手动播放/切换时清标记 | 标记上升为 `PlayerCore.isPlayedStop`（单一真源）；`PlaybackCoordinator` 在 paused/ended/loadstart/loadtimeout/failed 与延迟下一首回调前检查；`SleepTimer` 可空 provider 委托，未接时保留本地回退 |
| 到点收尾 | `service.ts:25` 的 `handleExitApp` 清标记后走 `core/common.ts exitApp`：收桌面歌词 + 销毁播放器 + 关浮窗 + `utilExitApp` | `PlayerRuntime.shutdown()` 按同一顺序收尾（800ms 限时停播 → 关浮窗 → 释放均衡/平台 → 停服务 → `finishAndRemoveTask`），`shuttingDown` 防重入 |
| 进度记忆保存点 | `playProgress.ts` 两处：2 秒节流（仅播放中 + `isSavePlayTime` + 非临时曲 + 亮屏）与 `musicToggled` 无条件保存（此时进度已归零，仅记曲目） | `PlayProgressMemory` 同判定；节流退化为「距上次不足 2 秒跳过」，最坏晚约 2 秒落盘（注释已记） |
| 进度恢复条件 | 只在同列表同索引成立；`isSavePlayTime` 只决定时间是否还原，`maxTime` 总是还原 | 冷启动 `restorePlayInfo` 校验列表/索引后才恢复，同规则；`index` 明确为列表内索引 |
| 数值回读 | 三键经 JSON 落盘，可能以小数形式出现（如 `72.0`） | `PlayerStartupSettings` 按 Int/Long 读回，首曲立即生效 |
| flaky 时序假设 | RN 无对应轮询用例 | 条件等待 + 3 秒上限；失败重试语义未改（阴性对照证实是时序赌博而非逻辑错） |

### B2 语义修正记录（Wave4 Lane A：播放历史写入方与 `playedList` 唯一写入点）

| 主题 | RN 实证 | Kotlin 落地 |
|:--|:--|:--|
| `playedList` 唯一写入方 | `radio.ts:141-153`：`musicToggled` 里仅当「`isTempPlay` 且属于电台队列」才 `addPlayedList`；普通切歌不写 | `PlayerCore` 只在 `setPlayMusicInfo` 尾部发 `onMusicToggled`（清空音轨不发），**不改状态、不写列表**；`RadioRuntime.onMusicToggled` 判定后写 `playedList`，B2 表「B6 电台接入时补写点」正式关闭 |
| 电台让位停播 | `radio.ts:146-149`：切到「非临时曲且 listId 非空」的列表即 `stopRadio()` | 同一判据在 `RadioRuntime.onMusicToggled` 内，停播会撤队并清掉电台写入的播放历史 |
| 停播清历史 | `radio.ts:88-96` `clearRadioPlayHistory` 只删 `isTempPlay` 且属于电台队列的项 | `RadioRuntime.clearRadioPlayHistory` 同判据，从尾向前删避免索引漂移 |
| `@play_history` 写入方 | `playerEvent.ts` / `playProgress.ts` 在切歌与起播时 `addPlayHistory`（只写持久化存储，与内存 `playedList` 无关） | `PlayerCore` 保留 `onAddPlayHistory` 回调，只在 `handlePlay`/`play` 路径触发；app 侧 `PlayHistoryStore` 落 `@play_history`，与 `playedList` 互不影响 |
| 开播起播 | `radio.ts:187-192` 分 `playNext()` / `playTempPlayList(0)` 两支 | 原生 `playNext()` 在 `tempPlayList` 非空时优先消费队首，两支等价 → 统一走 `playNext()`，仅在临时队列非空时调用 |

### 待办（B2 剩余）

- [x] rn-track-player fork 定制对照（cacheTrack 路径已逐行对照；
      LocalPlayback/MusicManager 的其余定制点见上方平台实现清单）
- [x] 原生模块等价物：cache/（AppCache）、utils/ 的电池优化+通知权限（SystemSettings）
- [x] 音量/倍速/进度状态同步 + 通知栏元数据（含封面）
- [x] 实例接线：PlayerRuntime + PlaybackService
- [x] 取链失败重试（对照 player.ts / playerEvent.ts 的失败计数 + 自动跳下一首）
- [x] 加载超时（RN handleLoadstart 25 秒：同曲第二次超时跳下一首，第一次刷新 URL）
- [x] 原生模块等价物：volumeBalancer/（三档 MBC + limiter；audioOffload 由调用方在
      开启均衡时关掉，对照 player.ts:251）；island/ 归 B6
- [ ] 验收：通知栏播放/暂停/切歌、后台播放存活、缓存清理入口

## B3 音源生态 QuickJS

**状态：进行中（代码项收口，剩真机验收）**（QuickJS 桥、取链链路、更新流全链路 2026-10-24；
自定义源管理页 + 音源日志页 + 设置页补齐由 Wave1 Lane B 于 2026-10-25 完成并并入；
并入后基线 `:core` 384 + `:app` 62 全绿）

### 已完成（B3）

- [x] **QuickJS 引擎桥**（`app/.../userapi/QuickJsEngine.kt`）：RN `QuickJS.java` +
      `JavaScriptThread.java` 的 Kotlin 移植——独立 HandlerThread、preload 注入、
      `__lx_load_seq__`、key 门禁的 `__lx_native_call__`、六个 native 工具
      （base64 双向/MD5/AES/RSA/setTimeout）、`__run_error__` 收尾、换脚本时
      `stopped` 丢弃旧实例事件；引擎来自 `wang.harlon.quickjs:wrapper-android:2.4.0`
      （与 RN 同一个包）
- [x] **preload 原样随包**：`assets/script/user-api-preload.js` 与 RN 同一份，
      沙箱限制（eval/Function 禁用、属性冻结、输入长度上限）全部保留
- [x] **内置源资产化**：`tools/export-builtin-sources.mjs` 从 RN
      `src/config/builtinSources/scripts.ts` 导出 9 个脚本 + `manifest.json`
      （id/名称/版本/更新地址）；脚本零改动，运行在 QuickJS 里
- [x] **原生 HTTP 执行器**（`UserApiHttp.kt`）：对照 RN `init/userApi/request.js`——
      默认 UA/Accept、自定义头、body/form 编码、13s 默认超时、响应 JSON.parse、
      取消/abort、状态码与响应头透传
- [x] **音源运行时**（`UserApiRuntime.kt`）：对照 RN `init/userApi/index.ts` 的音源侧——
      init 事件解析 `sources[source].actions/qualitys`、requestKey→Deferred、
      20s 请求超时、`request/cancelRequest/response/log/showUpdateAlert` 路由、
      默认源 `builtin_xinghai`（与 RN defaultSetting 一致）
- [x] **取链接线**：`PlayerRuntime.urlResolver` 改为走 `userApi.getMusicUrl`；
      `:core` 新增 `PlayQuality`（RN `getPlayQuality` 的 flac24bit→flac→320k→128k
      降级，5 用例）
- [x] **crypto 补丁**：RSA 公钥允许 PEM 换行（对齐 RN Android `Base64.DEFAULT`）
- [x] **更新流纯规则**（`:core/userapi/`，对照 RN `src/core/userApiUpdate` 可测部分）：
      `VersionCompare`（点/横线/下划线混合分隔、`MAX_SAFE_INTEGER`、无法解析返回 null）、
      `UpdateAlerts`（自动更新与弹窗两个开关组合出的 Silent/Toast/Confirm/Tip 决策表）、
      `VerifyLoad`（更新后的验证加载不结算全局 init、失败不弹窗）；
      共 24 个 JVM 用例逐条对齐 RN 的 `user-api-update-*` 测试
- [x] **更新地址调度**（`:core/userapi/UpdateSchedule.kt`，19 用例）：检查频率
      （每次启动/每天/每周/关闭、时间回拨放行）、jsDelivr 三镜像与 GitHub raw→
      jsDelivr 展开、用户地址 > 脚本上报 > 头部地址的优先级、目录备用线路、
      本地源只试脚本地址、名字不匹配地址拉黑；逐条对齐 RN
      `user-api-update-schedule.mts`
- [x] **更新预览编排**（`:core/userapi/UpdateCheck.kt`，12 用例）：多地址顺序尝试、
      确认可升级即停、主地址全失败才走备用线路、`no_update` 归「已最新」、
      只给版本号的网页归「手动打开」、语法闸门注入；逐条对齐 RN
      `previewUserApiUpdateOnce`
- [x] **更新执行层（app 侧）**：
      `UserApiSourceStore.kt`（KvStore 优先、assets 兜底；脚本/备份/头部/用户地址/
      拉黑/待验证/上次检查时间七个键）、`NativeScriptFetcher.kt`（桌面 Chrome UA、
      不取缓存、15s 超时）、`QuickJsSyntaxChecker.kt`（QuickJS 只编译不执行，
      独立线程 + 20s 超时）、`UserApiUpdater.kt`（全入口 Mutex 串行、预览→落盘→
      验证加载→失败回滚、非当前源写 `verifyPending`、启动检查、`showUpdateAlert`
      接两个开关）；`UserApiRuntime.setSource(verify)` 区分验证加载，
      普通加载遇到 `verifyPending` 先回滚再重试一次；`PlayerRuntime` 启动时
      等默认源就绪后跑首次检查
- [x] **内置源清单扩展**：导出器补 `scriptUpdateUrl / legacyUpdateUrls /
      fallbackUpdateUrls / checkUpdateUrls / autoCheck`，manifest 已重新生成

### 已完成（Wave1 Lane B：自定义源管理 + 设置页补齐，2026-10-25）

- [x] **源清单抽象为可写目录**：`core/.../userapi/UserApiCatalog.kt`（新建，纯规则
      24 用例——播种、导入建条目、更新地址编辑与拉黑、下架交接、当前源挑选、
      `MAX_SOURCE_COUNT`/`canImport`）+ `app/.../userapi/UserApiSourceStore.kt`
      （由只读内置清单**重写**为可写目录落盘层，`importScript` 先查数量再验脚本）
      + `UserApiSourceSelector.kt`（当前源解析与回落）+ `BuiltinSources.kt`
      （随包目录接口 `BuiltinSourceCatalog`，脚本正文留在 assets）；
      `list/find/scriptOf` 走同一份数据
- [x] **两条导入路径**：按地址导入（`importFromUrl`）与粘贴脚本导入（`importScript`）；
      换源、更新地址编辑（含拉黑）、删除（正在用的源与随包内置源都不许删）
- [x] **`UserApiRuntime` 扩展**：暴露 `store / updater / sources() / importScript /
      importFromUrl / switchSource / removeSource / logs / clearLogs`；
      `logsEnabled` 门控脚本日志，**进程级、不持久化**（对齐 RN `global.lx.isEnableUserApiLog`）
- [x] **更新设置改读 SettingsStore**：`UserApiUpdater` 的硬编码默认值换成
      `UpdaterSettingsFrom.of(settings.store)`；`apply(id, preview, allowDowngrade)`
      接受 `Older`（只升不降的闸门在设置里可放开）
- [x] **三个页面**：`UserApiManagePage.kt`（新）、`UserApiLogsPage.kt`（新）、
      `SettingsPage.kt`（三组新内容 + 两个子页入口，子页用本地状态整页切换 + 内层
      `BackHandler`）、`SettingsFormat.kt`（新，纯格式化 + 12 用例）——缓存统计与清理、
      电池优化豁免、通知权限、音量与倍速滑杆、记住播放进度、音源更新三键
- [x] **新增用例 core 24 + app 38**：`UserApiCatalogTest`（24）、
      `UserApiSourceStoreTest`（22，含「导入→列表→启停→更新地址」全链路与数量上限）、
      `UpdaterSettingsTest`（4）、`SettingsFormatTest`（12）
- [x] **范围纪律**：`DefaultSetting.kt` **未改**（所需键全部已存在）——与 Lane C 的
      同文件冲突面因此为零

### 已知差异（收尾前确认是否需要补）

- `formData`（multipart）未实现 → **按 Lane B 实证结论定为「不补」**：RN
  `init/userApi/request.js` 那条分支在 RN 自己就跑不通（见下方语义修正表），
  原生保持显式拒绝且错误信息比 RN 的崩溃更明确；Wave2 只有在真实第三方源
  报「需要 multipart」时才实现
- binary 响应给 Base64 字符串（RN 给 Buffer）；内置源取链均为文本响应
- ~~自定义源尚未接入存储/列表~~ → **已由 Wave1 Lane B 接入**（可写目录 + 管理页）
- ~~更新检查的设置暂用 RN defaultSetting 默认值~~ → **已改读 `SettingsStore`**
  （`UpdaterSettingsFrom.of(settings.store)`，设置页三个键即时生效）
- 缓存口径只覆盖 `AppCache`（`cacheDir + externalCacheDir`）：RN 设置页那行是
  「应用缓存 + 播放器音频缓存」相加，清理时还会一并清 musicUrl 缓存并重置权限位。
  界面文案已按实际范围写，没有假装覆盖更大

### B3 语义修正记录（自定义源与设置页，Wave1 Lane B 对照 RN 源码实证）

| RN 实际行为（易误解点） | Kotlin 移植遵循 |
|:--|:--|
| `ImportBtn.tsx` 拦的是 `list.length > 20`，也就是能存到 **21** 个，和它自己那句「最多只能同时存在 20 个源」差一个 | 原生按文案来：`MAX_SOURCE_COUNT = 20`，满 20 拒收；core 与 app 各一条用例锁死 |
| 自定义源没有「停用」开关：`userApi.list` 里存在的源都可被选中，删除走长按确认 | 界面用「使用这个源」+「删除这个源」表达启停；正在用的源与随包内置源都不许删 |
| `global.lx.isEnableUserApiLog` 默认关**且不落盘**，重启回到关 | `UserApiRuntime.logsEnabled` 同为进程级、不持久化；更新检查/回滚这类结论不受开关影响，始终记录 |
| 随包脚本正文在 RN 走 `builtinSources` 常量、导入即写 KV | 原生不复制进 KV（assets 才是正文），因此「下架内置源交接」收紧为 `hasOwnUpdateUrl(info, definitions) && 存储里确有该源自己的脚本` |
| `request.js` 的 `formData` 分支是**坏代码**：置 `Content-Type: multipart/form-data` 后从 `options.form`（此时不存在）取条目，`Object.entries(undefined)` 直接抛错，最终又把对象当 body 交给 fetch | 显式拒绝 `formData`；`form`（x-www-form-urlencoded）与 `body`+JSON 两条真实在用的路径已支持 |
| `sizeFormate` 超过第五档会拼出 `undefined` | `formatCacheSize` 停在 TiB，负数显示 `0 B` |
| 倍速/音量在 RN **不在设置页**，是播放页 SettingPopup 的滑杆 | 任务书点名要求，设置页仍加这两条，但写的是同一批 key（`player.volume`/`player.playbackRate`）——与 Lane C 的播放页面板同源，不会长出第二份事实来源 |

### 待办（B3）

- [ ] 真机验收：2–3 个内置源 init 成功并取到可播直链（需用户配合；
      当前没有列表 UI，可用 B5 前的临时入口或原生日志触发）
- [x] 音源更新流执行层：地址解析、语法闸门、写入存储与失败回滚、
      `updateAlert` 事件接到两个全局开关
- [ ] 真机验收更新流：启动检查、脚本上报新版本、镜像回退、语法闸门拒绝、
      验证失败回滚（看 `UserApiUpdate` 日志与 `userapi.*` 键）
- [x] 自定义源导入/管理（列表、启停、更新地址编辑、日志页）
      → **已由 Wave1 Lane B 完成**（见上方 Lane B 小节）
- [ ] **三键只有写、没有读**：`player.volume`、`player.playbackRate`、
      `player.isSavePlayTime` 设置页会写、也即时调 `PlayerRuntime.setVolume/setRate`，
      但 `PlayerRuntime` 启动时不回读这些值，播放进度记忆也没有消费者
      （补齐点在 `app/.../player/`，Wave2 与 B2/B4 一起收）
- [ ] 真机播放链路：取链 → ExoPlayer 播放/暂停/切歌（依赖上面第一条）

### 续接点（下一会话从这里开始）

**B3 更新流执行层 + 自定义源管理（列表、启停、更新地址编辑、日志页）+ 设置页补齐已完成
（Wave1 Lane B，2026-10-25）。下一步：真机取链与更新流验收 → 推荐内容/在线歌单 → B6。**

1. **真机验收清单**（需要用户配合）：
   - 装 debug APK，触发一次播放/取链，看日志 `UserApi [builtin_xinghai]`
     是否 init 成功、`request` 是否返回 URL；
   - 等启动检查跑完，看 `UserApiUpdate` 日志与 KvStore 的 `userapi.lastCheckAt.*`；
   - 用一个脚本上报 `showUpdateAlert` 的源验证自动更新/弹窗开关组合；
   - 通知栏播放/暂停/切歌、后台存活（锁屏 5 分钟）；
   - 缓存清理入口与 AppCache 数值（设置页已建，入口待接）；
   - 音量均衡：设置页可直接开关与换档，验证轻/中/强三档与释放。
2. ~~**B3 剩余**：自定义源导入属于 B5 设置页…把源清单从 `BuiltinSourceRepository`
   抽象成可写目录，并让 `UserApiSourceStore` 的 `list/find/scriptOf` 走同一份数据。~~
   → **已由 Wave1 Lane B 完成**（`UserApiCatalog` 纯规则 + 可写落盘层 + `UserApiSourceSelector`）。
3. **B5 接线时的两条约束**：
   - 音量均衡开启时 `isEnableAudioOffload` 必须置 false（RN player.ts:251）；
   - `PlayerRuntime.setVolumeBalancer(enabled, level)` / `onVolumeBalancerFailed`
     / `setVolume/setRate` 是设置层的入口。

**验证基线**（每次续接后先跑）：
```bash
cd android-native
gradlew.bat ktlintCheck test assembleDebug   # 当前应为 :core 470 + :app 68 全绿，APK 28,049,076 B
```

**全局待办提醒**：真机装包抽查（B0/B2 验收的硬性项，需用户配合）、
CI 首跑（push dev 后）、release 签名密钥决策（沿用现 keystore 还是新建，B1 前定）。

## B0 工程骨架

**状态：本地构建全绿，待真机验收**（2026-10-24）

### 已完成

- [x] 工具链定版并逐一验证镜像可拉取。**注意：最终版本与初版计划不同**——
      SaltUI 3.0.0-beta03 的传递依赖（haze 2.0.1 / androidx.compose 1.12.1 /
      core 1.19.1）AAR metadata 硬性要求 compileSdk ≥ 37 且 AGP ≥ 9.1.0：
      - Gradle **9.3.1**（原计划 8.14.3，AGP 9 要求）
      - AGP **9.1.1**（原计划 8.13.2；9.1.1 为满足元数据的最低稳定版）
      - Kotlin 2.4.20 + compose 插件 2.4.20（不变）
      - compileSdk **37** / targetSdk 36（原计划 compileSdk 36）
      - android-37.0 平台已装入本机 SDK
- [x] SaltUI 公共 API 一手核实（官方 sources jar）：SaltTheme/SaltConfigs/Button/Text/
      ItemSlider/Switcher/Item 全家族/BasicScreen 签名，骨架页代码一次写对。
      **实证 SaltUI `Slider` 为 internal**，公开入口是 `ItemSlider`。
- [x] `android-native/` 工程落盘：settings（Central 前置 + 镜像兜底）、版本目录、
      app 模块、manifest（竖屏）、资源（自适应图标/主题/strings）、MainActivity、
      MusicApp、NavStack、HomePage、ComponentsPage
- [x] NavStack 9 用例单测全通过（对齐 SaltNavigator 语义）
- [x] AGP 9 内建 Kotlin 适配：移除 `org.jetbrains.kotlin.android` 插件
      （AGP 9.0+ 禁用，内建 Kotlin 支撑），保留 compose 编译器插件
- [x] SaltUI Compose 依赖不传递的适配：app 模块显式声明 androidx.compose
      foundation/ui/runtime 1.12.1
- [x] CI workflow（`.github/workflows/native-build.yml`）：JDK 21，test + ktlintCheck +
      assembleDebug + assembleRelease + artifact，`paths: android-native/**`
- [x] hiddenapibypass 坑落实：`dependenciesInfo.includeInApk/Bundle = false`
- [x] ktlint 接入（`org.jlleitschuh.gradle.ktlint` 12.2.0 + ktlint 1.5.0），
      marker 组名核实为 `org.jlleitschuh.gradle.ktlint`；`ktlintFormat` 已跑
- [x] **本地构建全绿**：`test ktlintCheck assembleDebug assembleRelease`
      - 测试：NavStackTest 9/9 通过
      - debug APK：`app-debug.apk` 16.1 MB
      - release APK：`app-release-unsigned.apk` 12.0 MB（未签名，R8 未启用）

### 待办（本批收尾）

- [ ] 真机装包 + SaltUI 组件渲染抽查（Button/Text/ItemSlider/ItemSwitcher/Switcher/
      BasicScreen + 深浅色联动）——需真机，用户执行
- [ ] CI 首跑绿（push 后自动验证）

### 决策记录（影响后续批次）

| 决策 | 理由 |
|:--|:--|
| AGP 9.1.1 + Gradle 9.3.1 + compileSdk 37 | SaltUI 传递依赖 AAR metadata 硬性要求；AGP 9.1.1 为最低满足版本，减少 API 漂移面 |
| AGP 9 内建 Kotlin，不应用 kotlin-android 插件 | AGP 9.0 起强制；Kotlin 2.4.20 由 SaltUI 对齐要求保持 |
| 不接 `salt-ui-navigation`，自写 NavStack | 其依赖 navigation3 alpha + kotlinx-serialization；NavStack 接口对齐 SaltNavigator，B5 评估换回 |
| applicationId `cn.toside.music.mobile.native` | 与 RN 版双装并存，服务 B7 双通道并行 |
| release 不启 R8、暂不签名 | beta 库混淆规则 B7 补齐；签名密钥待用户决策（沿用现 keystore 或新建） |
| Maven Central 前置的仓库顺序 | SaltUI 根 jar 在阿里云镜像缺失（KMP 元数据包装），Central 必须能兜底 |
| minSdk 26 / targetSdk 36 | 文档 B0 要求 / targetSdk 36 保持与 RN 版一致 |

### B0 构建期实证发现（后续批次必读）

1. AGP 9.0+ 禁用 `org.jetbrains.kotlin.android` 插件（内建 Kotlin/Iskra）。
2. SaltUI 3.0.0-beta03 传递依赖要求 compileSdk ≥ 37、AGP ≥ 9.1.0——评估文档 §五
   “Compose 1.12 + KMP 对 Windows 构建环境要求高”已实证，且比预估更严。
3. SaltUI 的 Compose 依赖（implementation）不向下游传递，直接 import 的库要显式声明。
4. SaltUI `Slider` 是 internal；公开 API 为 `ItemSlider`。
5. 阿里云镜像缺 SaltUI 根 jar，依赖解析必须 Central 前置。

### 下一批（B1 数据与领域层移植）

映射表见评估文档 §七 B1：Redux store → StateFlow/MVI、AsyncStorage → DataStore、
musicSdk → Ktor、theme 表生成器双目标输出。Redux slice 边界 = ViewModel 边界的映射需在 B1 一次性定调。

## Wave 并行机制记录（2026-10-24 深夜会话）

**状态：已中止（用户叫停）；未做任何代码改动，本节是纯流程记录。**

> 2026-10-25 更新：本节建议的「快照 → 切 worktree → lane 自检 → 集成」顺序已在重启的
> Wave1 上执行完毕，**本节的「已中止」只描述 10-24 那次准备，不代表现状**；
> 三车道成果与集成过程见文末「Wave1 集成记录（2026-10-25）」。

- **本会话做了什么**：为 Wave 1 三车道并行（S1 搜索聚合 / S5 设置扩展+自定义源 /
  S10 桌面歌词）做启动准备——写好四份 `docs/waves/` 协作文件（RULES.md 通用规则 +
  w1-A/B/C 三份任务书），跑了两次主仓库基线构建（21:28 一次绿、23:29 一次**失败**），
  搭建期间同时存在另一会话在主仓库推进 B5 第八/九切片。**未创建任何 worktree、
  分支或提交；无代码改动。**
- **教训 1——`gradlew test` 失败≠基线坏**：23:29 的 `BUILD FAILED in 24s` 并非基线
  问题——当时排行榜会话正在主仓库工作区写 `WyWeapi.kt`/`TxLeaderboard.kt`/
  `WyLeaderboard.kt`，构建撞上在途半成品文件。它自己 23:09 的完整跑是
  `:core` 309 + `:app` 19 全绿（测试 XML 与 APK 时间戳 23:09:29/23:09:33 为证）。
  **并行会话共享同一主仓库工作区时，`test` 不可能稳定**——这是同目录并行的
  又一实证（此前仅理论推演），worktree 隔离不是可选项，是硬前提。
- **教训 2——任务书会过期**：w1-A 任务书（S1 搜索聚合）写于排行榜会话开工前，
  几小时后它的第八切片恰好把 S1 做完了。**lane 任务书必须在波前快照提交之后、
  从快照状态重写**，不能提前几天预写后直接用。
- **教训 3——并行前必须做撞文件审计**：本次幸而发现及时（grep SearchRuntime 发现
  五源已接线），否则 Lane A 会话会拿着过期任务书把已有实现重写一遍。
- **后续重启波次时**：① 先确认无其他会话在主仓库工作；② 波前快照提交后重写任务书
  （S1 已完成 → Lane A 改派 S4 B5 收尾）；③ 三份任务书 + RULES.md 已就位，可复用，
  只需按快照状态修订任务段；④ 严格执行「快照 → 切 worktree → lane 会话自检 →
  集成」顺序，lane 会话开工自检里的基线跑在各自 worktree 内进行，不再共享主仓库。
- **对文档的约束**：本节内容并入文档后，`docs/waves/` 下四份文件保留作业参考；
  波次正式重启时按上条修订。

## Wave1 集成记录（2026-10-25）

**结论：三条车道全部按 RULES 走完收尾三步，并按 A→B→C 顺序并入 `main`，闸门全绿，零冲突。**

| 车道 | 任务 | lane 提交 | 各自闸门数 |
|:--|:--|:--|:--|
| Lane A | B5 排行榜 tx/wy/mg 三源收口（S4） | `babefae` 成果 + `2c46991` 报告 | core 334 + app 19 |
| Lane B | B3 自定义源管理页 + 音源日志页 + 设置页补齐（S5） | `79933e8` / `cb5f451` / `a55761a` 成果 + `bccd265` 报告 + `8263fef` 勘正 | core 333 + app 57 |
| Lane C | B4 剩余弹层 S11（更多菜单/定时关闭/倍速音量/歌词设置持久化） | `5f92c82` / `fd638fd` / `3b10547` 成果 + `e7c1fcd` 报告 | core 335 + app 24 |

- **波前快照**：`51f53b6`（三车道的共同 `merge-base`，实测 core 309 + app 19）。
- **合并提交**：`bc04625`（laneA）→ `38f30c4`（laneB）→ `63e4715`（laneC），
  均为 `--no-ff`，保留 lane 历史，未 squash。
- **冲突情况：零。** 三条车道的触碰路径**互不相交**（A 在 `music/leaderboard/` +
  `data/LeaderboardRuntime.kt`，B 在 `userapi/` + `ui/settings/`，C 在 `ui/play/` +
  `core/player/SleepTimer.kt`）；任务书预警的 `DefaultSetting.kt` B/C 双改**没有发生**——
  两条 lane 各自核查后都发现所需键从 RN `defaultSetting.ts` 移植时已全量存在，
  都没动那个文件（Lane B 改为源规则单测，Lane C 改为 `PlaySheetSettingKeysTest` 键契约）。
- **逐条闸门**：并完 A 跑一次（core 334 + app 19）、并完 B 跑一次（core 358 + app 57）、
  并完 C 跑一次；最后一次在 `63e4715` 上用 `--rerun-tasks --no-build-cache` 强制真跑：
  **61 actionable tasks: 61 executed，BUILD SUCCESSFUL in 1m07s**，
  最终 **core 384 + app 62 = 446**，failures/errors/skipped 全 0，ktlint 干净，
  APK `app-debug.apk` **27,602,811 B**。
- **可加性核对**：core `309 + 25(A) + 24(B) + 26(C) = 384`、
  app `19 + 38(B) + 5(C) = 62`——与实测一致，说明合并**没有丢测试、没有互相覆盖**。

### 集成会话的判断

1. 未 push（用户未要求）。
2. RN 侧未提交改动全程未碰：三次合并前后 `git status` 里 RN 路径的改动恒为 **67 项**
   （全在 `src/`、`package.json`、`src/utils/musicSdk/` 等，与合并路径无交集，未 add、
   未 stash、未还原）；`android-native/` 在合并后**完全干净**，说明三条车道的工作
   已全部进入提交。本次文档提交时计数会变成 68，多出的那一项就是这份进度文档本身。
3. Lane A 报告建议「集成会话删掉 `ui/HomePage.kt:341-352` 的『该源的榜单详情暂未接入』
   Toast 分支」——**本次未删**：集成会话不写业务代码，且那条分支删不删都不影响
   功能（`detailSupported` 现恒真）。列为 Wave2 遗留项 3。

### 遗留问题（Wave2 待办，按优先级）

1. **`isPlayedStop` 守卫缺失（最重要，Lane C）**：「等待歌曲播放完毕」只做近似实现。
   RN 的完整链路在 `core/player/player.ts:53/123/128`（挡取链与自动下一首）、
   `core/init/player/player.ts:19/25`（状态变化时 `pause()`）、
   `playerEvent.ts:54/64/94`、`plugins/player/service.ts:134/143`
   （`PlaybackState`/`PlaybackTrackChanged` 时 `handleExitApp`），并在
   `player.ts:255/691` 于用户主动播放时 `isPlayedStop &&= false`。
   → 由播控车道把 `SleepTimer.isPlayedStop` 上升为 PlayerCore 守卫点。
2. **三键只写不读（Lane B）**：`player.volume`、`player.playbackRate`、
   `player.isSavePlayTime` 设置页会写也即时生效，但 `PlayerRuntime` 启动时不回读，
   进度记忆无消费者。与第 1 条同属 `app/.../player/`，建议一起收。
3. **`ui/HomePage.kt:341-352` 死分支（Lane A）**：提示 Toast 与 `detailSupported`
   恒真后的另一分支；若无其他调用方，`LeaderboardRuntime.isDetailSupported` 可一并收掉。
4. **退出实现（Lane C）**：`exitApp()` = `stopPlayback()`（800ms 宽限）+ `exitProcess(0)`。
   真机需确认通知/前台服务随进程一并拆掉；长期应换成 Activity 收尾。
5. **⋮ 的形状要产品拍板（Lane C）**：本波把「播放设置」合进 ⋮，而 RN 的 ⋮ 是歌曲操作、
   设置走头部 slider 图标且只在歌词页出现。移植 `MusicMoreSheet` 时会撞同一入口位置，
   二选一：①本面板改名「播放设置」+ 入口换 slider 图标，⋮ 留给歌曲操作；②维持合并。
6. **RN `LyricSettingSheet` 未收录两项（Lane C）**：`SettingLrcAlign`（歌词对齐）、
   `SettingLyricProgress`（进度显示）——Kotlin 歌词页恒居中、无进度显示。
7. **A-/A+ 与 RN 不同（Lane C）**：committed RN 播放页没有 ±字号按钮（只有滑杆，步进 2
   即 0.2sp）；Kotlin 的是 B4 首版自加，本波已改为直接写设置并夹在 RN 区间 100..300。
8. **RN 侧缺陷登记（不动手）**：`timeoutExit.ts:58` 的 `removeTimeHook` 用
   `splice(indexOf(hook),1)`，传未注册钩子时 indexOf=-1 会**误删最后一个钩子**（Lane C）；
   `ImportBtn.tsx` 的数量闸门比它自己的文案差一（Lane B，已按文案实现）。
9. **mg `getDetailPageUrl` 未移植（Lane A）**：RN 依赖 `webId`，现 boardList 已无该字段
   ⇒ 恒 null；等「在浏览器打开榜单」需求再补。
10. **tx 期号表只在实例内缓存（Lane A）**：进程重启后每个榜多一次 HTML 抓取（RN 同语义）；
    要做「切源秒开榜」再落存储。
11. **wy 服务端接受未证（Lane A）**：本机直连恒返回 200 + 空体，JVM 只证到形状对齐；
    另 wy 侧允许 `size: null` 进 `qualitys`，取链侧会不会因此选不到音质未验（属播控范围）。
12. **`SettingsPage.kt:102` 兜底 `?: false`**（Lane C 发现，文件属 Lane B 范围）：
    RN 默认 `player.isShowLyricTranslation = true`。Lane C 报告记的是 `:60`——那是它自己
    分支上的行号，并入 Lane B 对 `SettingsPage.kt` 的重写后已移到 `:102`。
    当前不触发（store 有默认表），但若日后来源改成可空就会静默变关。
    紧邻的 `isShowLyricRoma` 兜底 `false` 与 RN 默认一致，无需改。

### 真机验收清单汇总（24 条，均需用户在真机执行；JVM 闸门一律测不到）

**排行榜三源（Lane A，5 条）**

1. 发现页 → 排行榜 → 源切「企鹅音乐」→ 点「热歌榜」：列表非空、序号前 3 高亮、
   下滑到 30 条自动拉下一页（tx 一次返回整榜，本地分页应无网络请求也成立）、到底显示「到底啦~」。
2. 源切「网易音乐」→ 点「飙升榜」/「热歌榜」：能出整榜歌曲且歌名/歌手/时长非空
   （这条是 wy weapi 加密链的**唯一实证**；一直转圈或报「获取歌曲详情失败」= 服务端拒绝，
   需回看请求 `params` 与 cookie）。
3. 源切「咪咕音乐」→ 点「新歌榜」：条数应接近 50（RN 同），重复曲目不出现两次，时长显示 `mm:ss`。
4. 三源各点一首歌：进入播放页能起播（走 TEMP 临时列表），队列长度先=当前页条数、
   后台整榜拉全后变长；返回详情页点「播放全部」：从第 1 首起播且队列=整榜。
5. tx 榜在**跨天/跨期**后再点开一次（期号表按天变），验证重新抓 HTML 不报「加载失败」，
   且失败时点「重试」可恢复。

**自定义源与设置页（Lane B，7 条）**

6. 导入一个坏脚本 → 报「无效的自定义源文件」，不进列表。
7. 粘贴几百行脚本 → 可导入，列表显示名称/版本/更新地址。
8. 换源后能正常取链播放（切回内置源也正常）。
9. 检查更新：可升级时弹确认框；失败时回滚并给 Toast，源仍可用。
10. 清理缓存后大小回落到 `0 B`（注意口径只含应用临时缓存）。
11. 电池优化/通知权限跳系统页返回后，设置页标签刷新。
12. 音量与倍速滑杆松手即生效且重启后仍在（受遗留项 2 限制：启动时不回读，
    重进播放页应以设置值为准 —— 这条现在**必然不通过**，是预期缺口）。

**播控弹层（Lane C，12 条）**

13. 播放页头部出现「⋮」，点击从底部升起标题为「播放器设置」的面板；点遮罩能关掉。
14. 定时关闭：输入 `1` → toast「01:00 后停止播放」，面板首行与 ⋮ 里「定时关闭」的副标题
    同步倒计时；输入 `abc` → toast「不要乱输好吧😡」且不启动；输入 `1441` →
    toast「最多只能设置 1440 分钟哦」且不启动；清空后直接确定 → 无任何反应。
15. 倒计时进行中退出播放页、回首页、甚至杀掉播放页，表**不停**（进程级单例）。
16. 「取消定时」→ 倒计时行回到「设置定时停止播放」，到点不再退出。
17. 打开「等待歌曲播放完毕」且正在播放 → 到点**不立刻退**；记录实际退出时机
    （本波近似：下一次曲目/播放态变化才退，可能先切到下一首 —— 见遗留项 1）。
18. 关掉「等待歌曲播放完毕」→ 到点直接退出应用。
19. 待退状态下按「取消退出」→ 不再退出（RN 里用户手动播放也会撤掉待退，本波不会）。
20. 音量滑杆：拖动即时变响度；松手后杀进程重进，音量保持（试 0 / 50 / 100 三点）。
21. 倍速滑杆：0.60x / 1.00x / 2.00x 拖动后歌词跟随速度符合预期；「重置」在非 1x 时回到
    1.00x，已是 1x 时按下去无反应。
22. 歌词字号：拖动滑杆时歌词**不变**、松手才变（对齐 RN）；A-/A+ 每次 ±1sp 并立即生效；
    切页、杀进程重进后保持；脏值（如 9999）夹回 30.0sp。
23. 译文 / 罗马音两个开关：与设置页同名字开关状态一致，切页与重启后保持；
    无译文/无音译的歌曲上开关不报错、歌词行不占位。
24. 面板底部「当前音质 · xxx」与设置页所选音质一致（只读，不可点）。

### 对 Wave2 的机制建议

- **按目录划车道有效**：这次三车道路径零交集，`merge --no-ff` 三次合并全部无冲突通过，
  集成成本几乎为零。继续按目录（而非功能名）划范围。
- **任务书里的「必改文件」要在波前做一次存在性核查**：B、C 两条 lane 都被要求
  往 `DefaultSetting.kt` 追加键，实际全部已存在。波前花两分钟 grep 一遍，
  就能把这类任务换成更有用的形式（两条 lane 自发改成了键契约/规则单测，值得沿用）。
- **lane 报告是集成输入，不是存档**：本节的语义修正、遗留项、真机清单全部来自
  `docs/waves/w1-*.md` 末尾报告；三份工作原文保留，勿删——各自带 15 / 7 / 22 行
  对照 RN 的语义修正表，进度文档里收录的是去重压缩后的子集（B5 13 行、B3 7 行、
  B4 14 行），细节仍以 lane 报告为准。
- **禁触区要显式列出「已知缺口」**：Lane C 因为禁触 `player/` 只能做近似实现，
  并把 RN 守卫行号完整抄进报告——这条做法应在后续波次的任务书里固化为要求。

## Wave2 集成记录（2026-10-25）

**结论：三条车道全部按 RULES 走完收尾三步，按 C→B→A 顺序并入 `main`，逐条跑闸门全绿，零冲突。**

| 车道 | 任务 | lane 提交 | 各自闸门数 |
|:--|:--|:--|:--|
| Lane C | B5 列表排序 9 档 + 自定义排序 | `9ffc40f`（core）/ `a14326d`（UI）/ `832e81e`（差异用例）+ `40a1a96` 报告 | core 400 + app 62 |
| Lane B | B6 桌面歌词浮窗 MVP | `4458f3c` / `ae9ba90` / `1f3f3cc` / `6010420` 成果 + `897152f` 报告 | core 405 + app 62 |
| Lane A | B5 在线歌单五源 + 发现页推荐内容通道 | `7810b43` / `dc737cf` / `0249e1d` 成果 + `d506e34` 报告 | core 433 + app 68 |

- **波前快照**：`c817af7`（Wave1 合并后任务书修订，core 384 + app 62 = 446）。
- **合并提交**：`d25767c`（laneC）→ `5a15cd3`（laneB）→ `3a83b8c`（laneA），
  均为 `--no-ff`，保留 lane 历史，未 squash。
- **逐条闸门**：并完 C `core 400 + app 62 = 462`；并完 B `core 421 + app 62 = 483`；
  并完 A `core 470 + app 68 = **538**`。三次 `ktlintCheck test assembleDebug` 全绿，
  failures/errors/skipped 全 0；最终 APK **28,049,076 B**，
  sha256 `cd39d70a7cc5b8165fa1bbd4c60881a74828f6e4be89cfa37274dd30971c68da`。
- **冲突情况：零，无需修复点。** 三条车道触碰路径互不相交（A 在 `core/.../songlist/` +
  `app/.../data/SonglistRuntime.kt` + `ui/songlist/` + 发现页分支，B 在 `app/.../lyric/` +
  `MoreActionSheet.kt` 一行 + Manifest，C 在 `core/.../list/MusicSort.kt` + `ListDetailPage.kt`）。
  任务书预警的「B 更多菜单行 vs A ui/songlist」未发生交集；`DefaultSetting.kt` 本波
  没有任何车道修改（B 改为 `DesktopLyricSettingKeysTest` 键契约）。
- **可加性核对**：core `384 + 16(C) + 21(B) + 49(A) = 470`、app `62 + 6(A) = 68`，
  与实测一致，无测试丢失或覆盖。
- **集成会话的判断**：
  1. 未写业务代码、未 push（用户未要求）；三次合并后 `android-native/` 工作区干净。
  2. RN 侧未提交改动全程未碰（未 add、未 stash、未还原），`git status` 中的 RN 路径
     改动数量与合并前一致；本次只提交 `docs/`。
  3. 车道报告提到的既有用例 `PlaybackCoordinatorTest.loadFailureSchedulesNextTrack`
     偶发失败（B、C 各自并行负载下各见一次，单跑即过）在本次三次集成闸门中**未复现**；
     该用例属 `core/.../player/`，三条车道均未触碰。留观，若主仓库再复现按 flaky 定位。
  4. Lane A 报告建议的 RN 侧修正（linuxapi NoPadding+Base64、kg 缺 `audio_info` 抛异常、
     `getListDetailLimit` 跳页丢缓存）属 RN 只读参照，**不在集成范围**，已登记到遗留。

### 真机验收清单汇总（Wave2，16 条）

**在线歌单与推荐通道（Lane A，6 条）**

1. 发现→歌单：五源各切一次；排序横滑可点；标签横滑（全部/热门/分组）切换后列表回到第 1 页。
2. 列表滚动到底触发下一页；换源后排序回首档、标签回「全部」；断网显示错误与重试。
3. 点歌单进详情：名称/作者/播放量/简介显示；30 条/页滚动加载；底部出现「到底啦~」。
4. 详情「播放全部」进播放页；队列最终长度等于整单；点第 N 首从该首起播；返回逐级退。
5. 发现→推荐：推荐歌单 6 张、新歌速递 3 首；「换一批」两次应换源/分类；点卡片进详情、
   点新歌起播（临时列表链路）。
6. 竖屏全程；三 tab 详情栈互不干扰（Wave1 行为不回归）；记录每源首屏条数与可播性。

**桌面歌词浮窗（Lane B，7 条，MIUI/HyperOS 优先）**

7. 「更多」里开启 → 跳系统悬浮窗授权页，授权返回后浮窗立即出现；拒绝授权返回后开关回 false 且有提示。
8. 播放/暂停/切歌时歌词按 150ms 提前量逐行切换，无闪烁/重复行。
9. 拖动浮窗到任意位置，松手后杀进程再开、位置保持（整数百分比）。
10. 开启 `isLock` 后浮窗不可触摸、背景透明、Android 12+ 透明度 0.8；关闭后可继续拖动。
11. 关闭开关立即消失，`desktopLyric.enable` 持久化为 false。
12. 息屏/锁屏后音乐继续时浮窗与歌词是否继续刷新；应用退到后台/被清理后的表现。
13. 单行模式 marquee 与多行+翻译显示；小窗/分屏/旋转锁定的竖屏下窗口不越界。

**列表排序（Lane C，3 条）**

14. 排序弹窗 10 项可滚动、选中档位高亮、文案与 RN 一致；排序后列表与随机队列同步。
15. 自定义排序：拖拽手感、松手落库、重进页面顺序保持；与多选互斥（多选态排序灰显）。
16. Collator 边角抽 2-3 例与 RN 比对（「阿 vs b」「é vs e」「a-b vs ab」），
    确认中文/拉丁混排的个别次序差异可接受。

### 遗留问题（Wave3 候选）

> Wave3 已处理：#1 画像重排 → Lane B 的 M1（M2/M3 见 B5 待办）；
> #2 歌单搜索、#3 歌单详情 → Lane C；#7 桌面歌词冷启动/设置页/锁定实时 → Lane A
> （FGS/OEM 保活仍缺）。以下保留 Wave2 时点的原文，便于回溯。

1. **个性化推荐引擎未移植**：电台/探索、画像重排、不感兴趣、onboarding、音频相似；
   立项输入见下一节。本波只做冷启动官方内容通道，未造假数据。
2. **歌单搜索未做**：搜索 tab 的 songlist 类型（RN `core/search/songlist.ts`）。
3. **歌单详情未移植**：RN「添加到我的歌单」「多选」「更多菜单（下载/分享/相似歌曲）」；
   封面图未显示（原生壳暂无联网图片加载器，本波未改 gradle）。
4. **未接的 id/入口**：kw digest-13（专辑歌单）、kw 用户歌单/BD；kg 纯数字/酷狗码、
   用户歌单（infSign）；tx playsquare 与短分享链接；wy 单段 `playlist/<id>` 链接。
   Kotlin `normalizeId` 一律显式抛错（界面显示加载失败），不会请求错误 URL。
5. **列表级菜单缺 5 项**：duplicateMusic / 本地文件 / 同步 / 导入 / 导出；首页列表也缺
   RN 的长按菜单入口。排序「上次档位」目前是页面级记忆（RN 是模块级跨页记忆）。
6. **排序的两个空操作档位**：`add_time_up/down` 与 `play_count` 因无读写者按 0 兜底，
   待 data.ts 等价层落地后自动生效。
7. **桌面歌词后续**：冷启动自动恢复、完整设置页、翻译/罗马音独立开关、锁定态实时切换、
   单行横向滚动、FGS/OEM 保活；`SettingsStore` 的数值类型若要与 RN 小数百分比互通需改造。
8. **既有 flaky**：`PlaybackCoordinatorTest.loadFailureSchedulesNextTrack`（并行负载下偶发，
   本波未触碰该包）；再复现时优先排查时序假设。

## Wave3 集成记录（2026-10-26）

**结论：三条车道全部按 RULES 走完收尾三步，按 A→B→C 顺序并入 `main`，逐条跑闸门全绿，零冲突。**

| 车道 | 任务 | lane 提交 | 各自闸门数 |
|:--|:--|:--|:--|
| Lane A | 播控二轮：三键回读 / 进度记忆 / `isPlayedStop` 收口 / 桌面歌词二轮 / flaky | `7601d5d` / `e57063e` / `ed237bb` 成果 + `74864bf` 报告 | core 488 + app 72 |
| Lane B | B5 推荐画像 M1（纯规则 + 画像装配/持久 + 重排接线） | `564af4d` / `961a0c3` / `c804d4e` 成果 + `23d9d8c` 报告 | core 528 + app 72 |
| Lane C | B5 歌单搜索五源 + 在线歌单详情二轮 | `6045982` / `7a865be` / `6ca9a66` 成果 + `87752c7` 报告 | core 518 + app 76 |

- **波前快照**：`3bad6bc`（Wave2 合并后），main 上还有一笔 `818d408` 任务书快照修订。
- **合并提交**：`e6a31aa`（laneA）→ `ffcbf14`（laneB）→ `8bdb799`（laneC），
  均为 `--no-ff`，保留 lane 历史，未 squash。
- **逐条闸门**：并完 A `core 488 + app 72 = 560`；并完 B `core 528 + app 72 = 600`；
  并完 C `core 558 + app 76 = **634**`。三次 `ktlintCheck test assembleDebug` 全绿，
  failures/errors/skipped 全 0；最终 APK **28,142,274 B**，
  sha256 `09678fe4a4a623ddf1e64402bfd90cdd9510a2087bfcb6fe4a7720e36cbfe6ff`。
- **冲突情况：零，无需修复点。** A 在 `player/`/`lyric/`/`ui/settings/`/`core/setting/`，
  B 在 `core/recommend/` + `data/`（`SonglistRuntime` 的推荐对象）+ 两处只读访问器，
  C 在 `core/music/search/` + `ui/search/` + `ui/songlist/` + `data/SonglistSearchRuntime.kt`，
  三条路径互不相交；B 的 `ListRuntime`/`PlayerRuntime` 只加 `Companion.current()`，
  与 A 的 `PlayerRuntime` 改动在合并时无文本冲突。
- **可加性核对**：core `488 + 40(B) + 30(C) = 558`、app `72 + 4(C) = 76`，
  与实测一致，无测试丢失或覆盖。
- **集成会话的判断**：
  1. 未写业务代码、未 push（用户未要求）；三次合并后 `android-native/` 工作区干净。
  2. RN 侧未提交改动全程未碰（未 add、未 stash、未还原），`git status` 中的 RN 路径
     改动数量与合并前一致；本次只提交 `docs/`。
  3. Wave2 的 flaky `PlaybackCoordinatorTest.loadFailureSchedulesNextTrack` 被 Lane A
     改为条件等待；Wave3 三次闸门中未复现，用例保留、语义未改。
  4. Lane A 的 OEM 保活只调研未实现，结论登记在 `docs/waves/w3-A.md` 任务 5；
     Lane B 的 `@play_history` 无写入方、分词降级，Lane C 的路由缺口/整单导入未移植，
     均已在 B5/B6 待办中改述。

### 真机验收清单汇总（Wave3，20 条，均需用户在真机执行）

**播控与桌面歌词（Lane A，6 条）**

1. 三键回读：设置音量 60% / 倍速 1.25 后杀进程冷启，首曲音量与倍速生效；改回默认再冷启一致。
2. 进度记忆：开 `isSavePlayTime` 播到 1:30 暂停并杀进程 → 重进同列表同曲从 1:30 起；
   关闭开关 → 从 0 起但曲目仍记住；换列表/索引失效 → 不恢复且不崩溃。
3. 桌面歌词冷启动：开关为开且上次在播 → 冷启后浮窗重建、位置/样式正确；关 → 不出现。
4. 设置页桌面歌词小节：宽度/行数/单行/字号/透明度/颜色/对齐逐项修改，浮窗即时生效（不重启服务）；
   与播放页更多菜单开关同源，任一侧修改另一侧同步。
5. 锁定态实时切换：播放中锁屏/解锁切换「锁定」开关，浮窗触摸穿透与透明度立即变化，服务不重启。
6. 定时退出：关「等到歌曲播完」到点 → 界面退出、通知消失、服务停止、无残留进程；
   开且正在播 → 到点只停播不退出，播完自动收尾；到点前手动下一首/切播放 → 取消等待标记，不误退。

**推荐画像 M1（Lane B，7 条）**

7. 收藏某歌手 10 首后进发现页：推荐歌单里该歌手相关卡片前移，卡片集合不变。
8. 新歌速递前 3 首出现收藏/自建歌单里的常听歌手。
9. 有画像时下拉刷新：分类选择随画像关键词变化（风格词分类优先）。
10. 全新安装/清空收藏：两个区块顺序与 Wave2 完全一致（冷启动不过问）。
11. 清空收藏后重启 App：画像回到空、顺序恢复原序（不残留旧画像）。
12. 60s 内反复进出发现页/刷新：不重复读列表，无卡顿（内存缓存生效）。
13. 真机检查 `@xunyin_recommend_state_v2` 有写入且 JSON 可解析（与 RN 同键不互通）。

**歌单搜索与在线歌单详情（Lane C，7 条）**

14. 搜索 tab 切到「歌单」，五源各搜「周杰伦」：名称/作者/播放量/首数正确；
    「全部」按相似度排序并显示来源标签。
15. 关键词不变时来回切「歌曲/歌单」，列表各自正确；切源立即重查；翻页到底显示「到底啦~」。
16. 点歌单行进入详情、返回后仍停在搜索页；详情头图加载，列表行不加载封面。
17. 详情滚动分页；「播放全部」进播放页，队列后台补全为整单。
18. 单曲「加入」：选试听列表/我的收藏/自建歌单；重复提示「该列表已经有这首歌啦」；
    `list.addMusicLocationType` 的 top/bottom 生效。
19. 多选：全选/取消全选/批量加入；部分重复提示「已添加 N 首，跳过 M 首重复」，
    全重复提示「该列表已经有这首歌啦」；「完成」退出多选。
20. 全程竖屏；不出现横屏布局。

## Wave3 推荐立项输入：引擎解耦评估（Wave2 Lane A）

> 本节是 Lane A 报告的独立成节版本，供 Wave3 推荐项目立项直接引用。
> 结论：**内容通道与画像引擎可以分层**——先做「纯规则 + 存储」的画像重排（M1），
> 再接 bandit 全家桶（M2），音频相似与 MMR 最后做（M3）。

- **本波已落地的可解耦通道**：官方分类目录（`getTags`）+ 最热排序挑分类 + 取第一页；
  新歌速递（静态榜单表挑新歌/飙升榜 + 榜单第一页）。两通道只需五源 songList/leaderboard
  接口，不读写画像。
- **Wave 3-M1（~~建议先做~~ 已由 Wave3 Lane B 落地，见下节「M1 落地后的真实边界」）**：
  `tabSections` 的 `rankPlaylistTags / rankPlaylistsByProfile / rankTracksByProfile`
  输入是普通 Map，边界清楚；依赖约 7 个文件：`trackKey`、`artistPrior`、`tokenFeedback`、
  `feedback`（仅 themeNetWeight）、`playlistIndex`、`language`（判定字段）、
  `stateSchema/storage`。先做「推荐歌单/新歌按画像重排」，不接 bandit，仍可用 JVM 单测覆盖。
- **Wave 3-M2（必须连引擎）**：电台/探索 = `bandit + candidate/candidatePool/queue/
  requestPolicy/sessionHealth/listening` 全家桶。
- **Wave 3-M3（最后做，需 native 方案评审）**：音频相似（`audioEmbedding/melSpectrogram/
  nativeAudio`）与 MMR（`diversity/similarity`）。
- **语种配额**（`languageQuota/language`）只影响电台补货，不影响当前内容通道；五源逐曲
  语种字段：kg/tx 有 L1，kw/wy/mg 只能靠分类 L2。
- **数据底线**：本波保持空态、绝不造假；电台卡片、探索卡片、「不感兴趣」、
  onboarding、「更多」分页均未移植（画像重排已由 Wave3 Lane B 的 M1 落地），
  取不到内容时显示失败/空态文案。

### M1 落地后的真实边界（Wave3 Lane B 回填，2026-10-26）

> M1 已按上节建议落地：`core/recommend/` 纯规则 + 画像装配/持久 + 发现页重排接线。
> 本节替代上节「建议先做」的预估，作为 M2/M3 的立项输入。

- **M1 实际覆盖**：推荐歌单排序（歌手先验 + 歌单名/作者关键词亲和度 + 轮次轮换取样）、
  新歌速递排序（同因子）；画像来源 = 收藏 `@list__love` + 用户自建歌单（≤20 张）+
  `@play_history`（解析器就绪、**无写入方**）+ `PlayerCore.playedList`（**仅个性电台**）。
- **M1 已知降级**（不是缺陷，是边界）：
  1. 词面学习按空白切分（RN 用 segmentit 词典），中文无空格歌名基本学不到词面；
  2. 无 `themeWeights` 学习来源 → 分类挑选大多等于原序，只有风格词能命中分类名；
  3. 踩雷/「不感兴趣」隐藏名单无原生入口与写入方 → 以空规则调用；
  4. 画像存储形状与 RN 不同（同键不互解析），冷启动/解析失败回空画像；
  5. 随机源用轮次轮换（可复现），未接真随机。
- **M2 必须补齐的前置**：`@play_history` 原生写入方（播放事件落盘）；`themeWeights` 与
  显式反馈结算（`applyThemeFeedback`）；踩雷/dislike provider；隐藏歌单 UI；
  `rankState` 的 `blocked/hidden` 参数已预留、接上即生效；bandit +
  candidate/candidatePool/queue/requestPolicy/sessionHealth/listening 全家桶驱动电台/探索。
- **M3 前置**：音频相似（`audioEmbedding`/`melSpectrogram`/`nativeAudio`）需 native 方案
  评审；MMR（`diversity`/`similarity`）在其后。
- **数据工程**：词典分词或自建停用词/后缀切分（中文无空格歌名）；若 M2 引入逐笔画像结算，
  需补 RN 的 1500ms 存储防抖（当前是 60s 画像内存 TTL，读多写少）。

## Wave4 集成记录（2026-10-26）

**结论：三条车道按 RULES 走完收尾三步，按 C→B→A 顺序并入 `main`（长尾先进、M2 最重最后），零冲突。**

| 车道 | 任务 | lane 提交 | 各自闸门数 |
|:--|:--|:--|:--|
| Lane C | B5 第十四切片 歌单长尾（去重 / SAF lxmc 导入导出 / 整单导入为新歌单 / 链接打开 / 封面磁盘缓存） | `ef4fd9b` / `1097d40` / `bf3f6cd` / `f0de3b1` / `f589887` 成果 + `8dca524` 报告 | core 578 + app 76 |
| Lane B | B4 分享卡 S14（core 决策 + Canvas 主动重绘 + MediaStore 保存） | `b59057e` / `267bb12` / `661cb9f` 成果 + `152493f` 报告 | core 619 + app 76 |
| Lane A | B5 第十五切片 个性电台 M2（bandit 全家桶 + 候选池/队列/选曲/安全模式 + 喜欢/不感兴趣闭环） | `3ed26f7` / `a1b6ec2` / `9d7e23d` / `265faed` 成果 + `ccc77b2` 报告 | core 661 + app 76 |

- **波前快照**：`dafb79e`（Wave3 合并后 + 任务书快照修订），三条车道从同一快照分叉，未互相 rebase。
- **合并提交**：`b29117f`（laneC）→ `92475db`（laneB）→ `f214bd8`（laneA），均 `--no-ff`，
  保留 lane 历史、未 squash。本会话接手时 C、B 已按序并入（前段会话产物），复核基线与逐条闸门后合 A。
- **逐条闸门**：C+B 基线 `ktlintCheck test assembleDebug` 仍绿；并入 A 后
  `core 742 + app 76 = 818` 全绿，failures/errors/skipped 全 0；APK **28,860,935 B**，
  sha256 `b6fc737667d805d4306ff0c006afba1b47feb790c8aa7344a3c4418ed56cc837`。
- **冲突情况：零，无需修复点。** 唯一理论交叉点——Lane C 改 `CoverImageLoader` 公开 API、
  Lane B 按旧签名调用——实际是 **C 只新增 `init(context)`**，`object`/`load(rawUrl: String?)`/
  `CoverArt` 全部未变，未调用 `init` 时退化为原行为，**无需在 C 侧补兼容重载，也未动 B 的业务代码**。
  其余路径：C 在 `core/list` + `core/songlist` + `ui/list` + `ui/songlist` + `CoverImageLoader`，
  B 在 `core/share` + `ui/share` + `MoreActionSheet`，A 在 `core/recommend/radio` + `player/` +
  `data/Radio*` + `HomePage`/`HomeNavigator`，三条互不相交。
- **播控语义复核（以 B2 语义修正表为判据）**：合并后 `PlayerCore.setPlayMusicInfo` 仍**不写**
  `playedList`、也**不写** `@play_history`，只在尾部多发出一发 `onMusicToggled` 事件
  （清空音轨不发）；写入由订阅方 `RadioRuntime` 判定「临时曲 + 属电台队列」后执行。
  历史回退读 `playedList` 的语义未被带红；`player` 包 88 条用例单独复跑全绿。
- **可加性核对**：core `634 + 20(C) + 61(B) + 103(A) = 818`、app `76` 未变，
  与实测 `742 + 76` 一致，无测试丢失或互相覆盖。
- **集成会话的判断**：
  1. 未写业务功能代码、未 push（用户未要求）；三条合并后 `android-native/` 工作区干净。
  2. **RN 侧未提交改动全程未碰**（未 add / 未 stash / 未还原），`git status` 中 RN 路径条目与
     合并前一致（27 改 + 30 未跟踪）；本次只提交 `docs/`。
  3. Lane A 的 OEM 保活按复核结论**不实现**，Manifest 未改动（方向属性自然未动），决议登记在 B6 待办。
  4. 三条 lane 的「语义修正」已并入对应批次表格：B2（Wave4 Lane A 电台写入点）、
     B4（Wave4 Lane B 分享卡）、B5（Wave4 Lane C 歌单长尾、Wave4 Lane A 电台 M2）。
  5. 遗留逐条勾销/改述：列表级菜单 5 项（去重/导入/导出完成，本地文件与同步只出评估结论）、
     歌单详情「整单导入」拍板（完成）、封面链路（磁盘缓存完成）、分享卡新增 4 条、
     onboarding 与「更多」分页、首页长按菜单、deeplink、`share.*` 设置键、OEM 决议。

### 真机验收清单汇总（Wave4，27 条，均需用户在真机执行）

**个性电台 M2（Lane A，9 条）**

1. 发现 → 推荐 →「个性电台」卡片 → 电台页，「开始电台」10 秒内起播。
2. 连播 5 首后「接下来」列表非空，补位曲排在用户手动「稍后播放」的歌**之后**。
3. 点「不感兴趣」→ 当前曲立刻跳下一首；重进电台该曲不再出现。
4. 重启进程后「不感兴趣」仍生效（`@dislike_list` 与 RN 同键同格式，可与 RN 版互读验证）。
5. 点「喜欢」后下一批候选里同歌手/同歌单占比上升（画像补池生效）。
6. 连续 2 首 20 秒内切歌 → 状态卡出现「安全模式」，队列里同歌手曲被撤下。
7. 电台播放中手动进歌单点歌 → 电台自动停播，临时队列里电台补位曲被清掉。
8. 后台播放（锁屏/切后台 10 分钟）电台继续自动补位；通知栏切歌后仍能续播。
9. 音量均衡开启时音量正常（`isEnableAudioOffload` 互斥约束未被接线碰丢）。

**分享卡（Lane B，9 条）**

10. 深/浅色模式各开一次：卡底黑/白、文字对比正常；切系统深色后重开生效。
11. 音乐卡：封面圆角 + 1px 边界线、歌名 ≤3 行、歌手 ≤2 行、品牌行不越卡。
12. 歌词卡：字号从设置档下探到 14 地板、截断出现「…」、分隔线 35% 不抢眼。
13. 五档比例逐档切：卡整体等比缩放、卡内比例不变、预览不拉伸。
14. 保存后相册 `Pictures/寻音` 出现图片，像素与预览一致（全屏档 = 屏宽 px）。
15. 同名连存 → `歌名 - 歌手.png` / `歌名 - 歌手 (1).png`；含 `/ : * ? " < > |` 的歌名被清理；中英混排正常。
16. 断网/无封面：仍能生成并保存（纯色底、封面框只剩边界线）。
17. 生成中/保存中：关闭与返回键无效；完成弹「已保存：x.png」。
18. release 包按像素验证：品牌字形仍在卡上、字体未被资源收缩破坏；26–28 设备出现版本提示而不崩。

**歌单长尾（Lane C，9 条）**

19. 导出：安卓 13/14/16 各一次，选同名文件确认系统生成 `(1)` 且原文件不被覆盖。
20. 单列表导入冲突：覆盖 → 本地名保留、歌曲被替换；取消 → 新建 `id__<ts>` 副本，原列表不动（含 default/love）；无冲突 → 直接新建。
21. 整表备份导入：二次确认文案、导入后当前页刷新、当前列表已不存在时的返回。
22. `.json`（明文）与 `.lxmc`（gzip）两种文件，错误/不支持文件提示。
23. 在线歌单「导入为新歌单」：整单顺序、同源同单再次点击提示已存在、返回「我的」可见并可播放。
24. 歌单链接粘贴：五源各一条合法链接/id、错误链接提示、kw 跨域链接 + 手选来源、wy `###token`。
25. 封面：断网首开显示占位不崩、联网后恢复、清空 `cacheDir/cover_images` 后恢复、写坏缓存文件后自愈。
26. 去重弹层：分组排序、勾选移除确认、单条移除、空列表文案。
27. 操作行横滑：小屏下 9 项可滑到「导出」。

**累计：Wave1 24 + Wave2 16 + Wave3 20 + Wave4 27 = 87 条。JVM 闸门全绿 ≠ 可发版，
建议此刻安排一次真机清账（优先：电台全流程、分享卡像素级、SAF 导入导出）。**

### M2 落地后的真实边界（Wave4 Lane A 回填，2026-10-26）

> M2 已按上节建议落地：`core/recommend/radio/` 21 文件 + 103 用例 + app 侧
> `RadioRuntime`/`StateStore`/`DislikeStore` + 电台页。本节替代上节「M2 必须补齐的前置」
> 的预估，作为 M3 与后续数据工程的立项输入。

- **M2 实际覆盖**：bandit（Thompson 采样，RNG 注入可锁种子）、候选池（合并/补池/冷却）、
  选曲（通道配额/探索间隔/去重）、队列（pending/committed + 临时队列重排）、
  踩雷过滤、收听区间与结算、安全模式（连切撤同歌手）、状态持久化（1500ms 防抖）；
  `@play_history` 原生写入方就绪（`PlayHistoryStore`），`playedList` 唯一写入点接上；
  喜欢/不感兴趣闭环（`@dislike_list` 与 RN 同键同格式）。
- **M2 已知降级**（边界，非缺陷，逐条对应上节预估）：
  1. **`themeWeights` 与显式反馈结算未做**：`RadioPool` 的画像亲和度用「种子重合归一 +
     弱主题加成」，不是 `similarity.ts`；
  2. **探索通道 C 无候选来源**（依赖 M3 的相似度/语种），配额按 `Channels` fallback 让给 A/B/D；
  3. **候选抓取三路**（画像歌手 A / 榜单 D/A / 推荐歌单 B），相似歌手 E 与种子搜索属 M3；
     `RadioRequestPolicy` 的超时/退避未包装进抓取（纯函数保留为接入点）；
  4. **选曲无同作品软降频 / 分类轮换 / 语种硬配额**，`RadioModels` 无 `langHint`；
  5. **`importedOrigins` 恒空**：缺「本地收藏来自哪个网络歌单」的映射，导入归因不生效；
  6. **隐藏歌单 UI 未做**；`rankState` 的 `blocked/hidden` 参数仍预留未消费；
  7. onboarding、「更多」分页未做（电台页只展示 6 首队列预览）。
- **M3 立项输入**（未变）：音频相似需 native 方案评审；数据工程仍需词典分词/后缀切分，
  且 M2 已引入逐笔结算，若画像也要逐笔落盘则需补 1500ms 防抖（电台状态侧已实现，画像侧未做）。

## Wave5 集成记录（2026-10-26）

**结论：三条车道按 RULES 走完收尾三步，按 B → C → A 顺序并入 `main`（本地曲库先进、
推荐 M3 最重最后），零冲突；三条车道各自看不见的跨车道装配点由本会话补齐。**

| 车道 | 任务 | lane 提交 | 各自闸门数 |
|:--|:--|:--|:--|
| Lane B | B5 第十六切片 S17 本地曲库（SAF 目录树 + 标签/内嵌封面 + `source=local` 直连取链 + 同名 `.lrc` + 列表第 8 项） | `65e277b` / `40159e4` / `e3a25a3` + 报告 | core 775 + app 83 |
| Lane C | 首页长按九项菜单 + `lxmusic://` deeplink + 分享卡系统分享（另出「播放页 morph」「搜索歌手/专辑」两份评估） | `3de6f02` / `bcc5e58` / `9fce559` / `26a1e21` + 报告 | core 742 + app 99 |
| Lane A | B5 第十七切片 推荐 M3（语种四级判定与配额 / 问卷播种 / 相似度与 MMR / 时段权重 / 通道 E 相似歌手 / 探索通道 C 接货 / 音频特征代价评估） | `8f4e2d0`…`193e430` + `e9f1194` 报告 | core 850 + app 76 |

- **波前快照**：`de836cd`（只改 `docs/waves/w5-prompts.md`，与三条车道零交集），三条车道从同一
  快照分叉，未互相 rebase。
- **合并提交**：`8e981aa`（laneB）→ `ada033c`（laneC）→ `66a15d7`（laneA），均 `--no-ff`，
  保留 lane 历史、未 squash。**每并入一条跑一次 `ktlintCheck test assembleDebug`，三条并完再跑一次。**
- **合并后闸门**：`core 883 + app 106 = 989` 全绿，failures/errors/skipped 全 0；
  APK **28,925,062 B**（波前 28,860,935 B，+64,127 B）。
- **可加性核对**：core `742 + 33(B) + 0(C) + 108(A) = 883`，app `76 + 7(B) + 23(C) + 0(A) = 106`，
  与实测一致，无测试丢失或互相覆盖。
- **冲突情况：零，无需修复点。** 三条车道的路径几乎不相交，唯一理论交叉是
  `ui/list/`（C 加长按菜单与 `ListMenuActions`、B 改列表详情页操作行）与
  `util/SafDocuments.kt`（C 未碰、B 纯新增 API），实际都是**新增文件/新增函数**，无同一行改写。
  `HomePage.kt` 由 C 独占（长按手势与菜单宿主挂载），B/A 未碰，合并后长按链路完整。
- **跨车道装配补做（本会话，`a4f714b`）**：Lane C 报告遗留 2 是「任务书层面留给集成会话的必做项」，
  车道内不可能完成（B 的代码在 C 的 worktree 里不可见）：
  1. `LocalFileImport.importTo = LocalMusicRuntime::importTo` —— 不赋值则首页长按菜单的
     「添加本地歌曲」永久置灰（菜单项可用性就是 `importTo != null`）。
  2. `HomePage` 常驻注册 `OpenDocumentTree` 选择器并立刻持久化授权，同时挂
     `LocalFileImportDialog`（此前首页触发的导入没有任何可看的进度层）。
  3. `LocalMusicRuntime` 的目录选择器宿主由**单槽改为栈**：单槽下列表详情页 `onDispose`
     会把首页常驻的那一份一起清掉——「进过一次列表详情页，首页入口就永久置灰」。
     栈实现后「后注册优先、退场只弹自己那层」，新增 `LocalMusicPickerStackTest` 5 例锁住语义。
  → 补做后最终基线：`core 883 + app 111 = 994` 全绿，APK **28,925,062 B**，
  sha256 `0103f7832c69096ccb35001a6d4b7e4ed7060bff0ba02f7e14de2116158ecf92`（core 与 APK 体积未变）。
- **集成会话的判断**：
  1. 未 push（用户未要求）；除上述装配与本文档外没有改业务代码。
  2. **RN 侧未提交改动全程未碰**（未 add / 未 stash / 未还原），`git status` 中 RN 路径条目
     与合并前一致；本次只提交 `android-native/`（装配 3 文件）与 `docs/`。
  3. 三条 lane 的「语义修正」已并入对应批次表格：B5（Wave5 Lane A 推荐 M3、Wave5 Lane B 本地曲库、
     Wave5 Lane C 首页菜单/deeplink）、B4（Wave5 Lane C 分享卡系统分享）。
  4. 遗留逐条勾销/改述：Wave4 遗留里的「首页长按菜单」「deeplink」「onboarding」「本地文件」全部关闭；
     「同步（更新）」「更多分页」仍挂着并已写明依赖。
  5. Lane A 的两项**未接线**（`Diversity.select` 未替换 M2 选曲器、候选 `lang` 字段供给不足）
     按报告原样登记为 W5-1，**不当作已完成**——这是本波最重要的诚实边界。

### Wave5 三条车道的语义修正要点

> 全表（B 8 条 / C 11 条 / A 4 条）在各自 lane 报告里，这里只留会影响后续开发的。

**Lane B（本地曲库）**

- **`id` 载体换人**：RN `id = file.path`；SAF 无路径 → `id = meta.filePath = meta.songId = document URI`。
  去重/覆盖/失败移除全部沿用同一键，语义等价；**换设备/重装后旧 id 失效**（同 RN 换机后旧路径失效），
  已记 W5-7。
- **越界说明（唯一一条，已报备）**：`Media3PlayerPlatform` 的 `DataSource.Factory` 上游原为
  `DefaultHttpDataSource`，`content://` 交给它会直接抛 `Unsupported scheme`，本地曲**根本播不了**。
  改为按 scheme 分流的 `SchemeRoutingDataSourceFactory`：http(s) 保持「缓存 + UA/超时/重定向」原样，
  其余走 `DefaultDataSource`；本地文件**不进磁盘缓存**（不会把本地曲库复制进 1 GB 的 TrackPlayer 缓存）。
- **mime 缺失**：SAF 的 `getType()` 常返回 `application/octet-stream`/null → 退回扩展名白名单；
  但 mime **明确**说了不是音频（如 `video/mp4`）就尊重它、不收。
- **空标题**：RN 空名会被 `filterMusicList` 丢掉（表现为「导入后歌凭空消失」）→ 原生退回文件名 stem，用例锁死。

**Lane C（菜单 / deeplink / 分享）**

- **菜单项文案按 i18n**：`list_select_local_file` = 「添加本地歌曲」、`list_sync` = 「更新」
  （起草稿写的「本地文件」「同步」是错的）。
- **`local_file` 的开关是导入进行中**（`fetchingListStatus[id]`），与列表身份无关；
  起草稿「非用户列表禁本地文件」被实证推翻。
- **deeplink `paths[1]` 是 url 不是 id**；query 解析 `const [key, value] = param.split('=')`
  会在**第二个 `=`** 处截断；`decodeURIComponent` **不**把 `+` 当空格而 `URLDecoder` 会
  （先把 `+` 转义成 `%2B`）。三条都逐位照抄并写进 `DeeplinkParserTest`。
- **`common.shareType` 不管分享卡**：`system|clipboard` 只管文字分享；分享卡是「保存」「分享」
  两个独立按钮，分享无条件 `shareImage`。故分享按钮直接 `ACTION_SEND`，`shareType` 仍是死键（W5-9）。
- **Compose 手势**：外层 `combinedClickable` 会被 `Item` 自带的 `clickable` 先消费（Main pass 内→外），
  长按永不触发 → 自定义 `onListLongPress` 在 **Initial 阶段**观察、正常路径零消费、只有长按成立才吞后续事件。

**Lane A（推荐 M3）**

- **两处起草假设被实证推翻**：① `like/dislike/early_skip` **早已**进 `ThemeFeedback`
  （`RadioBehavior.applySettlementResult`），A/E 通道不进主题净权与 RN 一致，不是缺陷 →
  任务 7 改为只做 hidden/blocked 写入方 + 问卷播种闭环；② `Channels.plan` 的 A7/B5/C4/D2/E2
  与缺货让位 **M2 就是真实分配**，C 的问题是 `availability[C] = 0` 而不是分配算术 →
  任务 8 改为「给 C 接货」，分配算术一行未动。
- **`windowSlice` 的 `slice(-0)` 坑**：JS 取整个数组；Kotlin `takeLast(0)` 本就为空，但负数会抛，显式夹紧。
- **腾讯（tx）数字码表坑**：`Number('') === 0` → 空串必须拦在码表前，否则空字段被判成「粤语」。
- **播种幂等**：`RadioState.onboardingSeeded` 记录已播分量，重答先 revoke 再 apply；
  同一份答案重放两次净变化为零，启动时无条件补播安全（`applyingSameAnswersTwiceIsIdempotent`）。
- **通道 E 不占取曲延迟**：一轮 MB/LB 刷新至少两位数秒 → 后台单飞刷新 + `drainBuffered()` 取货
  （返回 0 requests）。**代价：首批队列没有 E**（W5-3）。
- **一个真机对照点**：选择器「近 8 首同歌手不重复」→ 同歌手集中于一个池子时第 5 首就
  `quota_exhausted`。**队列短不一定是候选少，可能是画像歌手里集中度太高**（M2 既有语义，本波未动）。

### Wave5 遗留清单（合并去重，Wave6 输入）

| # | 遗留 | 来源 | 影响 / 建议 |
|:--:|:--|:--|:--|
| W5-1 | **`Diversity.select` 未替换 `RadioSelection.select`；候选 `lang` 字段供给不足** | A 降级 1/2 | MMR / 同作品软降频 / 分类轮换 / **语种硬配额在真机均未生效**（只有问卷播种与语种补货真跑了）。**Wave6 最高优先级**，需同时迁 M2 的 12 个选曲用例 |
| W5-2 | 供给层三缺：`bucketFromLyric` 无调用方、会话共现 SAR 未移植、`computeBucketDetailReserve`/`computePoolBucketLimits` 只移植不接线 | A 降级 6/7/10 | L3 只靠逐曲字段与 MB 关系链；`coOccurrence` 恒 0。需「候选后台拉歌词」通道与跨歌单倒排索引 |
| W5-3 | 通道 E 是渐进供货（首批队列无 E） | A 降级 3 | 要求首屏有 E 就把首次 refresh 提前到 `start()` 之前（+2–3 s）或用上一会话缓存兜底 |
| W5-4 | C 的「相似曲（音频/共现）」来源未做；`Discovery` 调用处成新率固定 1.0（RN 0.3） | A 降级 4/5 | 撞新只有「语种补货 + 新鲜歌单」两路；成新率需真机数据后回调 |
| W5-5 | **音频特征零代码**（只出评估） | A 任务 9 | 建议 Wave6 先做路线 A（纯谱特征 FFT，3-4 人日、**零包体积**）验证「音频信号有没有用」；路线 B（mel + TFLite）一次到位但要 +4.2–4.5 MB 与模型许可复核 |
| W5-6 | 问卷 UI 是四档档位（无 material Slider） | A 降级 9 | 颗粒度 0/50/70/100；换滑条只改 `OnboardingSheet.kt`，持久化与算法不动 |
| W5-7 | 本地曲目**没有重定位入口**，备份/导出会带上 `content://` | B 遗留 6 | 换设备/重装后这些曲目无法播放（RN 同样没有）。建议做「本地曲目重扫/重定位」或导出时剥离 local 曲目 |
| W5-8 | RN 的在线兜底未做（`getMusicUrl`/`getPicUrl`/`getLyricInfo` 失败后按同名同歌手去在线搜） | B 遗留 1/2 | 与「相似歌曲 / 标签补全」一起做，要复用五源搜索与画像；内嵌歌词（ID3 USLT / MP4）需自写解析器 |
| W5-9 | `ListMenuActions` 与 `ListDetailPage` 的导入/导出/排序逻辑重复 | C 遗留 1 | Wave6 抽 `ui/list/ListFileActions.kt` 两处都调 |
| W5-10 | 同步（更新）未移植；`music/searchPlay`、`.js` 音源导入、音频文件打开未做；`.lxmc` 无标准 MIME | C 遗留 3/4/5 | 同步依赖各源 `songList` 能力与 `sourceListId`（字段已有、无消费方）；`.lxmc` 要自定义 MIME，与 B7 一起做 |
| W5-11 | 分享图片先落相册再分享（无 FileProvider） | C 遗留 6 | 接 FileProvider 后可改「先写 cache 再分享、相册只在点保存时写」 |
| W5-12 | `common.shareType` 仍是死键；排序档位 `add_time`/`play_count` 无写入方 | C 遗留 7/8 | 文字分享入口落地后再补设置项；两个排序档位取值恒 0（W4 已记，未恶化） |
| W5-13 | 本地曲目会进推荐画像；`importedOrigins` 恒空 | B 遗留 5 / A 降级 8 | 大批本地导入会影响 `themeWeights`；若要过滤需在画像装配里按 `source == "local"` 处理（Wave6 定产品口径） |
| W5-14 | 播放页 morph 转场未做（缺 `compose.animation` 依赖 + `RetainedContent` 只 measure 可见页的结构障碍） | C 任务 4 | 先动 gradle，Wave6 与「更多分页」一起做，先验证「播放条→播放页」单元素 |
| W5-15 | 搜索「歌手 / 专辑」两类未做（10 个解析器 + 2 套编排 + 2 张详情页） | C 任务 5 | 独立 M 级任务，建议 Wave6 单开车道，只碰 `core/music/search/` 与 `ui/search/` |
| W5-16 | 本地曲库单层扫描、节流未用真实定时器（按批落库） | B 语义修正 5 / 遗留 3 | 递归扫描是产品决策（会改变「这一层」的含义），随「多目录合并」一起定 |
| W5-17 | 菜单 `Item(enabled = false)` 的置灰对比度未在真机确认 | C 遗留 9 | 与真机清单第 19 项（置灰条件）一起看 |

### 真机验收清单汇总（Wave5，39 条，均需用户在真机执行）

**本地曲库（Lane B，11 条）**

1. 含 mp3/flac/ogg/wav + 1 个 txt + 1 个 jpg 的目录 → 只收 4 个音频，弹层进度到结束。
2. 重启后**不重新选目录**直接播本地曲 → 能播（持久授权生效）；提示「无法访问」即为授权未持久化缺陷。
3. 标签齐全的曲目字段正确；**删掉标签**的曲目歌名=文件名、歌手空、**不丢歌**。
4. 有内嵌封面显示、无内嵌封面显示占位且不崩。
5. 同目录 `song.lrc` 有歌词；删掉 lrc 后无歌词、不崩不卡。
6. 拔卡/删文件后播放 → toast「本地文件无法访问…」，不崩。
7. 拖进度条、后台 10 分钟、通知栏切歌：本地曲全部正常（content URI 要支持 seek）。
8. 1000 首目录：耗时可接受、进度在动、点「取消」能停（已入库占位曲保留）。
9. 导入中菜单项灰；导入完可再来一次，**同目录重复导入不产生重复曲目**。
10. 空目录 → 「没有在当前文件夹中发现歌曲」。
11. 音量均衡开启时播本地曲音量正常（`isEnableAudioOffload` 互斥未丢）。

**首页菜单 / deeplink / 分享（Lane C，12 条）**

12. `adb shell am start -d "lxmusic://songlist/play/kw/<id>"` 冷启动直达歌单详情，返回落在发现页。
13. 前台时同命令走 `onNewIntent`，`dumpsys` 里 `MainActivity` 只有一个实例。
14. `player/togglePlay`、`pause`、`skipNext`、`skipPrev` 各一次有效。
15. `player/collect` → 收藏多一首；`uncollect` → 少一首。
16. `music/play?data=…`：正在播立刻切换；停播只入队（与 RN 一致）。
17. 非法链接 → toast「调用失败：Source no match」。
18. 长按试听列表/我的收藏/自建列表各一次 → 九项菜单；**普通点击仍进详情页**（手势没抢点击）。
19. 置灰：试听/收藏的「重命名」「删除」；导入中的「添加本地歌曲」「更新」。
20. 菜单功能：重命名 / 排序（含自定义排序跳详情）/ 重复歌曲 / **添加本地歌曲（本次装配后应可用）** /
    导入（.lxmc 走冲突两按钮）/ 导出（同名自动改号）/ 删除（活动列表回落试听列表）。
21. 分享卡「分享图片」→ 微信图片能预览；「保存图片」仍进相册。
22. 分享后杀进程重进 → 图仍在（MediaStore `IS_PENDING=0`）。
23. 全程竖屏（长短按、菜单、chooser 旋转都不出现横屏）。

**推荐 M3（Lane A，16 条）**

24. 连续 30 首「陌生曲」占比：波前 vs 波后，分「有问卷表态 / 无表态」两组。
25. `getSummary().channelShare` 里 C 与 E 是否都非 0（E 需播够 2-3 分钟）。
26. 问卷设「华语 100%」→ 华语占比上升；改「0%」→ 下降且**旧正权被撤**（不是叠负权）。
27. `RadioMode.EXPLORE` 下 C 的占比明显高于电台模式。
28. 推荐页顶部卡片文案：未答「先花 30 秒设置偏好」→ 答完「偏好已设置 / 修改」。
29. 全部选「无所谓」→ 提示「等于没表态」且不落库。
30. 杀进程重进：档位回填正确，语种分布**不出现播种叠加**（`onboardingSeeded` 幂等的真机验证）。
31. 长按推荐歌单 → 该歌单**立刻**消失（不是刷新才消失），提示文案出现。
32. 电台页「已隐藏的歌单 N」能列名字、单条恢复，恢复后推荐页重新出现。
33. 杀进程重进 → 隐藏记录仍在。
34. 飞行模式开电台：不弹错、不卡住，`reasons` 里能看到 `similar_artist:*`。
35. 抓包确认 MB/LB 请求间隔 ≥ 1 s 且带 UA（无 UA 会 403）。
36. 播 5 分钟后 `xunyin_recommend_similar_artist_v1` 生成且 `byArtist` 有条目；
    `xunyin_recommend_artist_lang_v1` 出现 relation 强度条目。
37. 日志 `reasons` 关键串：`similar_artist:empty` / `similar_artist:<N>` /
    `discovery_restock:<语种>:<N>` / `discovery_playlist:<id>:newest:<N>` / `discovery_restock:no_language_preference`。
38. 开播到首曲耗时不超过波前基线 +10%（E 是后台刷新，变慢说明 `kick` 抢了主线程）。
39. 额外回归（因 B 改了播放器数据源工厂）：在线曲**取链 → 播放 → 缓存命中**，
    以及电台自动补位两条链路（B 报告「集成时重点回归」）。

**累计：Wave1 24 + Wave2 16 + Wave3 20 + Wave4 27 + Wave5 39 = 126 条。
JVM 闸门全绿 ≠ 可发版，建议此刻安排一次真机清账（优先：本地曲库直连播放、推荐撞新与问卷、
首页长按菜单手势、deeplink 冷启动）。**
