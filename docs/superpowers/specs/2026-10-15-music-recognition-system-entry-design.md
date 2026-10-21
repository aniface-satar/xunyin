# 听歌识曲 · 系统级悬浮球入口 设计

日期：2026-10-15 · 状态：待复核 · 关联：`2026-10-10-music-recognition-design.md`

## 0. 这份文档推翻前三条既有决定

10-10 那份把系统入口列为非目标，并把全部会话状态钉死在组件内部。用户要求"在别的应用内也能识曲"，下面三条必须翻：

| 10-10 的决定 | 现在的结论 | 为什么改 |
| --- | --- | --- |
| QS 开关 / 通知栏 / 悬浮球明确列为非目标 | 本期做**悬浮球**，QS 开关与静态快捷方式仍留后 | 只有不抢前台的形态能服务"对面正在放的那一首" |
| 不建全局 store，状态全留在 `RecognizePanel` 内 | 会话状态机搬进 core 的单例，面板退化为订阅者 | 页面不存在时也必须能跑完一场，这不是"为了规范"，是没有别的通路 |
| `AfpWasmView` 挂在面板里（`RecognizePanel.tsx:393`） | 上移到应用根部，全生命周期只挂一次 | 面板不在 → `isWasmReady()` 恒假 → ncm 引擎被 `createActiveEngines()` 剔掉，球这条路只剩 Shazam |

## 1. 机制：球怎么拿到麦克风

球是原生 `TYPE_APPLICATION_OVERLAY` 视图（桌面歌词已跑通同一套，见 `LyricView.java:319`）。可见窗口只让进程停在 perceptible 态，**不等于"前台"，而安卓给不给麦克风只认前台**。

**定稿走"透明 Activity 当钥匙"（B2）**：点球 → 拉起一个全透明、`excludeFromRecents`、`noHistory`、几毫秒内 `finish()` 的 Activity → 它存在的那一瞬间应用合法地处于前台，`microphone` 类型前台服务得以启动 → Activity 消失，麦克风由还活着的服务继续持有 → JS 照常跑 `recordPcm`。

选它而不是"直接从后台 `startForegroundService`"（B1）的理由：B2 依赖的是"持有 `SYSTEM_ALERT_WINDOW` 就不受后台启动 Activity 限制"这条明确豁免；B1 要赌安卓 14+ 的 FGS 后台启动豁免清单里"用户点击了自己的悬浮窗"算不算触发时机，我没有官方原文可引（这台机器打不开 developer.android.com）。B1（直接从悬浮窗点击起前台服务）是**透明 Activity 被 ROM拦住时的次选**，不是 P1 失败后的出路：P1 失败意味着后台根本拿不到麦克风，那时只有 A 可用。

透明 Activity 也写 `android:screenOrientation="portrait"`，与 AGENTS.md 的竖屏约定一致；不改 `MainActivity` 的任何属性。

## 2. 三条生死探针（排在任何功能实现之前）

探针阶段只允许写一次性代码，验完就删，结论写回本文档。

- **P1 后台麦克风**。vivo 真机：球点击 → 透明 Activity → FGS(microphone) → `recordPcm(8)` 拿到的 PCM 是否非静音（判据：样本方差 / RMS 明显大于零）。**失败则 B 整条不成立，退回 A（进前台），本文档作废重写。**
- **P2 对面会不会被闪停**。分别用音乐类 App（后台继续播）与短视频类 App（被遮挡即暂停）各测一次：透明 Activity 那一闪之后，对面的声音是否还在。**失败不推翻 B**，但要改产品叙述——球只对"不依赖屏幕可见的音源"有效，文档与设置页文案都得跟着改。
- **P3 后台 WebView 指纹**。App 退到后台后 `fingerprintFromWasm` 是否仍在合理时间内返回结果（WebView 的 JS 在宿主不可见时是否被节流）。**失败则球这条路只用 Shazam**，ncm 在球上明确不可用；面板内不受影响。

## 3. 模块边界

JS 侧：

