# 音乐下载（本地保存 + 后台下载）设计文档

日期：2026-10-14
状态：**设计待审**（尚未动任何代码）
约束来源：AGENTS.md（竖屏锁定，本功能不触碰任何方向相关 API）；用户 2026-10-14 四条拍板见 §1.1

---

## 1. 目标与范围

**目标**：用户在在线列表里点一首歌 → 选音质 → 歌落到手机存储里，本 App 离线能播，**系统里的其他音乐 App 也能看到并播放**；下载可以在后台继续，App 被杀后重开能接着下。

### 1.1 用户已拍板的四条（2026-10-14）

| # | 决策 | 落到设计里的位置 |
| --- | --- | --- |
| 1 | 第一次下载时让用户**选下载位置**，之后记住 | §5 位置与落盘、§7 首次流程 |
| 2 | **需要后台下载**（App 到后台继续下） | §6 原生前台服务 |
| 3 | 每次点击下载都**弹音质选择** | §7 音质面板（不做"记住选择"） |
| 4 | 要**出现在系统音乐库**（真下载到本地，不是缓存） | §5 MediaStore 发布 |

**非目标（本期明确不做）**：

- **不做 iOS**。本仓库发版只出 APK（`npm run pack:android`），iOS 没有 SAF/MediaStore 这套；iOS 侧隐藏下载入口（`Platform.OS == 'android'` 判定）。
- 不做转码（不下 flac 再转 mp3）、不做"试听缓存直接转成下载"。
- 不做下载列表的云端/局域网同步（`src/types/list.d.ts` 里 `downloadList` 那个类型口子本期不接）。
- 不做定时下载、按歌单批量预下载、下载后自动加进自建歌单。
- 不做横屏适配（本项目 portrait-only）。

**验收标准**（必须全部满足，缺一不算完成）：

| 条件 | 判定方式 |
| --- | --- |
| 永久免费 / 无自建后端 | 只用现有音源直链，不引入任何付费服务、不加服务端代码 |
| 真进系统音乐库 | vivo 真机下载完成后，**手机自带"音乐"App 的本地歌曲列表里能看到这首歌并能播放** |
| 后台继续 | 下载中把 App 划掉以外的一切方式退到后台（息屏 5 分钟），进度继续增长 |
| 进程被杀可恢复 | 下载中 `adb shell am force-stop` → 重开 App → 任务自动回到队列并**从断点继续**，不是从 0 开始 |
| 离线可播 | 断网（飞行模式）后，下载页里已完成的任务能直接播放、能显示歌词 |

---

## 2. 现状：零件齐了，中间那段是空的

本仓库第一条提交（`438ae8f Initial Xunyin release`）里下载实现就已经被拆掉了，git 历史**没有可恢复的代码**，只剩空壳：

| 还在（可直接复用） | 已没（本期要补） |
| --- | --- |
| `LX.Download.ListItem` 完整数据模型 `src/types/download_list.d.ts:7-65` | 下载 store（`src/store` 下无 download） |
| `LIST_IDS.DOWNLOAD = 'download'` `src/config/constant.ts:14` | 原生下载模块（`android/.../mobile/` 九个包里无 download） |
| 事件 `downloadListUpdate` `src/event/appEvent.ts:166` | 事件产生者（现在没人 emit） |
| 播放器认"下载项"形态 `src/core/player/utils.ts:50-53`（判 `isComplate`） | `getDownloadFilePath`（`src/core/music/download.ts:17-20,32-36,65-69` 全是注释） |
| 下载页占位 `src/screens/Home/Views/Download/index.js`（只渲染"下载"两个字） | 菜单入口（`src/components/OnlineList/ListMenu.tsx:61` 注释保留） |
| 设置项 `download.fileName` `src/config/defaultSetting.ts:70` | `download.savePath` / 并发数等设置 |

已验证可用的地基（都在跑，不是推测）：

