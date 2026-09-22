# 灵动胶囊 / 流体云 / 原子岛 接入说明

本文件记录 LX Music 在国产 ROM「灵动岛」类能力上的接入方式与依据的官方规范。

## 一、规范调研结论

### 1. 荣耀 MagicOS「灵动胶囊」

官方文档：

- 业务介绍 <https://developer.honor.com/cn/doc/guides/101769>
- 设计指南 <https://developer.honor.com/cn/doc/guides/101770>
- 开发指南 <https://developer.honor.com/cn/doc/guides/101771>

荣耀开放了两种接入范式，其中和音乐播放相关的是「**接入范式三、媒体胶囊接入**」，官方原文：

> 面向音视频播放场景，用于展示播放状态与基础控制能力。基于 Android MediaSession 原生能力开发，系统自动呈现为灵动胶囊样式……
> 将播放的媒体信息写入 MediaSession，并通过 MediaStyle 类型通知进行展示，就会自动以灵动胶囊的方式呈现。

也就是说 **音乐场景不需要调用任何荣耀私有 API**，只要媒体会话与通知是合规的 `MediaSession` + `MediaStyle`，系统就会自行渲染成灵动胶囊。

另外还有「接入范式四、Android 原生胶囊」（Android 16+）：

- 需要 `android.permission.POST_PROMOTED_NOTIFICATIONS`
- 必须是标准样式（`BigTextStyle` / `CallStyle` / `ProgressStyle` / `MetricStyle`）
- 必须 `setRequestPromotedOngoing(true)`、`setOngoing(true)`、设置 `contentTitle`
- 不得使用自定义 `contentView`、不得是群组摘要、不得 `setColorized(true)`、渠道不得是 `IMPORTANCE_MIN`

> 说明：`setRequestPromotedOngoing()` 与 `POST_PROMOTED_NOTIFICATIONS` 属于 Android 16 的系统接口，未包含在公开 SDK 的 `android.jar` 中，且要求 `targetSdk >= 36`。本工程 `targetSdkVersion = 29`，因此**未接入**该路径，此处仅作记录。

设计指南里的主要约束（用于后续做进度类卡片时参考）：

- 过程反馈（> 10s）：无更新 8 小时后消失，自然生命周期 12 小时
- 即时反馈（< 10s）：最长留存 10s
- 同一节点内信息 2.5s 轮播一次，最多 2 条，轮播两轮后定格
- 超过 20s 无更新才会再次触发轮播；文本超长走跑马灯（2 次，间隔 1.2s，之后截断）

### 2. OPPO ColorOS「流体云」

官方文档：

- 流体云模板（含音乐模板）<https://open.oppomobile.com/new/developmentDoc/info?id=12658>
- 意图共享（端侧）<https://open.oppomobile.com/documentation/page/info?id=13558>
- 意图共享数据结构 <https://open.oppomobile.com/documentation/page/info?id=13565>
- 垂域里程碑 <https://open.oppomobile.com/documentation/page/info?id=13568>
- ColorOS 16 兼容 Android 16 Live Updates API 的说明 <https://www.ithome.com/0/890/345.htm>

OPPO 侧分两条路线：