- `src/core/musicRecognition/controller.ts` —— 单例会话状态机。职责：批次号作废、`phase` / `hits` / `reason` / `timedOut` 的现取现订阅、`guard` 冷却闸门装配、`createActiveEngines()`、`resolver` 归属、以及"为识曲让路而暂停"的记录与还原。它今天全部长在 `RecognizePanel.tsx` 里，搬的是同一段逻辑，不改判定规则（`shouldStartAnotherRound`、`shouldResumeOnExit`、`mergeSong` 留在 `session.ts` 原样复用，已有单测继续有效）。
- `RecognizePanel.tsx` —— 只渲染与发命令。界面一个像素不改，包括 10-15 加的圆盘自动暂停/退页还原：它的两条触发条件（`playerState.isPlay`、批次作废时机）由 controller 承担，面板退页时把「页内前端离场」告诉 controller（还原的具体时机见 §6，球那条路的触发点不是退页）。
- `src/utils/nativeModules/recognitionBubble.ts` —— JS 侧桥接：显示/隐藏球、把 controller 的状态推给球、接球的点击事件。仿 `src/utils/nativeModules/lyricDesktop.ts` 的写法（NativeModule 方法 + `NativeEventEmitter`）。
- `src/core/init/deeplink/index.ts` 新增 `case 'recognition'` → `recognition/start`（球与通知都可用）与 `recognition/result`（点通知进识曲页看这一场结果）。分发时序沿用现状：`initDeeplink` 排在家推上来之后（`src/core/init/index.ts:31`），冷启动靠 `Linking.getInitialURL()`。
- `AfpWasmView` 从 `RecognizePanel.tsx:393` 上移到应用根部，只挂一次、随进程活着。挂在这里的唯一理由是 §0 第三条：面板不在就没有 WebView，ncm 引擎会被 `createActiveEngines()` 静默剔掉。上移之后 `wasmBridge.ts:11` 那条"转场时新旧两个视图短暂共存，注销要认出是不是我自己"的所有权检查不再必要（全应用只剩一个注册者），但保留而不删——它仍然挡得住热重载时两个视图重叠的情形。

分期上，**阶段 0（探针）与阶段 1（会话抽取 + WebView 上移）可以独立交付**：阶段 1 合完，界面无变化、现有单测全绿，球的两阶段再往上叠。

原生侧（`android/app/src/main/java/cn/toside/music/mobile/`，注册点沿用 `MainApplication.java:33-48` 的手工 `packages.add(...)`）：

- `recognitionBubble/RecognitionBubbleModule.java` + `RecognitionBubblePackage.java` —— 命令面与事件面。
- `recognitionBubble/RecognitionBubbleView.java` —— 悬浮视图：三种形态（待命 / 聆听中 / 结果字幕），拖动与吸边直接抄 `LyricView` 的触摸处理，不与歌词代码共用类。
- `recognition/RecognizeProbeActivity.java` —— 透明钥匙 Activity，唯一职责是起服务并立即 `finish()`。
- `recognition/RecognitionMicService.java` —— `microphone` 类型前台服务，只负责"保住麦克风与进程"，不负责录音；录音仍走现有 `AudioRecordModule`。常驻通知即 §5 的停止入口。

## 4. 交互定稿（用户已拍板的两条）

- **点球一次 = 一整场 60 秒持续聆听**（`SESSION_SECONDS`），不是单轮。轮次规则与页内完全一致：录满 8 秒、送出去、再开下一轮，到点只管"不再开新轮"。
- **识别完不自动收起**，球留着，由用户决定关。因此球要有"结果态"并持续显示：认出来就在球旁挂一条小字幕（`歌名 — 歌手`，取本场第一条命中；多条时尾部带 `+n`）。
- **点击语义按态定**（沿用圆盘那套，不新造）：待命态与结果态 → 点一下开新的一场；聆听中 → 点一下停止。结果字幕自己占一次点击，点它进 App 看完整结果。
- 停止一场有三条入口，都走 controller 的同一条 `stop()`：再点一次球、常驻通知的"停止"动作、进 App 后点圆盘。
- **开球只有一条路**：设置里的开关，开着才请求悬浮窗权限（沿用 `LyricModule.java:192,200` 的 `checkOverlayPermission` / `openOverlayPermissionActivity`）。**关球有两条**：拖到屏幕顶部的删除区，或回设置关掉——两条都必须把设置开关一起置为关，否则下次进 App 又看见球在那儿，或者再弹一次权限。
- 球处于待命态时**麦克风是关的**。只有点击才开录；指示灯会亮，这是系统行为，不藏也不解释成"App 在监听"。

## 5. 结果呈现