1. **取直链**：`handleGetOnlineMusicUrl` `src/core/music/utils.ts:286-329`，带音质降档（`getPlayQuality` `:216-230`）与跨源重试。
2. **HTTP 下载到文件**：`RNFS.downloadFile` 封在 `src/utils/fs.ts:62-85`，APK 自更新已经在用它（`src/utils/version.js:116-150`，含进度回调、多镜像重试）。
3. **写进用户选的目录**：`react-native-file-system` 的原生侧认 `content://`（`.../com/filesystem/Utils.java:115` → `openOutputStream`），SAF 导出已在安卓 16 真机验通。
4. **写标签**：`react-native-local-media-metadata` 提供 `writeMetadata` / `writePic` / `writeLyric`（`node_modules/react-native-local-media-metadata/lib/typescript/src/index.d.ts:29,43,57`）。

---

## 3. 为什么必须写原生（决策依据）

`RNFS.downloadFile` 看着够用，但它满足不了第 2、4 条决策，三个硬伤：

1. **进程没了就断**。RNFS 的下载任务活在 App 进程里，没有前台服务（foreground service，就是通知栏挂一条"正在下载"让系统别杀你的那个东西）。vivo 的后台策略下，息屏一段时间后必掉。
2. **不能边下边写 SAF**。RNFS 只接受真实文件路径，不接受 `content://` URI，所以"直接下到用户选的文件夹"必须换个写法。
3. **不能续传**。RNFS 安卓侧没有 resumable（断点续传），403 或断网只能整个重头再来。

所以：**下载执行层用原生前台服务，JS 只管队列和状态**。原生做"搬运工"，JS 做"调度室"——这样状态机、重名、恢复这些复杂逻辑仍然在可单测的 TS 里，原生只有一块又窄又笨的代码。

---

## 4. 分层与数据流

```
在线列表菜单点"下载"
  └─ DownloadQualitySheet（音质选择，每次都弹）
       └─ 首次？→ ChoosePath 选位置并持久化授权
            └─ JS: enqueue → src/store/download  (LX.Download.ListItem[])
                 ├─ 取直链 getMusicUrl({ isRefresh: true })  // 实测链接分钟级就死
                 └─ NativeModules.MusicDownload.startTask({...})
                      └─ DownloadService (前台服务, type=dataSync)
                           ├─ HttpURLConnection + Range 续传 → temp .part
                           ├─ 进度事件 → JS reducer → store → UI/通知
                           └─ 完成 → 校验(文件头魔数 + 字节数对账) → 写标签(在 temp 上) → publish → 删 temp
```

三条不变量（写代码时要守住）：

- **任务真相只有一份，在 JS store**。原生侧不持久化任何任务状态，重启后由 JS 重新下发。原生挂了可以从 JS 完整重建。
- **原生只认 id**。所有事件带 `id` 回 JS，JS 用 reducer 改 store，UI 只订阅 store。原生不直接碰 UI。
- **落盘四段式**：temp `.part` → 校验（文件头魔数 + 与元数据声明 size 对账）→ 写标签 → publish。顺序不能换：文件进了 MediaStore 之后，本 App 拿不到可写的裸路径，`writeMetadata` 就废了（这是选"三段式"而不是"边下边写 MediaStore"的决定性原因）；而校验必须在写标签之前，否则探针实测到的那种"200 返回 JSON 错误页 / 960KB 试听片段"会带着漂亮封面进系统音乐库。

---

## 5. 位置与落盘：用户选的文件夹 vs 系统音乐库

第 1 条和第 4 条决策在安卓 11+ 是**有张力的**：`targetSdk = 36`（`android/build.gradle:9`），清单里那句 `requestLegacyExternalStorage="true"` 早就失效（`AndroidManifest.xml:28`），App 不能拿裸路径往 `/sdcard/Music/` 写。可选的写盘通道只有两条：

| 通道 | 别的音乐 App 能看见吗 | 位置能随用户挑吗 |
| --- | --- | --- |
| **MediaStore insert**（媒体库登记 + 写流） | ✅ 写完就在库里，不用扫 | ❌ 只能落在 `Music/<某个相对路径>` 这种媒体目录下 |
| **SAF OutputStream**（用户挑的树里直接建文件） | ⚠️ 要看运气，得额外喊媒体扫描 | ✅ 任意文件夹，含 SD 卡 |