1. **音乐流体云**：ColorOS 的「音乐流体云」读取的是应用的标准媒体通知（realme UI 的官方教程里，酷我/QQ 音乐/酷狗/网易云都是通过「蓝牙车载歌词」开关让音乐流体云显示歌词），所以音乐场景同样走 `MediaSession` + `MediaStyle`，与本工程现有实现一致。
2. **通用场景**：OPPO 开放的端侧接口是「**意图共享（端侧）**」，通过系统 `ContentProvider` 调用：

   ```kotlin
   val client = context.contentResolver.acquireUnstableContentProviderClient("IntelligentIntent")
   val resultBundle = client.call("shareIntent", null, Bundle().apply {
       putString("intentData", "{...}")   // IntelligentIntent JSON
   })
   val code = JSONObject(resultBundle.getString("result")).getInt("code")
   ```

   - authority：`IntelligentIntent`
   - method：`shareIntent`
   - extras：`intentData` = `IntelligentIntent` 的 JSON 字符串
   - `intentAction.actionStatus`：`0` 创卡 / `1` 刷新 / `2` 销卡
   - 返回 `ShareResult`，`code = 0` 表示成功；`10101001` 表示「应用无该意图共享权限」，`10103003` 表示开关已关闭

   目前开放的垂域（`entityName`）为：`TAXI`、`DELIVERY`、`PICKUP`、`MATCH`、`NAVIGATION`、`TASK`、`SMART_DEVICE`、`TRAIN`、`FLIGHT`、`HOTEL`、`CHARGE`，**不包含音乐/媒体垂域**。音乐场景要走的是流体云「音乐模板」（`category="media"`），需要 OPPO 侧分配 `serviceId` 并授予意图共享权限。

   ColorOS 16 起流体云完整兼容 Android 16 的 Live Updates API，遵循 Google 实时活动规范的应用可以直接适配。

## 二、本工程做了哪些接入

### 1. 媒体会话 / 媒体通知合规化

文件：`node_modules/react-native-track-player/.../service/metadata/MetadataManager.java`、`.../service/models/TrackMetadata.java`

- `MediaSessionCompat` 补齐 `FLAG_HANDLES_MEDIA_BUTTONS | FLAG_HANDLES_TRANSPORT_CONTROLS`（原先只设置了 `FLAG_HANDLES_QUEUE_COMMANDS`，胶囊渲染器识别不到媒体会话）
- 通知增加 `setOnlyAlertOnce(true)`、`setShowWhen(false)`，避免每次刷新歌词/元数据都重新提醒
- 播放中把通知设为 `setOngoing(true)`
- 补充 `METADATA_KEY_DISPLAY_TITLE` / `DISPLAY_SUBTITLE` / `DISPLAY_DESCRIPTION`，锁屏与胶囊优先读这几个键

这些改动写在 `dependencies-patch.js` 里（幂等，可重复执行），并在 `package.json` 增加了 `postinstall`，`npm install` 之后会自动重新打上，不会因为重装依赖而丢失。

### 2. 通知权限声明

`android/app/src/main/AndroidManifest.xml` 增加 `android.permission.POST_NOTIFICATIONS` 声明。

当前工程 `targetSdkVersion = 29`，Android 13+ 上系统会自动授予该权限，因此没有加启动时的运行时弹窗请求，行为与改动前一致；将来若提升 `targetSdk` 到 33+，再补运行时请求即可。清单里先声明可以避免升级 targetSdk 后通知（进而胶囊）直接失效。

### 3. 原生岛桥接模块

- `android/app/src/main/java/cn/toside/music/mobile/island/IslandModule.java`
- `android/app/src/main/java/cn/toside/music/mobile/island/IslandPackage.java`
- JS 封装：`src/utils/nativeModules/island.ts`

对外能力：

| 方法 | 说明 |
| --- | --- |
| `getSupportInfo()` | 返回厂商/ROM 识别结果与能力位（`isOppoFamily`、`isHonorFamily`、`isVivoFamily`、`supportsMediaCapsule`、`supportsFluidCloudIntent`） |
| `isFluidCloudSupported()` | OPPO `IntelligentIntent` Provider 是否可用 |
| `shareFluidCloudIntent(intentData)` | 调用 OPPO 端侧意图共享接口，返回 `{ code, message, data }` |
| `dismissFluidCloudIntent(identifier)` | 以 `actionStatus = 2` 销卡 |

JS 侧封装：`getIslandSupportInfo()`、`supportsMediaCapsule()`、`isFluidCloudSupported()`、`createFluidCloud()`、`updateFluidCloud()`、`endFluidCloud()`。

## 三、仍需平台侧配合的部分

- **OPPO**：意图共享需要先向 OPPO 申请权限并分配 `serviceId`，否则调用会返回 `10101001`（应用无该意图共享权限）；音乐场景需要走流体云「音乐模板」。
- **荣耀**：媒体胶囊无需申请，但需要用户在系统设置里允许该应用显示实时通知/胶囊。