- 命中即发一条**聚合**通知（标题「听到 N 首」，正文首条歌名），本场内更新同一条，不刷屏；点通知 → `lxmusic://recognition/result` → 进识曲页显示这一场完整结果，之后与页内路径完全一致（可点歌条播放、已写进历史）。
- 没认出来**不发通知**，只让球回待命态。
- 历史沿用 `recognitionHistory`（`src/core/musicRecognition/historyStore.ts`），球听到的与页内听到的混在同一份里，按场次切标题的规则不变——不新增表、不加"来源"字段（用户不需要区分它是怎么来的）。

## 6. 与"自动暂停/退页还原"的关系

10-15 那条功能的语义是"为识曲让路的暂停，识曲离场时还原"。球这条路没有页面可退，还原时机改为**会话结束**：

- 球开会话时若我方正在播放 → 记下那一首并暂停；会话到点或被停止 → 还原（判定函数 `shouldResumeOnExit` 复用，条件不变）。
- 页内那条仍然是退页还原。两者互不干扰：controller 记录的是"哪一场按下的暂停"，还原由那场会话的离场触发。

## 7. 权限与兼容性

- 新增 `FOREGROUND_SERVICE_MICROPHONE` 与服务的 `android:foregroundServiceType="microphone"`（`AndroidManifest.xml:13-14` 现在只有 media_playback）。`RECORD_AUDIO` 已声明（同文件 `:22`）。
- 悬浮窗权限是 `SYSTEM_ALERT_WINDOW`，已声明（`:11`），但必须用户授予；未授予时球不出现，设置里给跳设置的入口。
- `minSdk 21`（`android/build.gradle:6`）：TileService 要 API 24+、静态快捷方式要 25+，本期都不做，所以不必为此加分支。`foregroundServiceType="microphone"` 与 `FOREGROUND_SERVICE_MICROPHONE` 权限自 API 29（安卓 10）起才有，后台麦克风限制自 API 28 起收紧——**低于 API 29 时设置里把开关整项隐藏**，不做半吊子降级。
- 国产 ROM 保活：球的开关联动一次省电豁免引导，复用现成的 `BatteryOptimizationUtil.java`，文案说清"关掉后球可能被系统回收"。

## 8. 失败路径（每条都要能一句人话解释）

| 现场 | 表现 | 收尾 |
| --- | --- | --- |
| 拒绝悬浮窗权限 | 球没出现 | 设置里保留"去开启"入口，不重复弹窗 |
| 拒绝麦克风权限 | 球闪一下回待命 | 沿用 `endSession('denied')` 那句教用户去系统设置的文案 |
| 透明 Activity 被 ROM 拦住（点球没反应） | 球不动 | 换 §1 的次选 B1（悬浮窗点击直接起服务）；仍不行退回 A |
| P1 失败（后台录到静音） | 每次都"没认出来" | **不能上线**：B 退回 A，本文档重写 |
| 服务被系统回收（会话中途） | 球停在聆听态 | controller 收不到回调 → 超时自认为 `ended`，球回待命，不发失败通知 |
| WebView 未 ready / P3 失败 | 只有 Shazam 结果 | 与页内同一套：引擎数组少一项照样跑，结果区少一个分区 |
| 冷却闸门判定为限流 | 球不进聆听态 | 沿用页内那句"歇一会儿再试"，不新造文案 |

## 9. 非目标

QS 快捷开关、长按图标静态快捷方式、**在播放那一条媒体通知上加识曲入口**（A 的三件套，tile 那条还有 API 34 起启动 Activity 的限制未验）。注意这与 §5 无关：会话期间那条常驻通知的"停止"动作是必须的（安卓要求前台服务通知可见），不属于本期非目标。其余：一直开着麦克风的自动识曲；锁屏态下的球；iOS 的快捷指令入口（识曲本来就 Android-only，`audioRecord.ts:17`）。

## 10. 验证

- 单测（`node --test`，沿用 `tests/music-recognition-*.mts` 命名与写法）：controller 的状态迁移（批次号作废、到点收尾、停止语义）、球的状态映射、通知聚合的"同一场只一条"。
- 源码顺序钉子：沿用 `tests/music-recognition-tap-feedback.mts` 的做法——面板与 controller 都起不来渲染，靠切片钉"翻状态早于 await、录音晚于全部前置、还原判定在离场回调里"这几条。
- 真机（vivo，全部由用户操作确认）：P1/P2/P3 三条探针 → 60 秒后台一场 → 结果通知可点进页 → 球停在结果态不自动收 → 三种停止入口 → 关掉开关后球消失且不再回收。
- 闸门：`npm test` 总数只增不减（今天 472）；`npx tsc --noEmit` 维持既有基线 137，新增文件不得引入报错。