**设计：两条通道都留，用"能不能翻译"决定走哪条。**

用户 SAF 挑完拿到的是 tree URI，它的 docId 形如 `primary:Music/xunyin` 或 `1F1A-2B2C:Music/下载`（`%3A`、`%2F` 是 URI 自身的编码，不是路径分隔——同 `src/utils/savePath.ts:1-6` 已经踩过的坑）。这个 docId **能翻译回"哪个卷 + 媒体目录下的相对路径"**，于是：

- **docId 是 `primary:...` 或 `<卷 UUID>:...`** → 走 **MediaStore**：`RELATIVE_PATH` 用翻译出来的相对路径、`VOLUME_NAME` 用对应卷。这样既尊重了用户选的文件夹，又保证进系统音乐库。
- **翻译不出来**（用户挑了 App 私有目录、云盘 provider 等） → 走 **SAF 写 + 尽力 `MediaScannerConnection.scanFile`**，并在下载页顶部挂一句大白话提示（§8 文案表）：这个文件夹里的歌别的 App 可能看不到。

重名处理：MediaStore 自己会加 `(1)`；SAF 通道需要先 `ls` 目标目录再决定 `歌名 - 歌手 (2).mp3`。**不能沿用导出那条"同名不覆盖、堆一堆 (1)"的行为**（安卓 16 真机已确认那个体验有问题）。

已存在的同名同大小文件 → 直接判定"已下载"，不重复占流量。

**扩展名只由文件头决定**（`LX.Download.FileExt` 本期要扩到 `mp3 / m4a / ogg / flac`）。探针实测三个信号都会说谎：URL 尾巴（`F000….ape` 其实是 flac）、Content-Type（tx 的 flac 有后端报 `audio/x-ogg`；kw 同一档有 mp3 也有 ogg）、以及 `RNFS.downloadFile` 回报的 mimeType（wy 那条真 mp3 报的是 `application/octet-stream`）。所以命名与 `tagFormat` 都取嗅探结果，嗅探不出来就判失败，不给它挂扩展名赌一把。

---

## 6. 后台下载：前台服务怎么起，风险在哪

- 服务：`cn.toside.music.mobile.download.DownloadService`，`android:foregroundServiceType="dataSync"`，新增 `FOREGROUND_SERVICE_DATA_SYNC` 权限（清单里 `FOREGROUND_SERVICE`、`POST_NOTIFICATIONS` 已有，`AndroidManifest.xml:13,17`）。
- 通知：单个常驻通知（channel `download`），聚合式——"正在下载 3 首 · 已完成 62%"。队列清空即 `stopSelf`。
- **安卓 15+ 的两条限制（这是本方案最大的系统风险，必须真机验证）**：
  1. `dataSync` 类型的服务只能在**用户刚操作过、App 在前台**时启动——我们是用户点"下载"起的，符合。
  2. `dataSync` 服务**每 24 小时最多累计运行 6 小时**，超了系统会强停（`ForegroundServiceDidNotStopInTimeException`）。对下载音乐来说 6 小时一般够用，但必须优雅降级：JS 侧收到服务消失 → 任务转 `pause` + 文案"今天的下载时间用完了，回到 App 点继续能接着下"。
- vivo 后台杀进程：仓库已有 `BatteryOptimizationUtil`（`android/.../mobile/utils/BatteryOptimizationUtil.java`）和 JS 侧 `requestIgnoreBatteryOptimization`（`src/utils/nativeModules/utils.ts:88`）。**首次开启下载时引导一次**加白名单，不是每次都弹。
- 断点续传：temp 文件用 `<id>.part`，重下发时带上 `Range: bytes=<已下字节>-`。**探针已确认五源全支持**（kg/tx/kw/mg/wy 一律 206 + `Content-Range`，见 `docs/superpowers/plans/2026-10-14-music-download-probe.md` §4.5），续传按标准能力做，不做"假装能续"。服务器返回 200 而不是 206 时**整个重下**。
- 直链保鲜：安卓侧不做取链，URL 由 JS 给。JS 缓存的直链**没有任何过期字段**（`src/utils/data.ts:519-529`，key 只有 `musicUrl_<id>_<quality>`），而实测**短的只要十来分钟就死**：wy +5 分钟还 206、约 +12 分钟已 403；kg/tx/kw/mg 到 +16 分钟都还 206。也就是说**最坏情况决定了策略**：任务起手一律 `isRefresh: true`，不留"复用缓存链接"这条捷径。
- **`isRefresh` 不一定真能换新链**（探针实测）：音源脚本自己也在缓存直链（星澜 v4.0.0 `CACHE_TTL_MS = 6 小时`），App 层的 `isRefresh` 只绕过 `src/utils/data.ts` 那层，绕不过脚本内部那份缓存；重新解析后 tx/mg 拿回的是**一模一样的一条 URL**，kg 才会换新。所以重试逻辑必须是：重取之后先比对新旧链接，**拿到同一条就立刻认输**（标"这个源暂时下不动"），而不是把 3 次预算烧在同一条死链上。
- 发布前的**三道验收**（探针实测逼出来的，不是防御性冗余）：
  1. **文件头魔数**：`ID3`/`fLaC`/`OggS`/`ftyp` 认得出才算音频。实测有后端用 `200 OK` 返回 `application/json` 错误页，只判状态码会把错误页存成 mp3。
  2. **字节数对账**：实到字节要和搜索元数据里那一档声明的 size 一致（tx `size320=10,792,943`、kg `HQFileSize=10,792,943` 都是逐字节相等，对得上就能当校验和用；kg 的 MD5 还直接等于 `HQFileHash`）。
  3. **拒绝试听片段**：实测 tx 某些后端**不分档位**一律返回同一条 960,887B 的 `RS02….mp3`（约 24–60 秒）。对不上声明大小就当失败重取，绝不能把片段当成品发布进系统音乐库。

---

## 7. 交互形态（壳）

### 7.1 首次流程

点"下载" → 若 `download.savePath` 为空：先弹位置选择（复用 `src/components/common/ChoosePath`，内部 `selectManagedFolder(true)` 持久化授权），选完再弹音质；若已有位置：直接弹音质。两条路径都在同一个 `handleDownload` 里串起来，不让用户点两次才知道要选目录。

### 7.2 音质面板

- 组件：`DownloadQualitySheet`，照 `src/screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx` 的骨架（RN `Modal` + `GlassBackdrop` + `useSheetSlideAnimation`，`forwardRef` 只暴露 `show()`）。竖屏，不做横屏分支。
- 选项来自现成的交集逻辑：`global.lx.qualityList[musicInfo.source]` ∩ `musicInfo.meta._qualitys`（同 `src/core/music/utils.ts:216-230`），当前播放音质那项高亮为默认。
- 批量多选时**只弹一次**，本次选择应用到整批（第 3 条决策说的是"每次点击下载"，不是一首一首问 20 遍）。
- 面板里**显示每档的预计大小**，数据来自搜索元数据里那档声明的 size（`musicInfo.meta._types[quality].size`）。探针实测这些数字与真实下载字节数**逐字节相等**（tx `size320` = kg `HQFileSize` = 10,792,943），所以它既能给用户看，也是下载完成后对账的靶子。取不到 size 的档位就不显示，不编。
- **完成后显示的是"实测到的"，不是"请求过的"**：探针里 HYW 后端被要求 128k 却返回 M800（320k 的文件），同一档在不同后端还可能是 mp3 或 ogg。所以音质那一行写"已下载 320k · 10.3 MB"要依据落盘字节数与文件头，而不是依据用户点的那一档。

### 7.3 下载页

`src/screens/Home/Views/Download/` 从占位换成真页面：两组——**进行中**（等待/下载中/暂停/出错，带进度条、速度、取消/重试）、**已完成**（可直接点播放）。底部导航加 `nav_download`（`src/config/constant.ts:113-118` 的 `NAV_MENUS` + `Vertical/Main.tsx` 的 PagerView 页）。

单项操作：暂停/继续、重试、删除（**必须问一句：只从列表移除，还是把文件也删掉**——只移除记录会让文件静静躺在盘上没人知道）。

### 7.4 离线播放接通

恢复 `src/core/music/download.ts` 里注释掉的三个本地分支（取文件路径 → 封面读文件内嵌、歌词读内嵌/lrc），把 `src/core/player/playInfo.ts:139-141` 的"download 列表返回空数组"改回真列表，`src/core/init/player/watchList.ts:36-41` 的事件监听就有数据了。已完成任务的播放路径解析优先本地、本地文件丢了再回源在线播。

### 7.5 设置项

| key | 类型 | 用途 |
| --- | --- | --- |
| `download.savePath` | string（tree URI，允许 `%3A` 这类编码原样保留） | 落盘位置 |
| `download.savePathName` | string | 给 UI 显示的人话名字 |
| `download.maxDownloadNum` | 1 \| 2 \| 3 | 并发数，默认 2 |
| `download.fileName` | 已存在 | 文件名格式（复用，不新增 key） |

---

## 8. 面向用户的文案（按"通俗优先"定稿）

界面里不出现"MediaStore / SAF / Range / 前台服务"这类词。

| 场景 | 文案 |
| --- | --- |
| 音质面板标题 | 选择下载音质 |
| 首次选位置提示 | 选一个文件夹存下载的歌。选"音乐"里的文件夹，其他音乐 App 也能看到它们。 |
| 位置翻译失败 | 这个文件夹里的歌，别的音乐 App 可能看不到。想都看到，改到设置里重选位置。 |
| 下载中通知 | 正在下载 {n} 首 · 已完成 {p}% |
| 6 小时限制触发 | 今天下载得太久了，先停一下。回到 App 点继续就能接着下。 |
| 链接过期重试中 | 下载链接过期了，正在重新获取… |
| 源只给试听 | 这个音乐源只肯给片段，这首歌下不全。换个音质或换个音源再试 |
| 死链（同脚本反复同一条） | 这个音源暂时取不到能下的链接。换一首或到设置里换个音源脚本再试 |
| 被源限流 | 这个音乐源暂时下不动，过会儿再试 |
| 空间不足 | 手机空间不多了，先腾点地方 |
| 文件不见了 | 文件不在原来的位置了，可能被删了或换了存储卡 |
| 删除任务二次确认 | 只从列表移除 / 连同文件一起删除 |

---

## 9. 风险清单（逐条拆开）

| 风险 | 影响 | 缓解 | 状态 |
| --- | --- | --- | --- |
| **安卓 16 vivo 上 dataSync 服务被后台策略提前杀** | 后台下载名存实亡 | Task 1 探针先验证 30 分钟息屏；不行就退到"仅 App 在前台/播放中下载"并如实告知 | **待真机验证（决定生死）** |
| **MediaStore 发布后自带"音乐"App 不索引** | 第 4 条决策落空 | Task 1 同时验证；不行则补 `scanFile`；都不行只能改成"本 App 内可播" | **待真机验证（决定生死）** |
| 直链无 TTL，大文件下到一半 403 | 下载失败 | **实测：分钟级**（wy +5min 仍 206、+12min 已 403；kg/tx/kw/mg 见探针文档 §6）→ 起手强制 `isRefresh` + Range 续传 + 同链即认输 | 已实测，方案定了 |
| 部分源对非浏览器 UA 做校验 | 403 | **实测不成立**：五源在移动端 UA / 桌面 UA / 无 UA 三种请求下都给 206。仍按 `src/utils/fs.ts:62-67` 带 UA 下发，但**不许把 403 默认解释成"UA 不对"** | 已实测排除 |
| **给的是试听片段不是整首**（实测：tx 某后端四档一律返回 960,887B 片段） | 用户以为下好了，存进音乐库的是 24 秒碎片 | 发布前与元数据声明 size 对账（§6 三道验收），对不上就重取，两次仍不符就判失败并说清"这个源只给试听" | **实测命中，必须做** |
| **200 返回 JSON 错误页**（实测某聚合后端） | 把错误页存成 mp3，离线播放直接崩 | 只认文件头魔数，不认状态码；魔数不认识就删 temp 重取 | **实测命中，必须做** |
| 后端是死的 / 脚本内部熔断（实测：星澜的 kw 八次全给同一个 400 代理；某代理 410 Gone；星海 403 后整轮不再请求） | 同一首歌换个脚本就能下，脚本内却永远失败 | 失败分类区分"链接作废"与"网络断了"；文案引导"换个音源脚本再试"，不在死链上烧重试预算 | 实测命中，有方案 |
| 音源脚本自己缓存直链（星澜 6 小时），App 的 `isRefresh` 绕不过去 | 重取拿回同一条死链，重试全废 | 重取后先比对 URL 是否变化，没变就立刻判死（§6） | 实测命中，有方案 |
| 服务器不支持 Range | 只能整首重下，用户以为卡住 | 检测到 200 而不是 206 就重头 + 状态文案"重新下载中"（**实测五源全给 206，这条只是保险**） | 实测未命中 |
| **一个不返回的 await 把整张列表钉在「排队中」**（取链的脚本接力、RNFS 传输 promise 都可能永远不落定：redirect 之后那条连接没带 readTimeout，线程被冻/丢了就再没人回调） | 点击下载后一直显示排队，重启 App 才开始下 | 取链挂 `url` 阶段看门狗（45s）→ 传输挂静默看门狗（60s 没有任何字节才判死，息屏冻结的那几分钟不算）→ 队列循环崩掉/忘记唤醒时自己再拉一轮，回前台也拉一次（`src/core/download/scheduler.ts`、`transferGuard.ts`） | 已实现（2026-10-17，JS 侧的兜底；移位到原生服务后仍需保留） |
| 磁盘写满 / SD 卡中途拔出 | 写坏文件、任务卡死 | publish 前查可用空间（`StatFs`）；写完做字节数校验；SD 卷失效直接标错误 | 有方案 |
| 同名文件堆一堆 `(1)` | 库变垃圾场 | 同名同大小视为已下载，不新建 | 有方案 |
| 版权与投诉 | 上游 lx 正是把下载整块删掉的 | 只在 App 内提供、不做分享导出、包内不预置任何音源脚本；对外发版是否带这功能要单独决定 | **需用户决策** |
| 6 小时累计上限 | 大批量下载断供 | 队列持久化 + 续传，跨天自动接着排 | 有方案 |
| iOS | 无 | 本期隐藏入口 | 已定 |

---

## 10. 测试与验证边界

- **纯逻辑（`node --test`，能单测）**：文件命名与非法字符、扩展名推断、重名解析、进度/速度计算、tree URI docId 解析与落盘目标翻译、队列调度与状态 reducer、开机恢复（`run` → `waiting`、文件丢失 → `error`）。RN-free 的叶子模块，参照 `tests/export-save-path.test.mts` 的写法（相对路径 + 显式 `.ts`，`@/` 别名在测试里不解析）。
- **UI（文本闸门）**：照 `tests/lyricSettingSheet.test.mts` 用 `readFileSync` + `assert.doesNotMatch` 卡"下载入口不能出现在横屏目录"、"音质面板必须用 Modal 而不是新导航页"。
- **原生（单测覆盖不到）**：`DownloadService` 只能真机验证，全部结论回写本文档并标日期。
- **闸门基线**（2026-10-14 本机复测）：`npm test` **384 pass / 0 fail**；`npx tsc --noEmit` **137 个既有错误**（含当前工作区未提交的识曲改动），只要求本次改动路径零新增。
- **eslint 只跑源码，不跑 `tests/*.mts`**（`.mts` 不在 lint 面上，且 `as const` 会让顶层 babel parser 报既有噪音——同 `docs/superpowers/plans/2026-10-12-recommend-language-quota-p1.md` 的 Global Constraints）。

---

## 11. 与识曲功能线的关系

当前分支 `feat/music-recognition-phase1` 上还有大量未提交的识曲改动。下载功能**另开分支**，且每个 Task 只 `git add` 自己列出的路径，绝不 `git add -A`。
