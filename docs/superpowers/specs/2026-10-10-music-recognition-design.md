# 听歌识曲（B 主 A 兜底）设计文档

日期：2026-10-10（2026-10-11 两次随实现回写：持续识别会话、双引擎并行 + 歌曲条结果）
状态：**描述的是当前代码**；与最初设计的差异都就地标注了日期与理由
约束来源：AGENTS.md（竖屏锁定，本功能不触碰任何方向相关 API）

---

## 1. 目标与范围

**目标**：用户在 App 内点一下，连续听约一分钟环境音，认出来的歌当场逐条列出来；一分钟都没认出来就给一句「听了一分钟，没认出来」。**结果行就是本 App 通用的歌曲条，点一下直接接进现有音源链路（播放 / 稍后播放 / 加入歌单）—— 这一段原设计写的是"后续期"，2026-10-11 由用户要求提前落地，见 §6。**

**非目标（本期明确不做）**：

- 不做跨会话的识别历史、收藏、导出录音（Audile 那种独立识曲 App 的定位，不是本 App 的定位）。会话内那份累积的歌名列表**不算历史** —— 它只在内存里，离页即忘，见 §7
- 不做后台常驻识别、通知栏入口、 QS Tile、悬浮球
- 不做"识别正在播放的这首曲目"（技术上可从 `audioFeature` 直接取 PCM，但属于另一个用例，等本功能上线后再评估）
- 不做横屏适配（本项目 portrait-only）

**验收标准**（必须全部满足，缺一不立项）：

| 条件 | 判定方式 |
| --- | --- |
| 永久免费 | 不依赖任何会过期的试用额度、不需要用户申请 key |
| 无自建后端 | 手机直连第三方接口，仓库里不新增任何服务端代码 |
| 用户多了不崩 | 单用户成功率不受总用户数影响；接口被收口时爆炸半径限于识曲功能本身 |

---

## 2. 决策依据：2026-10-10 实测数据

以下都在本机（中国出口 IP）真实跑过，不是文档摘录。原始验证脚本是一次性的，不进仓库。

### 2.1 引擎 B —— 网易云识曲接口

- 接口：`POST https://interface.music.163.com/api/music/audio/match`，urlencoded 表单 `sessionId / algorithmCode=shazam_v2 / duration / rawdata / times / decrypt`
- **无 key、无 cookie、无任何签名加密**（不需要 weapi/eapi/ecl）
- 压力：串行 20 次 + 并发 20 次 = 40 次，**40/40 全部正确命中**，无限流、无验证码、无 `-462`，平均 **365ms**
- 准确率验证：取 `浆果 - TINY7.flac` 第 20 秒起的 6 秒 → 返回 `song.name=浆果 / artists=TINY7 / id=2015896805`，`startTime=20020ms` 与切片偏移吻合，属于真命中而非蒙对
- 指纹：专有 `afp.wasm`（231,182 B）；上传体积仅 **2.0 KB**
- 官方 Chrome 插件默认窗口：`from=4s, len=6s`

### 2.2 引擎 A —— Shazam 免密钥通道

- 接口：`POST https://amp.shazam.com/discovery/v5/zh/CN/android/-/tag/{uuid}/{uuid}`，JSON body，签名塞在 `signature.uri = data:audio/vnd.shazam.sig;base64,...`（站点段实测用 `zh/CN` 与 `en/US` 皆可命中，落地固定为 `zh/CN`）
- 同样 **无 key、无 cookie**，UUID 随机生成
- 实测：8/8 请求成功，含本地指纹计算的总耗时平均 779ms
- **同一音频样本上两次给出错误歌名**（12s 窗 → "Home Alone"，4s 窗 → "Here With Me"，真值是"浆果/TINY7"）
- 窗口：4s 可用，12s 上限，**≥15s 必然失败**；上传体积 4.9 KB
- 指纹算法公开且有纯 JS 实现（1024 点 FFT + 4 频带峰值对哈希 + HSPG 封装），但参照实现是 **GPL-2.0**
- 二期落地后真机复测（vivo V2302A / Hermes / 外放 1 格）：整条链路命中正常，含网络单次引擎调用 1.3~1.5s，其中纯签名计算 **124~138ms**（同段音频在 node/V8 上是 24~34ms）。原估的「中端机 <1.5s」预算够用，不必把 DSP 挪进 WebView。

### 2.3 由实测得出的三条设计取向

1. **B 当主力**：华语命中率实测优于 A，且返回网易云歌曲 ID（可跳过模糊搜索）。
2. **A 与 B 互补**：两者失效面不重合（境内 CDN vs 境外端点；华语库 vs 海外库）。**原设计据此把 A 定位成"B 失败时才问的兜底"，2026-10-11 已改成每轮并行问两路**（理由与代价见 §4.5）——互补这个前提没变，变的是"用串行降级去兑现它"还是"用并行去兑现它"。
3. **A 的成本几乎全在"自己实现 DSP"**（参照实现是 GPL，不能搬进 Apache-2.0 的本项目），所以 A 排第二期，B 排第一期。

> 这一条修正了口头讨论时"第一期只做 A（风险最低）"的建议。修正原因：后续实测发现 B 的 JS 胶水是 **ISC 许可**（`ncm-audio-recognize@1.4.0`，可自由修改分发）、只依赖 `WebAssembly` 一个全局对象、且 `48kHz` 只是胶水里的断言（真实输入是每 6 个样本取 1 的 8kHz 数组）。B 的落地成本因此远低于 A 的自实现 DSP。残余风险只剩那个 231KB 的专有二进制。

---

## 3. 架构总览

```
[搜索页空白页入口卡 MusicRecognitionEntry]
        |  homeDetailActions.push({ type: 'musicRecognition' })
        |  （2026-10-11 从原生 Navigation.push 改成 Home 的应用内详情栈，
        |    与歌单/排行榜/推荐「更多」页共用同一套白底过渡，见 §4.6）
        v
  MusicRecognition/index.tsx（2026-10-11 去掉引擎标签，只剩页头 + 一个 RecognizePanel）
        |
        v
  RecognizePanel.tsx  ---- 面板内部状态机：not_ready / idle / listening / ended
        |                 （一次点按 = 一个 60 秒会话，会话内一轮一轮地听；规则在 session.ts：
        |                  shouldStartAnotherRound + mergeSong/songKey 是纯函数，有 9 条单测）
        |                 （面板不再认引擎；没有全局 store；AfpWasmView 无条件挂在这里）
        v
  原生 AudioRecordModule (Java)  -- 唯一录音点，48kHz 单声道 PCM16，一次性录 8 秒整段返回（会话每轮各调一次，轮之间放麦）
        |
        +---> 同一份 Int16Array 交给 provider，**两个引擎并行**（各拿同一引用，互不等待）
        |
        +---> pcmSplitter.decimate（引擎各自从 48kHz 原始窗口抽取，面板不做预处理）：
        |        B 路：每 6 个样本取 1，取 from=1s 起、len=6s 的窗口 -> Int16Array(8kHz, 48000 点)
        |        A 路：每 3 个样本取 1，同一窗口 -> 16kHz（31 抽头低通在 signatureFromPcm16k 里）
        |
        +---> [B] createNcmEngine().recognize：
        |        wasmBridge.fingerprintFromWasm(样本 base64 字符串)
        |          -> 隐藏 WebView 里的 afp.wasm 算出 rawdata(约 2KB)
        |          -> buildMatchForm -> httpFetch POST interface.music.163.com
        |          -> unwrapMatchBody（业务 code != 200 抛）-> parseMatchResponse
        |
        +---> [A] createShazamEngine().recognize：纯 JS 指纹 -> amp.shazam.com
        |
        v
  RecognizeRound { hits: [{ engineId, song }], failure }   —— hits 按引擎数组顺序，不是完成顺序
        |
        +---> ResultSections（就在识曲页内）**按引擎分两栏**，行 = 通用歌曲条 ListItem
        |        会话进行中就地增长；再点圆盘开一个新会话
        |
        +---> resolve.ts（**后台**，识别循环不等它）把 RecognizedSong 变成 MusicInfoOnline：
                 B：musicSdk.wy.musicSearch 一笔搜索，按 songmid 精确对回 -> 歌名歌手相等 -> 合成行
                 A：musicSdk.findMusic({ source:'' }) 五源并发，取第一条；查不到**不**合成
                 闸门：串行单飞队列 + songKey 去重 + 每会话最多解析 5 首（点行是唯一越闸入口）
                 —— 已接：wy/musicSearch、musicSdk.findMusic()、歌曲条、ListMenu、MusicAddModal、handlePlay
                 （见 §4.7 与 §6）
```

**关键取舍：为什么 B 的 wasm 用隐藏 WebView 而不是别的运行时。**

| 候选运行时 | 结论 |
| --- | --- |
| Hermes 直接跑 | 不行。Hermes 不提供 `WebAssembly`（facebook/hermes#429 维护者明确表态） |
| 现有 QuickJS（`userApi`） | 不行。用的是 `com.whl.quickjs`，不带 wasm（`android/.../userApi/QuickJS.java:13`） |
| 内置 wasm3/wAMR 原生模块 | 否决。本仓库 `android/` **当前没有任何 CMake/externalNativeBuild**（只有 `ndkVersion` 声明），引入第一条 C 构建链的代价太大；而且 wasm 的内存分配/`ExtractQueryFP` 调用约定要在 C 里复刻一遍 |
| wasm2js 转 asm.js 跑 Hermes | 否决。产物约 1–2MB JS，Hermes 下解析与执行速度不可控，属于赌 |
| **隐藏 WebView（`react-native-webview`）** | **采用**。Android WebView 有真 WebAssembly；ISC 胶水几乎原样可用；不动构建系统。**麦克风仍留在原生**，所以不受 WebView 的 secure-context 限制（`file://` 下 `getUserMedia` 不可用，但 `WebAssembly` 可用） |

WebView 侧的两个已知坑，设计上直接绕开：

- 胶水原本用 `path.join(__dirname,'afp.wasm')` 读文件；WebView 里 `fetch('file://...')` 被禁。改为由 RN 把 wasm 字节以 base64（约 308KB）注入一次，替换掉胶水里的加载函数。
- `react-native-webview` 原本是本仓库**完全没有**的依赖，第一期已安装 **13.6.4**（匹配 RN 0.73.11 的 v13.x 线）。已核到安装包级：`RNCWebViewPackage` 与 `RNFSPackage` 都进了自动链接生成的 `PackageList.java`，`assembleDebug` 通过。**「WebView 能起来」不等于「wasm 能 instantiate」——后者只能在真机验，仍未验。**

---

## 4. 组件与接口

每个单元的契约：它做什么 / 怎么调用它 / 它依赖什么。

### 4.1 `AudioRecordModule`（原生，**已落地为 Java 不是 Kotlin**）

- **实际位置**：`android/app/src/main/java/cn/toside/music/mobile/audioRecord/AudioRecordModule.java` + 同目录 `AudioRecordPackage.java`，注册在 `MainApplication.java:20`（import）与 `:45`（`packages.add(new AudioRecordPackage())`）。写 Java 是因为同目录既有原生模块（`audioFeature/`、`cache/`、`crypto/`）全是 Java，跟着邻居走而不是给仓库引入第二种语言。
- **做什么**：一次性录 N 秒（默认 8s）麦克风音频，返回 48kHz 单声道 PCM16。不做流式、不做后台、不做前台服务。
- **JS 侧封装**：`src/utils/nativeModules/audioRecord.ts` 暴露 `recordPcm(seconds)` / `requestRecordPermission()` / `cancelRecord()` / `isAudioRecordSupported()`。**这四个函数名是面板唯一认识的接口**，改名要同时改调用方。
- **依赖**：`android/app/src/main/AndroidManifest.xml:22` 的 `<uses-permission android:name="android.permission.RECORD_AUDIO" />`（已加）。iOS 的 `NSMicrophoneUsageDescription` **未加**（第一期只发安卓；iOS 上 `isAudioRecordSupported()` 返回 false，面板停在「还没接入」态，走不到录音调用，所以缺描述不会崩）。
- **并发与失败的实测语义**：同一时刻第二个采集请求会被原生以 `EBUSY — another recording is still running`（`AudioRecordModule.java:69`）拒绝；权限在 `requestRecordPermission()` 之后被撤销时 start 报 `EPERM`（`:63`）。**这两个错误码是"上一轮没作废就起新一轮"的报警器**，面板必须用批次号作废旧轮次，否则会把自己的重叠包装成「服务暂时没响应」。
- **范式来源**：照抄同目录 `audioFeature/AudioFeaturePackage.java` 的 Package/Module 写法。
- **隐私硬要求**：只在用户主动点击后录音，到达设定时长立即停止并释放 `AudioRecord`；不落盘、不加"继续录"选项。卸载面板时无条件 `cancelRecord()`（原生侧没有采集在跑时只翻一个 `AtomicBoolean`）。

### 4.2 `PcmSplitter`（纯 TS，无依赖）

- **实际位置**：`src/core/musicRecognition/pcmSplitter.ts`，导出 `LISTEN_SECONDS = 8`、`NCM_SAMPLE_RATE`、`NCM_TARGET_RATE`、`WINDOW_FROM_SECONDS`、`WINDOW_LEN_SECONDS` 与纯函数 `decimate(pcm, sampleRate, targetRate, fromSeconds, lenSeconds)`、`toLittleEndianBytes(samples)`。**录音时长由这个模块持有**，面板不许再本地硬编码秒数。
- **做什么**：把 48kHz PCM16 转成引擎要的格式。录音固定 8 秒，两路都取 `from=1s, len=6s` 窗口（对齐官方插件 `from=4s,len=6s` 的"跳过开头"思路，开头 1 秒用于避开点击噪声）。
  - B 路（**第一期已落地**）：每 6 个样本取 1，得到 8kHz、48000 点的窗口。返回的是 `Int16Array` 而不是 `Float32Array` —— 归一化交给 WebView 那侧的胶水，跨桥只传字符串。
  - A 路（**第二期已落地**）：每 3 个样本取 1 到 16kHz，同一窗口 96000 点；31 抽头低通在 `shazamSignature.signatureFromPcm16k` 里做，不在这里。
  - 索引公式与胶水 `toNCMBuffer` 的 `buf[now*48000/8000 + from*48000]` 等价，这一点由 §8 的离线逐字节对拍锁住，不是靠推导。
- **为什么不能各自录一次**：Android 10 起同一设备开第二个 `AudioRecord` 客户端，在相当一部分机型上会被静音或降权。**全程只允许一次采集、多路输出**。
- **越界行为**：`decimate` 是全函数——采样不足时补零而不抛（`pcmSplitter.ts:10-19`），所以"录音被系统打断变短"不会把面板打进异常分支，只会让命中率下降。
- **测试**：索引对齐和补零边界用固定 fixture 做单测（见 §8，已落地）。

### 4.3 `NcmEngine`（B，**第一期已落地**）

拆成四个文件，各自的边界是「能被单测打到的」和「只能在真机跑」：

- `src/core/musicRecognition/ncmApi.ts` —— 纯函数，不碰网络也不碰 wasm：`MATCH_ENDPOINT`、`buildMatchForm(rawdata, durationSeconds, sessionId)`、`createSessionId(random)`、`parseMatchResponse(body)`、`unwrapMatchBody(resp)`。
- `src/core/musicRecognition/ncmEngine.ts` —— 装配：`recognizeNcm(pcm: Int16Array, sampleRate: number)` 与 `createNcmEngine(): RecognizeEngine`。
- `src/core/musicRecognition/wasmBridge.ts` —— 进程内单例的一格注册位：`setWasmRequester` / `clearWasmRequester(fn)`（**按函数身份清，不会误清别人的注册**）/ `isWasmReady()` / `fingerprintFromWasm(samplesB64)`。没注册时 `fingerprintFromWasm` 大声抛 `fingerprint webview is not ready`。
- `src/components/musicRecognition/AfpWasmView.tsx` —— 隐藏 WebView 宿主与注入协议。

**契约（与最初设计不同，改动前先看这段）**：

- **对外**：`recognize(pcm: Int16Array, sampleRate: number): Promise<RecognizedSong | null>`，收的是**原生采集的 48kHz 原始窗口**（provider 原样透传同一引用，不拷贝也不降采样），每 6 个样本取 1 的 8kHz 抽取由引擎自己完成。「必须 48kHz float32」只是官方胶水的断言，真实喂给 wasm 的是每 6 个样本取 1 的 8kHz 数组 —— 所以重采样在 JS 侧做，胶水那层的输入格式在注入时补齐。**并行之后两个引擎拿到的是同一个 `Int16Array` 引用**（这一点由 `tests/music-recognition-provider.mts` 钉住），于是多出一条约定：**引擎侧不许就地改写它，只能读** —— 目前**没有**测试钉住这条，两路真并跑时谁改写都会污染另一路的抽取。返回 `null` = 安静未命中；**抛异常** = 服务故障（这条区分是 provider 的保险丝，见 §4.5）。
- **端点不写死**：`getNcmEndpoint()` 取热更新配置里的 `endpoint`；空端点时 `recognizeNcm` 抛 `ncm engine not configured`，不发请求。
- **HTTP 200 不等于成功**：`unwrapMatchBody` 看到数字型业务 `code != 200`（例如风控的 -462）时**抛**，于是落 `failed` 并累计一次退避；只有结构正常的未命中（`data.result` 为空）才回 `null` 落 `no_match`。把 code 异常咽成「没听出来」等于拆保险丝。
- **WebView 挂载位置：`RecognizePanel` 内，不是 App 根**（原设计是"一次性初始化、识别完不销毁"，实现时推翻）。代价：每次进页重注入一次（assets 有模块级缓存，重复进页不再读 308KB）；收益：从不进识曲页的设备不必常驻一个 WebView 和它的 wasm 堆，且不用动那几个在别人脏树里的 App 壳文件。**由此产生的硬约束**：调用方必须先问 `isWasmReady()` 再开始录音 —— provider 会先过闸门再让引擎抛，桥没起来时不预检就是白录 8 秒、白亮一次麦克风灯，最后只换到一句「暂时没响应」。
- **跨桥只走字符串**（真机探针实测，Node 里复现不了）：`Float32Array`/`Int16Array` 必须在 WebView 上下文内构造，否则 embind 抛 `BindingError: Cannot pass non-string to std::string`；`btoa(String.fromCharCode.apply(null, int8Array))` 在真 WebView 里抛 `InvalidCharacterError`，改用胶水自带的 base64 编码器。
- **wasm 资产随 APK**：`android/app/src/main/assets/recognition/afp.wasm`（231182 字节）+ 打完补丁的 `afp-glue.js`（88861 字节，ISC 许可可自由改）。`android/app/build.gradle:121-123` 必须有 `androidResources { noCompress 'wasm' }` —— RNFS 的 `readFileAssets` 用 `InputStream.available()` 定缓冲，压缩过的 asset 读不全。
- **注入幂等打在「注入」这个动作上**（同步闩），不能打在 `ready` 回包上：回包是一次异步往返，期间连续两次 `onLoadEnd` 会把整段 bootScript 注入两遍，换来两份 wasm 堆。
- **超时**：单次指纹请求 9s（`ncmEngine.ts:11` 的 `REQUEST_TIMEOUT_MS`，A 路取同值）；上下文失效（`onError` / `onRenderProcessGone`）时在途请求**当场结算**，不许只清定时器 —— 悬着的 Promise 会让 UI 永远停在「正在聆听」，而那一笔请求其实已经发出去了。
- **返回结构**（实测，与文档一致）：`data.result[] -> { startTime, song: { id, name, artists[].name, album: { name, id, picUrl } } }`；无命中时 `data.result = null` 且带 `data.noMatchReason`。

### 4.4 `ShazamEngine`（A，**第二期已落地**）

拆成三个文件，与 B 路同一套「纯函数能单测 / 装配只能在真机」的切法：

- `src/core/musicRecognition/shazamSignature.ts` —— 纯 TS 指纹编码器：`SHAZAM_SAMPLE_RATE = 16000`、`signatureFromPcm16k(samples, listenSeconds)`。1024 点 FFT + Hann 窗 + 4 频带峰值对哈希 + HSPG 封装（含 CRC），按公开算法描述自写。**禁止拷贝 GPL-2.0 参照实现的代码**；参照实现只用于本机对拍生成基准，不进仓库、不作依赖（对拍见 §8）。样本数不足 128 才回 `null`，定长窗口恒 96000 点，所以那条分支只在采集真空时才走到。
- `src/core/musicRecognition/shazamApi.ts` —— 纯函数：`TAG_URL_PREFIX`（站点段固定 `zh/CN`）、`buildTagUrl(tagId1, tagId2)`、`createTagId(random)`（大写 UUID v4，两个 id 各生成一次）、`SHAZAM_HEADERS`、`buildMatchBody(uri, sampleMs, timestamp)`、`unwrapMatchBody(resp)`、`parseMatchResponse(body)`。
- `src/core/musicRecognition/shazamEngine.ts` —— 装配：`recognizeShazam(pcm, sampleRate)` 先 `decimate` 到 16kHz，再算签名、发请求、解析。

**契约与实测口径**：

- **超时 9s**（`REQUEST_TIMEOUT_MS`），与 B 路一致。原设计写的 5s 在真机验收前被推翻：境外端点正常往返就要 0.3~0.7s，5s 会把"能等到结果"的慢网直接判成失败，而 9s 已足够兜住国内可达性最差的那一档。
- **只有非 2xx / 非 JSON 才抛**。真机实测：正常未命中、签名被故意改坏、body 结构畸形，三种情况服务端都回 **HTTP 200 + `matches: []`**。所以「保险丝」只能挂在传输层，绝不能把 200 空结果咽成异常，否则每次安静没听出来都会累计退避。
- **返回结构**（实测）：`body.track.{title,subtitle}` 与 `matches[].{timeskew,frequencyskew}`；专辑名取 `sections[type=SONG].metadata[].text`。**没有国内音源 ID**，所以 A 命中只能靠歌名+歌手跨音源模糊匹配 —— 这条已在 §4.7 落地（`findMusic({ source:'' })` 五源并发取第一条，**查不到绝不合成行**），A 栏因此可能列得出歌名却给不出可播的歌条，界面用「还没查到这首歌，点一下去找」如实说明。
- **性能预算已实测达标**：6 秒窗口在 vivo V2302A（Hermes）上纯签名 124~138ms、含网络整次引擎调用 1.3~1.5s，中端机 <1.5s 的预算够用 —— 原设计的"超出则把 DSP 挪进 WebView 预热"这条不需要做。

### 4.5 调度、限流与热更新配置（**第一期已落地**）

| 文件 | 职责 |
| --- | --- |
| `src/core/musicRecognition/provider.ts` | `recognizeWithEngines(engines, pcm, guard)` —— 同一份 PCM **并行**喂给数组里的全部引擎，回 `{ hits, failure }` |
| `src/core/musicRecognition/limiter.ts` | `createGuard({ storage, now })` —— 连续失败退避（**无每日次数上限**，2026-10-11 用户裁定取消） |
| `src/core/musicRecognition/remoteConfig.ts` | 纯解析：`DEFAULT_CONFIG`、`CONFIG_URLS`、`sanitizeConfig`、`fetchRemoteConfig` |
| `src/core/musicRecognition/configStore.ts` | 带缓存的读取口：`getNcmEndpoint()` / `isEngineEnabled(id)` |
| `src/core/musicRecognition/engines.ts` | 引擎元信息 + `implemented` 标记（`ncm: true`、`shazam: true`） |

- **调用顺序（2026-10-11 由"串行降级"改为"每轮并行"）**：一轮把**同一份 PCM**同时交给数组里的所有引擎，两个都问，谁听到算谁。原设计是串行降级（第一个出结果的引擎收工、后面的不发请求），配合界面上的引擎标签实际退化成了"用户自己切引擎"。改并行的理由是账：串行时两个引擎的匹配时间要**相加**（网易云 ≈1.4s + Shazam ≈1.5s ≈ 3.3s），一轮因此从"8 秒录 + 1.4 秒匹配"变成"8 秒录 + 3.3 秒匹配"，60 秒会话里的轮次从 ≈6 掉到 ≈4 —— 而流量一分没省（两个引擎最后照样都发了请求）。并行只让匹配段回到 ≈1.5s（取两路的最大值），轮次不动，命中率换成了两路并听。**代价是每轮请求数从 1 笔变成 2 笔**（见下面的流量账）。
- **六条不可让的语义**（`provider.ts` 顶部的注释里也写着）：① 引擎**返回 null** 才是未命中（`no_match`），**抛异常**才算故障（`failed`）——把异常咽成未命中等于拆掉保险丝；② 闸门先于引擎，`cooldown` 期间一个请求都不发；③ `engines` 为空数组（运营把两个引擎全关、或这台设备的桥起不来）时返回 `unsupported` 而不是抛，且**不碰退避计数**；④ 一轮里两个引擎**最多累计一次退避**：两个都抛只算一次失败，因为退避的量纲是"这一行不通"，不是"有几个引擎抛了"；⑤ 任一引擎命中就 `onSuccess()` 清零，哪怕另一路同时抛了异常——听到歌了还去冷却，是拿用户的失败换保护；⑥ `hits` 的顺序**按引擎数组顺序**而不是按完成顺序（`Promise.allSettled` 保序），所以结果页两个分区的先后是稳定的，跟哪个接口先回无关。
- **`await` 的位置是有意的**：`check()` / `onSuccess()` / `onFailure()` 三处 await **故意在 provider 内部的 try 之外**（只有 `engine.recognize` 在里面）。含义是"闸门自己坏了要让人看见"，所以**调用方必须自己 try/catch `recognizeWithEngines`**，否则 UI 会卡在整场会话那句「正在聆听」里出不来。同时 `limiter.ts` 内部把 `storage.get` 和 `storage.set` 各自兜住，**三个闸门方法不可能 reject**，包装 `GuardStorage` 时不要再加防御性 try/catch。
- **限流（2026-10-11 用户裁定：取消每日次数上限）**：闸门只剩**时间型退避** —— 连续失败按 `BACKOFF_MS = [1000, 5000, 30000]` 冷却，任一次成功清零。存储 key 仍是 `musicRecognition.guard`；老设备记录里残留的 `day`/`count` 字段被读侧当脏数据忽略，不需要迁移（由 `tests/music-recognition-limiter.mts` 里「旧版本残留的 day/count 字段被忽略，不影响放行」钉住）。
  - **为什么取消**：每日额度本质上就是一种**会过期的额度**，与硬约束里"永久免费"直接冲突。
  - **取消后仍然顶住"用户量涨了不会崩"的是三样**：① 退避（服务真挂时不再被无限重试）；② 远端开关（运营可整条引擎关停，见下）；③ 交互自身的节流 —— 一轮必须录满 8 秒才能发一次，而**一次点按只开一个 60 秒会话**（见 §5），到点就不再开新的一轮。**完整流量账（2026-10-11 并行识别 + 后台解析落地后）**：
    - 识别：每轮 2 笔（两个引擎并行），一次点按 ≈6 轮 ⇒ **≈12 笔**；一直连点的设备物理上也只有约 12 笔/分钟。
    - 解析（见 §4.7）：每个 ncm 命中 +1 笔（只搜网易云一个音源），每个 Shazam 命中 +5 笔（五个音源并发）。**这三道闸把它按住**：队列串行（绝不同时铺开五路）、`songKey` 去重（同一首连着命中只查一次）、每会话最多解析 **5 首**（`PER_SESSION_LIMIT`，用户点行是唯一越闸的入口）。
    - 会话上限：最坏 ≈12 + 5×5 = **≈37 笔**，典型（听出一两首）≈**18 笔**。比并行改造前的 ≈6 笔是**三倍**量级，这是这次改动真实买到的东西，不要当它不存在。
    - **会话预算就是"每日额度取消之后"那个顶替它的东西：按会话给量上限，而不是按天。**
  - **残余风险要如实记下**：单设备对免密钥端点不再有日量上限，且 2026-10-11 两次改动都在往同一个方向加量（先"点一次录 8 秒"→"连续听一分钟"，再"每轮一个引擎"→"每轮两个引擎 + 命中后还要跨音源找歌条"）。**标签删除之后，远端 `engines` 数组是单独关停某一个引擎的唯一杠杆** —— 界面上再也没有"只用另一个"的出口，所以本节末尾那条发布坑（配置里必须把 `shazam` 一起写上）从体验问题升级成了运维问题。网易或 Shazam 侧一旦上风控，客户端能做的只有退避与远端关停，没有"额度"这道缓冲了。
- **退避状态按设备共享、不按引擎拆**（二期加第二个引擎时定，真机已实测：Shazam 与网易云共用同一份 `fails`/`blockedUntil`；2026-10-11 界面去掉标签之后，这条从"两个标签互相拖累"变成了"一路连续抛异常会把另一路一起关最多 30 秒"）。为什么此时更不能拆：两个引擎现在跑在**同一轮**里，`provider` 的不变量④要求整轮只累计一次退避，那么计数天然就是一轮一个，per-engine 的份数没有对应的物理事件可数。两个引擎做的是同一件事，任一次成功就清零，且这条链路上失败本就少见。
- **没做内存缓存**（原设计里"同一段 PCM 的重复识别走缓存 10 分钟"**未实现，且不该补**）：这条链路上每次点按都重新录一段新声音，同一窗口不会被识别两次；缓存只会让"刚听过的歌再点一次"拿到旧结果，而保护服务这件事现在完全由退避 + 远端开关承担。
- **热更新配置**：`CONFIG_URLS` 是项目现有 GitHub/Gitee 仓库的 raw 地址（静态文件走 CDN，**不是后端**），字段 `{ version, engines: [{ id, enabled, endpoint }] }`，`KNOWN_ENGINE_IDS = ['ncm', 'shazam']`，域名白名单 `['interface.music.163.com', 'music.163.com', 'amp.shazam.com']`。
- **运营坑（发布前必读）**：出厂 `DEFAULT_CONFIG` 两个引擎全开，但 `sanitizeConfig` 只放行配置里**存在且 enabled** 的条目 —— 一旦真的提交 `publish/recognition-config.json`，`engines` 数组里必须把 `shazam` 那条一起写上，漏掉等于远程关掉它，而**界面上已经没有标签可切**，用户侧的表现只是"结果页永远只有网易云那一栏"，不会有任何报错。（Shazam 那条的 `endpoint` 只是过白名单与"有没有这条"的载体，真实 URL 由 `shazamApi` 自己拼两个随机 tagId，运营改这个值改不动请求去向。）
- **端点域名白名单**（已落地）：`remoteConfig.ts:22` `ALLOWED_HOSTS = ['interface.music.163.com', 'music.163.com', 'amp.shazam.com']`，且主机名解析按字符集收紧 ——  naive 正则会把 `@`、`\` 吞进 host，`https://evil.net\@music.163.com` 实际打到 evil.net 却看着像 163 的子域（`:46-47`）。**这个白名单是配置文件被篡改时唯一的兜底**，删掉它等于把指纹 POST 到任意 URL。
- **拉取策略**：每个镜像 4s 超时（`MIRROR_TIMEOUT_MS`，靠 `httpFetch` 的 `timeout` → `BackgroundTimer` + `AbortController`，`src/utils/request.js:169,174-178`）；读侧**先立即给陈旧缓存、后台再刷新**（stale-while-revalidate），所以冷启动不会把第一次识别堵住几十秒；面板 mount 时把两个引擎的配置各预热一次（`void isEngineEnabled('ncm')` 与 `void isEngineEnabled('shazam')`），**不在 App 启动时预热** —— 绝大多数用户从不进识曲页，不该为它每次冷启发五个镜像请求。
- **`DEFAULT_CONFIG` 的语义**（运营必读）：载荷结构不可读时回 `DEFAULT_CONFIG`（ncm `enabled: true`），而 `engines: []` 是**故意全关**。所以**配置文件被删 / 404 / 镜像全挂 = 功能重新打开**，紧急关停必须"保留端点 + `enabled: false`"并逐镜像核对文件真的更新了。
- **意义**：接口改路径/加参数时改一次提交即可全量生效，不必等应用市场审核。

### 4.7 命中 → 歌曲条的后台解析（`resolve.ts`，**2026-10-11 已落地**）

识别只给回"歌名 + 歌手（网易云那条还多一个歌曲 id）"，而本 App 能播的东西是 `MusicInfoOnline`。这一层负责把前者变成后者，且**全程在后台**：识别循环不等它，用户不用点任何"搜索"按钮。

| 接口 | 语义 |
| --- | --- |
| `beginSession()` | **只**复位"本会话已开查首数"计数；已解析好的歌条留在缓存里，重开会话再听到同一首不重查 |
| `request(engineId, song)` | 命中时调用。已在表里（同 `songKey`）就直接返回，**跨轮去重靠这一句** |
| `tap(key)` | 唯一能越过每会话上限的入口：用户点了那行，就是明确要这首歌 |
| `get(key)` / `hasPending()` / `subscribe(listener)` | 渲染读侧；`subscribe` 回注销函数，面板用 `setResolveTick` 重渲染而不是自己存一份快照 |

- **两个引擎的挑选策略不同，因为手上的证据不同**：
  - **ncm**：`searchNcm(歌名 空格 歌手)` 拿回 wy 的搜索结果行，先按 **`songmid == neteaseSongId` 精确对回**（`src/utils/musicSdk/wy/musicSearch.js:86` 把 `songmid` 填成网易的 `item.id`，这是本层能成立的关键发现），对不上再退"歌名与歌手都相等"，都退不到就**合成一行**（`source:'wy'` + 真 `songmid`，封面与时长留空）。合成行没封面没时长，但**点了照样能播**，因为播放只吃 `songmid`（`toNewMusicInfo`，`src/utils/index.ts:28`）。
  - **Shazam**：只有文本，只能 `findMusic({ name, singer, albumName:'', interval:'', source:'' })` 五源并发（`source:''` 是刻意的——`searchMusic` 只按 `source.id == s` 排除音源，空串一个都不排除；`interval:''` 让 ±5s 时长闸门变 no-op，识曲给不出时长，编一个只会把对的那条筛掉）。**取第一条就停。查不到绝不合成行** —— Shazam 手上没有任何可播 id，合成出来的行一点就崩，所以它的状态停在 `failed`，界面给一句"还没查到这首歌，点一下去找"。
- **三道流量闸**（与 §4.5 的流量账对得上）：① **串行单飞队列**（`drain()` 里 `if (running) return`），所以"五源并发"最多同时铺一层，两个命中不会各自铺开一层；② `songKey` 去重，连着命中同一首只查一次；③ **每会话最多解析 5 首**（`PER_SESSION_LIMIT`），超出后行还是显示、只是不自动去查，等用户点。上限按"首"计而不是按"请求笔数"，且 `tap` 不受限。
- **写回前重新检查状态**：`drain()` 出队后再看一次 `status == 'pending'`，避免一次迟到的搜索把用户已经点过、已经落定的行覆盖掉。
- **`rowAction(entry)` 单独抽成纯函数**（`waiting|pending|ready|failed` → `play|lookup|none`）：本仓库的惯例是把组件的判断决策抽成可单测的纯模块（先例 `src/components/OnlineList/pressAction.ts`）。它同时钉住一条容易写错的规则：**pending 的行点了没反应**（`none`），因为那一行正在查，再点只是把同一笔请求塞回队列。
- **单测**：`tests/music-recognition-resolve.mts` 13 条。"怎么搜"是**传进来的依赖**（`ResolveDeps`：`searchNcm` / `searchAllSources` / `toMusicInfo`），所以断言"挑了哪一行""合成行的字段""五源只取第一条"全在离线跑，不需要真网络也不需要 mock `musicSdk`。

### 4.6 状态与 UI（**已落地，四处与最初设计不同**）

- **状态：没有建全局 store。** 原设计要新建 `src/store/musicRecognition/{state,action,hook}.ts` 仿 `src/store/search/music/`，实现时**判定不需要**：识曲是"点一下 → 连续听一分钟 → 若干结果"的独立页面，没有任何界面需要订阅它的中间状态，跨页面共享的只有结果本身，而结果不共享（见 §6）。全部状态留在 `RecognizePanel` 内部：`phase`（`idle` / `listening` / `ended` / `not_ready`）、`results`（**按引擎各存一份**，`Record<引擎 id, RecognizedSong[]>`，因为同一段音频两路都可能听到）、`reason`、`timedOut` 用 `useState`，作废会话用的批次号用 `useRef`。后台解析出来的歌条**不进 React state**：面板只挂一个 `resolveTick` 版本号，`resolver.subscribe` 推一次就重渲染一次，行内容仍由 `resolver.get(key)` 现取——存快照的话同一首重复命中时会多出一份要对齐的中间态。**别为了"看起来规范"把它塞进 `global.state_event`。** 会话到点和被停止都收在 `ended`，圆盘随时能再开一个（重开会清空列表）。
- **入口**：搜索页空白页（`src/screens/Home/Views/Search/BlankView/`）里、热门搜索**上方**的矩形卡片 `MusicRecognitionEntry.tsx`，点击 `homeDetailActions.push({ type: 'musicRecognition' })`。热门搜索与历史搜索都保留，不替换。播放页入口暂不加。
  - **2026-10-12 卡片重构**：左侧原来是「标题 + 说明 + 按引擎解释」三行文字，右侧一小截声纹加箭头 —— 三行全是文字，看不出这和"听"有任何关系。现在改成**一枚 34dp 的实心主色圆徽**（里面是同一支 `Waveform`，5 根条、反色绘制），它就是识曲页那颗圆盘的缩微版：在搜索页先认出这个形状，进去就知道按哪里。文字减到两行（标题 15 + 说明 12），`music_recognition_engines_hint`（「两个引擎：网易云、Shazam」）整条删除 —— 对用户说"引擎"是系统词汇，用户既选不了也管不了它。右侧只留箭头，颜色从 `c-300` 换成 `c-font-label`，与设置页的箭头一致。
- **进入这一页的过渡（2026-10-11 从原生 push 改成应用内详情栈）**：这一页原本是仓库里**唯一**还走 `Navigation.push` 滑入的二级页，其余详情页（歌单、排行榜、我的歌单、推荐「更多」）都渲染在 `src/screens/Home/DetailStack.tsx` 里。栈的做法是：新路由先只铺一层 `theme['c-content-background']` 的空 View，下一帧才挂真内容 —— 用户看到的就是"底色先满屏、内容再出来"的**白底过渡**，而不是整页内容横推着盖过来。连带删掉的是原生那套注册：`MUSIC_RECOGNITION_SCREEN`（`screenNames.ts`）、`registerScreens` 的那一行、`pushMusicRecognitionScreen`、`src/screens/index.ts` 的桶导出，`index.tsx` 的 props 从 `{ componentId }` 换成 `{ onBack }`（返回由栈弹，不再 `pop`），根节点从 `PageContent` 换成 `flex: 1` 的 `View`（背景由栈那一层铺，页面自己再包一层会把主题背景图叠回来）。换来的可见变化三条，都只能真机复核：① 页面底部现在有 `PlayerBar` 与 `BottomTabBar`（`Home/Vertical/Content.tsx` 把它们渲染在 detail 容器之外），点歌曲条起播后底部那条能立刻看到；② 硬件 BACK 由 `DetailStack` 的 `useBackHandler` 接走，效果和点页头返回一致（弹掉这一路由 → 面板卸载 → `cancelRecord()`）；③ 切底部 tab 会触发 `navActiveIdUpdated` → `homeDetailActions.reset()`，**正在听的会话因此被直接结束**（原来是整页盖在 Home 之上，没有这个入口）。另外入口按下时**必须先 `Keyboard.dismiss()`**：原生 push 有新页面盖上来把键盘带走，详情栈是同屏替换内容，不收键盘它就压在识曲页上挡住圆盘。
- **识曲页（2026-10-11 删掉引擎标签）**：`src/screens/MusicRecognition/index.tsx` 现在只剩页头加一个 `<RecognizePanel />`，**面板不再知道自己是哪个引擎**。原来顶部那两个分段标签（网易云 / Shazam，切标签用 `key={engine.id}` 重挂面板）已删除：用户在得到结果之前没有被要求替两个服务做选择，选错了还得回头再听一分钟。`src/core/musicRecognition/engines.ts` 仍放引擎元信息，其中 `nameKey` 的用途从"标签文字"变成了**结果分区的标题**。`implemented` 标记留着（两路都是 `true`），它现在只参与 `phase` 初始值那一处判断。`AfpWasmView` 这座隐藏 WebView 桥不再挂在"选中了 ncm"的条件上，而是**面板打开就挂**。
- **过程 UI（2026-10-11 改为持续识别）**：整场会话只有一句状态文本「正在聆听」，**没有倒计时**。一轮是"录满 8 秒 → 匹配约 1.5 秒 → 麦克风放开约 3.5 秒"，这个节拍不给用户看：看了只会以为在倒数，而实际上听多久由用户自己结束。匹配段现在是**两路并行的最大值**而不是相加（网易云 ≈1.4s、Shazam ≈1.5s），所以并行改造没有把间隙拉长 —— 这是 §4.5 那条决策能成立的物理前提。`src/components/musicRecognition/Waveform.tsx`（沿条索引推进正弦相位、首尾取值相同因此循环不跳；未激活时是静态声波，入口卡片复用同一组件）在整个会话里持续跳动；中央 168 圆盘再点即结束会话，下方「停止」按钮做同一件事。待命文案 `music_recognition_idle` 里写明「会连续听一分钟」，让"它在连续发请求"这件事对用户是说出来的。
  - **2026-10-12 观感重做（`RecognizePanel.tsx` + 新组件 `src/components/musicRecognition/ListeningRing.tsx`）**：动手前先量了一下原来的圆盘，结果是**按下与没按下根本不是一个颜色** —— idle 用 `c-button-background`、busy 用 `c-primary-background`，而这两个语义 token 在 `buildActiveThemeColors`（`src/theme/themes/index.ts:82,88`）里指向同一个 `c-primary-light-400-alpha-700`，拿 17 套主题逐一套出来算底色对比得 **1.00**，也就是说整场"正在听"的反馈只剩声纹条从 30 长到 44。现在的做法是把唯一的醒目花在一处：
    - **只有「正在听」是实心的**：盘面翻成 `c-primary`、声纹条反色成 `c-content-background`（在实心主色上抠白），空闲与结束退回淡底 `c-button-background` + 主色边框 `c-primary-alpha-400`。按下去的那一瞬间，用户不需要读文案也知道机器开始工作了。
    - **涟漪一轮一圈**：`ListeningRing` 每开始一次采集呼出一圈（2.2 秒扩散到 1.32 倍后淡出，`useNativeDriver: true` 只动 opacity/scale）。它**不是循环动效** —— 节拍打在真实的采集事件上（`setPulse` 在 `recordPcm` 之前自增），约 9 秒一圈，所以它说的是"又听了一下"，而不是"一直在转"。系统「减弱动态效果」打开时整个不出现（`AccessibilityInfo.isReduceMotionEnabled()`，RN 0.73 安卓侧确实实现了）。
    - **停止做成描边胶囊**（原来是裸文字 + padding，看着像一句标签）；圆盘本身仍可点停，两条出口并存。
    - **说明行从圆盘上方挪到状态行下面**，并且只在有空可填时出现：空闲/结束是「点击开始，会连续听一分钟」+「放一段歌，或对着手机哼几句」两行，正在听只有一行「正在聆听」。原来圆盘上方那句 `_desc` 与入口卡片一字不差，在同一屏里是重复信息。代价：状态切换时圆盘会有一行高的位移（没有做高度占位）。
    - **半径的坑修掉了**：`borderRadius: 84` 配 `width: 168`，而 `createStyle` 只换算宽高、不换算半径（`src/utils/tools.ts:499-531` 的 case 列表里没有 `borderRadius`），大屏（≈411dp 宽）与字体放大档下宽高长到 ~184 而半径仍是 84，圆盘会变成圆角方块。改成仓库惯用的 `9999`（同 `LocateButton.tsx:28`）。
    - **`not_ready` 态圆盘 `disabled`**：原来点它只会把 phase 再设回 `not_ready`，看起来像"按了没反应"却没任何视觉表达；现在边框退回 `c-border-background`、声纹用暗字，且不再接收点击。
    - **删掉两个文案键**：`_engines_hint`（入口卡片那句"两个引擎：网易云、Shazam"）与 `_tip`（页脚那句"两个引擎一起听，听到什么就列在什么下面"）。理由是同一个：**"引擎"是系统词汇**，用户既选不了也管不了它，而结果区本来就按 `nameKey`（网易云 / Shazam）分了两栏，"为什么同一首歌可能出现两次"这件事由分栏自己说明。页脚只剩 `music_recognition_privacy` 一句（次日连这句也撤了，见下一条）。这条删减是可回退的：如果真机上看到同一首歌在两栏里重复却让人困惑，把 `_tip` 换个不带"引擎"的说法再放回去即可。
    - **页脚那句隐私说明换成识别建议（2026-10-12 用户裁定）**：`music_recognition_privacy`（「只上传一小段声音指纹，不会保存或上传完整录音」）删掉，三份语言文件同步。理由是**「指纹」是系统词汇**，和上一条同一个判据。换成按现场二选一的一句（`RecognizePanel.tsx` 的 `heardBracketedTitle`）：平时是 `music_recognition_tip_env`「安静一点，把手机放近一些，更容易认出来」，会话里听出过**歌名带括号**（`（DJ版）`、`(Cover)` 这类，全半角都算）时换成 `music_recognition_tip_cover`，说的是"带括号的多半不是原曲，原曲名常在这首歌的评论区热评里"——这条正是用户在真机上撞到的坑：搜出来的那一首是翻唱/DJ remix。**代价记在账上**：界面上从此没有任何一处写明"只上传指纹、不上传录音"，隐私承诺只剩 `AndroidManifest.xml` 的注释与本 spec §7；`not_ready` 态页脚整块不出现（那台设备根本用不了识曲，"怎么听更准"是废话）。结果区因此要按两行页脚留空隙（`ResultSections.tsx` 的 `marginBottom` 36→56）。**验证状态**：`tsc`、`eslint` 干净，识曲各套单测 127 pass（`tests/music-recognition-tap-feedback.mts` 只按源码切片钉 `run()` 里的顺序，页脚这句它管不到），三份语言文件键数齐平（各 670）；页脚那句在真机上排成几行、有没有压住结果区最后一行，**还没上屏看过**。
- **结果（2026-10-11 由纯文字列表改为通用歌曲条）**：`ResultSections.tsx` 在**识曲页内**分**两个分区**（标题取 `engines.ts` 的 `nameKey`：网易云 / Shazam）列出会话听出来的歌，**列表在会话进行中就地增长**，命中一首多一行；重复命中由 `session.ts` 的 `mergeSong` 收敛成一行。**这一栏名字在 2026-10-12 按用户裁定改了口**：`music_recognition_engine_ncm` 这个 lang 值从「网易云 / 網易雲 / NetEase Cloud」换成「**小芸** / 小芸 / Xiaoyun」，**改的只有这三个文件的这一个值**——引擎 id 仍是 `ncm`（`DEFAULT_CONFIG`、`KNOWN_ENGINE_IDS`、`sanitizeConfig` 与设备上缓存 1 小时的远端配置全按 id 匹配，改 id 会让这一路被判成未知引擎而静默关停），代码注释与本 spec 仍写"网易"（维护者必须知道打的是哪个未公开接口）。副作用要记在账上：界面上不再有任何一处告诉用户这一栏的结果来自网易——原先唯一还带一点来源线索的「只上传一小段声音指纹」那句页脚也在 2026-10-12 撤了（见上面页脚那条裁定），现在彻底没有线索。**新增第三个引擎时照此**：`ENGINES` 加一项 + 一个 `nameKey` + lang 加一条，id 与注释不参与改名。**没有命中就没有这个分区**（组为空时整组不渲染，不会出现一句"网易云：暂无"）。行组件直接复用全 App 通用的歌曲条 `src/components/OnlineList/ListItem.tsx`（`getRowInfo('medium')`、`isMultiSelectMode:false`、`activeIndex:-1`、`selectedList` 传模块级稳定空数组以保住它的 `memo`），所以封面、歌手、三点菜单这些样式与交互都是现成的，本页面不自建行 UI。仍在后台解析的那首先用一行**等高的暗字占位行**顶着（高度取 `ITEM_HEIGHT`，与歌曲条同一个常量），换成歌条时列表不跳；行右侧的三点走 `ListMenu`，**点行 = `handlePlay`**（加进默认列表并起播），与搜索页行为一致。原 `ResultCard.tsx`（单张卡 + 「再听一次」）与 `ResultList.tsx`（纯文字行、行内无按钮）都已删除。**依然不跳搜索页、不发 `appEvent`、不带 `componentId`** —— 跨音源找歌是在页内后台完成的（见 §4.7），不是把用户扔回搜索链路。
- **失败文案映射（现状，改 `errorText` 前先看）**：

  | 状态 | 渲染的键 | 中文原文 |
  | --- | --- | --- |
  | 两个引擎都装配不出来 / 无采集能力 | `music_recognition_not_ready` + `_not_ready_desc` | 这台手机用不了识曲 / 识曲需要用手机麦克风听一段声音，这台手机现在做不到… |
  | 麦克风被拒 | `music_recognition_denied` | 需要麦克风权限…请在系统设置里允许 |
  | 连续听满一分钟没认出来（且列表为空） | `music_recognition_timeout` | 听了一分钟，没认出来 |
  | 服务故障 / 退避中 / 运营关停 / 桥未就绪 | `music_recognition_failed` | 识曲服务暂时没响应，过一会儿再试 |

  **单轮「没听出来」不显示任何文案**：持续听的时候"这一轮没认出来"只是过程而不是结论，每 8 秒顶一句「没听出来」等于每分钟谎报六次结束。因此 `music_recognition_no_match`（没听出来，靠近音响…）、`_matching`（正在匹配，会话只有一句状态）、`_again`（再听一次，重新开始就是再点圆盘）三个键已在三份 lang 里删除；`RecognizeReason` 里仍然保留 `no_match`，它是 provider 层的分流语义，不再对应界面文案。

  **2026-10-11 删标签时又动了一批**：`_ncm_desc`、`_ncm_tip`、`_shazam_desc`、`_shazam_tip` 四个键删除（它们的存在前提是"当前选中的是哪个引擎"），新增三个：`_tip`（页脚那句，替代上面两条说明）、`_resolving`（「正在找这首歌…」）与 `_not_found_yet`（「还没查到这首歌，点一下去找」）。**后两个不属于 `errorText` 那张表**，它们是后台解析占位行的行内文案（`waiting`/`failed` 都用后一句，因为对用户而言"还没去查"和"查了没查到"该给的是同一个动作：点它）。三份 lang 当时各 **668** 键、识曲键 18 个，逐键同名。

  **2026-10-12 观感重做时又删两个**：`_tip`（刚加上不到一天，理由见上面「过程 UI」那条）与 `_engines_hint`（入口卡片那句引擎解释）从三份 lang 里删除，没有新增键。现在三份各 **666** 键、识曲键 **16** 个、逐键同名同序，产物 bundle 里这两个键的字符串出现次数为 0。（这两个数字是本轮复跑量出来的，之后再改文案要重新核一遍，别沿用旧值。）

  注意最后一行：**「这台手机用不了识曲」只在"这个引擎真的没实现"或"这台设备真的没有采集能力"时才用**。功能已经接上了还用它，就是在告诉用户一个假话（这是实现期发现并被修掉的缺陷 T8-f1：`provider` 的 `unsupported` 只可能是运营关停或桥未就绪，两者都该说"暂时"）。
  这句文案在 2026-10-11 又改过一次：原来写的是「识别还没接入 / 目前只做好了界面，麦克风采集和联网匹配在下一步实现」——那是第 0 期骨架期的实话，两个引擎都接上之后它变成恒假，于是换成现在这句只描述设备能力的说法。改文案时别把它改回"还没做"的口吻。
- **失败文案（不变的铁律）**：写"识曲能力由第三方提供，可能暂时不可用"，**不要**写成服务承诺语气。

---

## 5. 数据流与状态机

```
not_ready（两个引擎都装配不出来 / 设备无采集能力）——终态，圆盘无动作
idle --点圆盘--> listening（一个 60 秒会话，内部一轮一轮地听）
  一轮 = recordPcm(8s) → provider 把同一份 PCM 并行喂两个引擎（各自抽窗口 → 算指纹 → 一次请求）
         → 匹配段取两路里慢的那一路（≈1.5s）→ 麦克风放开约 3.5s
  命中     --> 按引擎 id 进各自分区（去重后继续听，会话不结束）
             同时把这一首交给 resolver 排队解析成歌曲条（§4.7，后台，识别循环不等它）
  未命中   --> 什么都不显示，直接开下一轮
  部分失败 --> 一路命中、另一路抛异常：整轮算成功（onSuccess 清零退避），会话继续听（provider 不变量⑤）
listening --shouldStartAnotherRound 说不用了--> ended(timedOut)
listening --采集失败 / provider 抛出 / cooldown / unsupported--> ended(reason)
listening --点「停止」/ 退到后台--> ended（无 reason、无 timedOut；已认出的列表留着，
                                        已排队的后台解析也继续跑完 —— 停的是听，不是看）
ended --再点圆盘--> 新会话（results 清空；resolver 的缓存留着，只复位每会话解析上限）
```

- **进不了录音的判定都在录音之前**，一个请求都不发：`engine.implemented` 与 `isAudioRecordSupported()` 直接并进 `phase` 的初始值（`RecognizePanel` 里 `useState` 的惰性初值，两者任一不成立就停在 `not_ready`，圆盘无动作）；运营关停（`isEngineEnabled(id)`）与 ncm 专属的 `isWasmReady()` 预检在 **`createActiveEngines()`** 里（原 `createSelectedEngine(id)`，2026-10-11 去标签后改名，现在装的是"这台设备此刻真能跑的那几个引擎"，数组长度 0~2），排在 `requestRecordPermission()` 与 `recordPcm()` 之前，两个都被剔掉才回空数组让 provider 落 `unsupported`。WebView 预检只对 ncm 成立 —— Shazam 是纯 JS 签名，不吃这座桥。
- 之后才是 `await guard` 那一侧的判定（`provider.ts`：`check()` 通过才进引擎）。**这条判定现在被提前到 `run()` 里问了一遍**（2026-10-11 修）：面板在装配引擎之前先 `guard.check()`，不通过就直接落错误态，于是还在冷却时不再"白录 8 秒 + 白亮一次麦克风灯"才等到那句失败提示。provider 里那次 `check()` 保留不动 —— 它才是"闸门先于引擎"的权威判定，面板这次只是把同一个结论提前说给用户听；成立的前提是 `check()` 只读不写（两次问之间没有任何落盘动作），这一点由 `tests/music-recognition-limiter.mts` 里「check() 只读不写，连问多次一个字节都不落盘」钉住。
- **会话规则放在 `src/core/musicRecognition/session.ts`，是纯函数**（`tests/music-recognition-session.mts` 9 条钉住）：`shouldStartAnotherRound(now, startedAt)` 用 60 秒预算决定还要不要开新的一轮，`mergeSong` + `songKey` 决定两次命中算不算同一首。面板只负责"录一轮、问一次、把结果交进来"。
  - **截止只管开新轮，不管收正在跑的那一轮**：一轮必须录满 `LISTEN_SECONDS` 才有可识别的窗口，半路掐掉等于白录。所以会话真实时长会略过一分钟（约 63~70 秒），这是刻意的，不是漏掉的收尾。
  - **去重键必须是 `neteaseSongId|歌名|歌手`**：Shazam 那条的 `neteaseSongId` 恒为空串（跨派系填它等于造假数据，见 `shazamApi.ts`），只比 id 会把整个 Shazam 列表压成一行。同名不同 id 算两首（现场版与录音室版同名是真事）。
- **为什么不是"一次录满 60 秒"或原生流式**：原生 `AudioRecordModule` 是一次性交付整段 PCM、上限 10 秒（`MAX_SECONDS`），且 Android 10 起第二个并发 `AudioRecord` 客户端在多数机型上会被静音，所以格式只能从这一条流里在 JS 侧换算。60 秒单段 = 5.76 MB PCM → 约 7.7 MB base64 过桥（8 秒那段已经让 JS 线程停约 2 秒），而且结果只能等到整段录完才出得来 —— 与"听到就列出来"直接冲突。因此持续识别 = **8 秒一轮的循环**，麦克风在轮与轮之间放开约 3.5 秒。
- **一次会话只问一次权限**：`requestRecordPermission()` 排在循环之前，不在每轮里问，否则等于每 8 秒弹一次系统框。
- **退到后台就结束会话**：`AppState` 监听非 `active` 时推进批次号并 `cancelRecord()`。安卓会把后台应用的麦克风收成静音，继续录只是白烧轮次；已认出的列表留着。**这条与"面板卸载时无条件 `cancelRecord()`"是同一个约束的两个入口** —— 别把它当成可选的体验优化删掉。
- **每个会话有自己的批次号**：`run()` 在**进闸门之前**就 `const seq = ++runSeqRef.current`（2026-10-11 修：原来排在"装配完引擎之后"，而 `guard.check()` 读存储与 `createActiveEngines()` 冷缓存串行走五个镜像可能要十几秒，那段时间圆盘看起来还能点，第二次按下必须能把第一次那次彻底作废；否则两次 run 各自一路走到录音，后起那次撞上原生 `EBUSY`，整场会话开局就失败），此后每个 await 都用 `seq !== runSeqRef.current` 判断"我还是最新那个会话吗"；「停止」按钮和退到后台都推进批次号，而不是拨一个共享布尔量。用布尔量的话，会话进行中被作废的那一轮迟到的结果会盖到新会话头上（列表串台、波形冻住、停止按钮消失，而麦克风还在录）。
- 识曲在独立页面内进行，圆盘即会话开关；结束会话（点停止 / 退后台 / 卸载面板）都无条件 `cancelRecord()`，正在录的那一轮直接丢弃。
- **按下即进 `listening`，视觉反馈与录音前置解耦（2026-10-12 修）**：原来 `setPhase('listening')` 排在 `guard.check()`（读存储，冷启动首次访问还要等原生存储起来）和 `createActiveEngines()`（冷缓存时串行探五个镜像）**之后**，于是冷启动进页面马上按圆盘会出现"按下去没反应，过两三秒识曲动画才起来"——`busy` 只看 `phase`，那段时间盘面不翻主色、声纹不跳、涟漪不出现。现在把这三句状态复位挪到批次号分配之后、两道前置之前，录音/权限/请求的顺序一个字没动：`recordPcm`、`requestRecordPermission()`、`guard.check()`、`createActiveEngines()` 全都仍排在它们各自原来的位置，所以**麦克风灯与网络请求一笔都没有提前**。代价是「闸门判成 cooldown」或「引擎被运营全关」这两种收尾里，`正在聆听` 会空转那一段前置的时间再换成失败文案（原来是从头到尾一句没出现）——这是刻意换来的，因为同一个时间里用户看到的是"这一下被接住了"而不是"这个按钮坏了"。`§4.5` 那条「批次号在闸门之前分配」的前提不变，仍然是它让第二次按下能把第一次那次彻底作废。
- **后台解析与识别循环彻底解耦**：命中那一行代码只调 `resolver.request(...)` 就立刻继续听，**识别循环从不 await 解析**，也不因为解析慢就多等一轮 —— 用户要的是"继续听"，歌条是稍后才长出来的。反过来，停止 / 退后台 / 换会话都**不撤已经排队的解析**：撤了那一行会永久停在「正在找这首歌…」，而 `rowAction` 对 pending 回的是 `none`，界面上没有任何入口能再点它 —— 那比多花一笔请求糟得多。这条代价由 §4.7 的每会话 5 首上限封住，不靠取消。
- 每一轮的 PCM 与指纹都不缓存（内存里用完即弃），**也不缓存识别结果**（理由见 §4.5）。

---

## 6. 结果落地（**2026-10-11 部分翻案：结果变成可播的歌曲条，但仍在页内**）

**现状**：命中的歌在识曲页内**按引擎分两栏**列出，行是全 App 通用的**歌曲条**，由后台解析（§4.7）把"歌名+歌手"变成 `MusicInfoOnline` —— **点行即起播**，右侧三点进 `ListMenu`（稍后播放 / 加入歌单 / 歌曲来源详情…）。**依然不跳搜索页、不发 `appEvent`、不带 `componentId`。**

**这条是 2026-10-11 用户明确翻的案**（原话：**结果界面再分开展示网易云和Shazam的识别结果，识别结果直接用歌曲条展示，如果是Shazam识别出来的就用它搜出来的文本字段在五个音源搜索是否有歌名歌手名字段对应歌曲(后台进行)并展示歌条**），推翻了实现期早先那条「task8 结果不用落到搜索，直接在识曲页展示结果」。

**翻案翻掉的是哪一半、留下的是哪一半**（下次别再整条推翻或整条恢复）：

| 原裁定的顾虑 | 现在的处理 |
| --- | --- |
| "第三方的一次猜测不该变成一串可点的东西" | **这条不再成立，是用户看过代价之后主动接下的**：一次猜测现在确实能变成起播。换来的边界是——**可点的对象只在页内那一栏里**，不写进搜索历史、不进搜索页、不留跨页面痕迹 |
| "用户很难判断哪来的" | 用**分区标题**回答（网易云 / Shazam 两栏各自列，页脚一句「两个引擎一起听，听到什么就列在什么下面」）—— 来源写在结构上而不是藏在文案里 |
| "第一期没有『去听这首歌』的通路" | **已接**，就是下面那两条路径 |

**当初记下的翻案理由（为什么原来选纯文字）也一并如实记下**：把猜测灌进搜索链路会让一次猜测变成一串可点的东西。这个风险并没有因为改主意而消失，它现在由另外三样东西兜着：① 解析出的行**必须来自真实音源搜索结果**（Shazam 那路查不到就绝不合成行，见 §4.7）；② 每会话最多解析 5 首；③ 错配至少还有"点一下去找"这个出口，而不是只能退出页面去搜索。

**原来"未接的两条路径"现在各自落成了什么**（实现与原设计有出入，改之前先看这里）：

1. **B 命中（网易云，有 `song.id`）**：原设计要"`musicInfo.js` 按 ID 取详情，再 `findMusic` 找其它音源"。**实际没走详情请求**——勘查发现 `src/utils/musicSdk/wy/musicSearch.js:86` 把搜索行的 `songmid` 就填成了网易的 `item.id`，所以一笔 `musicSearch` 搜索回来的行**本身就是可播的 wy 行**，按 `songmid` 精确对回即可。省掉一次详情请求，代价是封面/时长只在真对回搜索结果行时才有，对不上就合成一行（没封面没时长，仍可播）。
2. **A 命中（Shazam，只有文本）**：按原设计走跨音源搜索，用的是 `findMusic({ name, singer, albumName:'', interval:'', source:'' })`（五个音源并发、回按匹配度排好的逐源最佳行），取第一条。**刻意不做时长闸门**（识曲给不出时长）与**不排除任何音源**。

**仍然没接的那一样**：`RecognizedSong.startTime` 偏移（实测「浆果 / TINY7」id=2015896805、偏移 20020ms 与切片位置吻合）——**现在点歌曲条是从头播**，不会 seek 到刚才听到的那一段。要接的话是 `handlePlay` 之后补一次 seek，属于后续期，本期刻意没做（它会让"点一下"这件事的行为变得不可预测：用户以为在播整首）。

**仍然没有的**：一行上没有任何"换个结果 / 不是这首"的按钮（错配只能靠"点一下去找"重跑一次匹配，或用户自己去搜索页）。

---

## 7. 权限与隐私

- Android 的 `RECORD_AUDIO` 已加（`android/app/src/main/AndroidManifest.xml:22`）。iOS 的 `NSMicrophoneUsageDescription` **故意没加**：第一期只发安卓，而 iOS 上 `isAudioRecordSupported()` 返回 false、面板停在 `not_ready`，走不到录音调用，所以缺这个描述不会触发系统崩溃。**将来出 iOS 包时必须补，并且那条 `!isAudioRecordSupported()` 的早退是这个不变量的唯一守护者。**
- 拒绝授权：只在屏内显示一句「需要麦克风权限才能识曲，请在系统设置里允许「寻音」使用麦克风」，**没有** `Linking.openSettings` 之类的跳设置按钮（第一期未实现，属于可接受的手动路径），也不会反复弹窗——权限在**每场会话**的开头问一次，会话内那约 6 轮不再问。永久拒绝后系统不再弹框，此时屏上就是这句文案，真机验收要确认它读起来像"该去哪儿"而不是"程序坏了"。
- 上传内容：**只有指纹（约 2 KB），不上传录音** —— 这句技术事实不变。但它**已经在 2026-10-12 从界面上撤掉**（`music_recognition_privacy` 三个语言文件全删，页脚换成识别建议，理由与代价见 §6 那条裁定）：现在普通用户在 App 里看不到任何一句「不会上传完整录音」的承诺，这一层保证只剩本 spec、`AndroidManifest.xml` 的注释和实现本身。**如果将来要把隐私承诺放回界面，别再写「指纹」**，换成日常说法（例如「只听你按下的这几秒，不保存录音」）并放在设置/关于页，而不是识曲页页脚——那一屏的位置已经给了更实用的建议。
- 不做任何录音落盘、不做跨会话的识别历史（少存少错）。持续识别累积的歌名列表与后台解析出来的歌曲条缓存**都只活在内存里**（resolver 的缓存在面板卸载后一起消失）：离开识曲页即忘，不落盘、不进任何 store。**一个诚实的例外**：用户点了那一行之后，它进的是全局默认播放列表（`handlePlay` = `addListMusics(LIST_IDS.DEFAULT)` + 起播），而播放队列本来就会落盘 —— "离开识曲页即忘"管的是识曲页自己的状态，管不到用户主动点出来的那一首。本地只存两样：退避状态（`musicRecognition.guard`，只有 `fails` 与 `blockedUntil` 两个字段）和配置缓存。
- 调试日志按本项目惯例加 `__DEV__` 门控（release 构建不剥 console，历史上踩过）。注意副作用：真机上「胶水启动失败（`ready:false`）」这类只有 `__DEV__` 日志的状态**看不出来**，验收要盯屏内文案而不是找日志。

---

## 8. 测试策略

**已落地的单测（`npm test` 全量 263 pass / 0 fail；其中识曲各套合计 106 条）**：

| 文件 | 用例 | 覆盖什么 |
| --- | --- | --- |
| `tests/music-recognition-pcm-splitter.mts` | 7 | 48k→8k 取样索引 == 胶水公式、窗口越界补零 |
| `tests/music-recognition-afp-glue.mts` | 3 | **离线逐字节对拍**：本仓库的抽取结果与网易官方胶水的 `toNCMBuffer` 输出完全一致 |
| `tests/music-recognition-ncm-api.mts` | 16 | urlencoded 表单构造、`sessionId`、响应解析、`unwrapMatchBody` 的业务 `code` 闸门 |
| `tests/music-recognition-limiter.mts` | 12 | 退避序列 `[1000,5000,30000]`、成功清零、`check()` 只读不写、旧记录里残留的 `day`/`count` 当脏数据忽略、脏 JSON / 非对象存储不炸 |
| `tests/music-recognition-remote-config.mts` | 14 | `sanitizeConfig` 形状校验、`ALLOWED_HOSTS` 白名单（含 `evil.net\@music.163.com` 伪装）、多镜像取第一个能用 |
| `tests/music-recognition-provider.mts` | 10 | **2026-10-11 随并行改造整体改写**：两个引擎都被问到且两个命中都保留、`hits` 按引擎数组顺序而非完成顺序（故意让慢的那路排在后面）、真并发（同时在跑数 == 2 且总耗时 < 两路之和）、命中+抛异常只算成功、两个都抛**只累计一次** `onFailure`、两个都 null 零次记账、闸门先于引擎（`check()` 不许时两个引擎都不被调用）、空数组回 `unsupported`、null vs throw 的分流、**同一份 PCM**（同一引用、同采样率、同内容）喂给两路 |
| `tests/music-recognition-resolve.mts` | 13 | **2026-10-11 新增**，全靠注入假的 `searchNcm` / `searchAllSources` 离线跑：ncm 按 `songmid` 精确对回、对不上退歌名歌手相等、再退合成行（并断言合成行**没编造**时长与封面）、Shazam 查不到时**绝不**合成行、五源只取第一条、串行队列不并发铺开、同 `songKey` 跨轮去重不重查、每会话 5 首上限与 `tap` 越闸、出队时状态已变则不写回、`rowAction` 四态映射（pending 点了没反应） |
| `tests/music-recognition-shazam-signature.mts` | 6 | 自写 Shazam 编码器与参照实现的**字节级对拍**（这个端点坏签名也回 200 + 空 matches，线上看不出来） |
| `tests/music-recognition-shazam-api.mts` | 16 | tag URL 拼装、`samplems`、响应按下标解析、`unwrapMatchBody` 的 HTTP/非 JSON 闸门；末尾两条是全链路（403 走完整 `recognizeWithEngines` 必须是 `failed`、静音的 200 必须是 `no_match` 且不累计退避），2026-10-11 只是把断言形状换成 `{ hits, failure }`，**意图未变** |
| `tests/music-recognition-session.mts` | 9 | 60 秒预算的边界与"截止只管开新轮"（模拟整场会话恰好 6 轮且真实时长越过 60 秒）、去重键（两条 id 都空但同名同歌手算一首；同名不同 id 算两首）、重复命中返回**同一数组引用** |

基线数字（改动前后都要对上）：`npm test` **263 pass / 0 fail / cancelled 0 / skipped 0**（2026-10-11 持续识别会话并入时是 251，本轮并行识别 + 后台解析把 provider 的 11 条换成 10 条、新增 resolve 13 条）；`npx tsc --noEmit | grep -c "error TS"` == **137**（管道里的 tsc 在这台机器不打印 `Found N errors` 汇总，`grep -c` 是唯一正确的计数器）；本功能相关文件单独跑 eslint 必须无输出退出（全量 `npm run lint` 有约 1718 条**既有**问题，那是别人的基线，不要拿它当证据，也不要顺手修）。注意 **`.mts` 不在 lint 的覆盖范围内**（`lint` 脚本只 glob `.js,.jsx,.ts,.tsx`），所以测试文件的风格问题不会由 `npm run lint` 报出来，要单独 `npx eslint` 点名。三份 lang 的识曲键必须**逐键同名**且数量一致（当前每个语言 **668** 键，识曲键 18 个）。

**没有单测的部分（要如实说，不许拿 263/263 冒充覆盖）**：`RecognizePanel` 的会话循环、`ResultSections` 的歌曲条双分区、`AfpWasmView` 的 WebView 桥、以及 `resolveDeps` 里**真正联网的那三个适配器**（`musicSdk.wy.musicSearch` / `findMusic` / `toNewMusicInfo`）一行都没被 `npm test` 打到 —— `react-native-webview` 与 `react-native-fs` 在 `node --test` 下无法解析，面板又是这两个模块的直接使用者；而那三个适配器依赖真实音源模块，注入点恰好把它们挡在单测之外（这是**设计使然**：resolve 的单测证明的是"挑哪一行"，不是"搜得到歌"）。为这条链路背书的是：离线胶水逐字节对拍 + tsc/eslint/ Metro 全量打包 / `assembleDebug` 四道闸门 + 下面的真机清单。**新增这类代码时不要写"已测试"，要写"已被哪道闸门验过"。**

**每条防线都用变异验证收口**（实现期的固定做法，后续改动请沿用）：删掉那道新加的守卫，必须有一条测试变红，而且同一变异在修复前的 HEAD 上要**不**变红（否则那条测试本来就没测到东西）。纯 UI 接线做不到这一点，所以它的验收是真机清单，不是"看着没问题"。

**只能真机验的（不能拿单测结论代替）**：

- vivo（Android 16，无线调试）+ OPPO PCHM10（Android 11）各跑一遍完整流程
- 权限拒绝 → 重试；识别期间来电/切后台；外放自家歌曲自识别；安静环境下误触发
- **持续识别（2026-10-11 上午新增，只能真机验）**：① 外放一首歌再换另一首，列表应随会话进行逐条增长，且同一首连着命中只留一行；② 安静环境点圆盘，约一分钟后应落到「听了一分钟，没认出来」，期间**不出现**任何"没听出来"的中间提示；③ 每轮之间应有约 3.5 秒的放麦间隙（这是循环设计的直接后果，真机上是否表现为状态栏录音指示闪一下**尚未实测**，验收时顺便确认）；④ 会话中途退到后台应立刻结束 —— 不留错误文案、已认出的歌还看得见、回来不会接着偷偷听
- **并行识别 + 歌曲条结果（2026-10-11 下午新增；当天没有设备接入，以下每一条都尚未验过，不要拿单测结论冒充）**：
  - ① 同一轮里两个引擎都听到时，界面上应**同时出现两栏**，且两栏的先后与引擎数组一致（ncm 在前）。只有一路听到时，另一栏整个不出现。
  - ② 暗字占位行换成歌曲条时**列表不能跳**（两条行高都取自 `ITEM_HEIGHT`）；这是纯视觉效果，只能看屏。
  - ③ **点歌曲条要真能起播**，且与搜索页点行行为一致（进默认播放列表）。⚠ 验收时**不要开声音，或把系统音量压到 1 档**（用户明确提过的测试约束）。
  - ④ Shazam 那一栏解析出的歌条**必须真的来自五源搜索**（有封面/时长/来源音源），不能是一行假数据；查不到时应停在「还没查到这首歌，点一下去找」，点了确实会重跑去查。
  - ⑤ 连着命中**超过 5 首**时，第 6 首之后应该**只列出来、不自动去查**（行显示「还没查到这首歌，点一下去找」），点它能去查 —— 这条是流量上限唯一的越闸入口，必须真机确认它按预期生效（单测只能证明逻辑，证不了用户看不看得见）。
  - ⑥ 停止或退后台时，**已排队的解析会继续跑完**并把行补上（这是刻意的决定，理由见 §5）。验收要确认它表现为"过一两秒又长出来一条"，而不是"卡在正在找…"。
  - ⑦ 五源并发在弱网下的耗时与是否把 JS 线程堵住（识别循环与解析共用一个线程，这条是本次改动唯一可能影响"连续听"手感的实测项）。
- **入口转场改走应用内详情栈（2026-10-11 晚新增；同样一条都没验过）**：
  - ① 按下入口卡片的观感应是**底色先满屏、内容再出来**（与点歌单/排行榜入口一致），不再整页内容横推着盖过来。
  - ② 键盘要随按下收起（入口在搜索空白页，输入框通常还带着焦点）；没收干净的话键盘压在识曲页上，圆盘和结果区被挡住半截。
  - ③ 硬件 BACK 与页头返回箭头都该结束会话并回搜索页，且**没有**「页面走了还在录」的残留（看状态栏麦克风指示）。
  - ④ 会话进行中**切底部 tab** 会 reset 详情栈 ⇒ 面板卸载、会话结束。验收要确认这条路真的把录音停了（原生 `AudioRecord` 无 `stop` 日志），而不是留下一个后台还在跑的循环。
  - ⑤ 页面底部现在多了 `PlayerBar` 与 `BottomTabBar`：确认页脚那一句隐私说明（2026-10-12 之后只剩这一句）没被底栏压住，也确认结果区的 `maxHeight: '46%'` 在少了整屏高度之后仍然够用（可用高度比原生页时矮了一截）。
  - ⑥ **换了宿主之后隐藏 WebView 桥还能不能起 `ready`**：`AfpWasmView` 是 1×1 + `opacity: 0`，现在装在详情栈那个 `overflow: 'hidden'` 的容器里。这一条是整个 ncm 通路的前提 —— 桥起不来时点圆盘会只剩 Shazam 一路（结果区少一个分区），界面上不会报错，只能靠「网易云那一栏永远不出现」反推。
  - ⑦ 返回搜索页时它会被重新挂载成空白态（`Home/Vertical/Content.tsx` 在有详情路由时把 `Main` 整个卸掉）。入口只在空白页出现，所以丢的只是输入焦点与历史面板的滚动位置；确认这个代价可以接受。
- **入口卡片与识曲界面观感（2026-10-12 新增；当天仍无设备接入，以下一条都没验，全部只是代码与配色推算）**：
  - ① 入口卡片左侧那枚 34dp 实心主色圆徽（里面是反色声纹）：在**搜索页空白页**上要一眼看出它和热门搜索那些淡底胶囊不是一类东西，但又不至于像"误放的播放按钮"。⚠ 反色声纹对实心主色的对比按 17 套主题算过：`orange` 1.95、`pink` 2.52、`green` 2.71、`blue` 3.15、`black` 7.00 —— **前两档是最薄的，验收时专门切到 orange/pink 看这枚徽记还剩不剩形状**。
  - ② 圆盘按下之后必须**从淡底翻成实心主色**（改前 idle 与 busy 用的是同一个 token，实测两者底色对比 = 1.00，即盘面几乎不变，只靠声纹条变高）。这一条是本次观感改动的主张，只能看屏确认它真的被用户读成"开始听了"。
  - ③ 涟漪**一轮一圈**（约 9 秒一圈、2.2 秒扩散完）：观感上应是"机器又听了一下"的节拍，不是转圈 loading；并且系统「减弱动态效果」打开时涟漪要整个不出现（声纹条仍在动，那是改动之前就有的）。
  - ④ 圆盘半径从写死的 `84` 改成 `9999`：原写法不随 `createStyle` 的宽高换算走，**大屏（≈411dp 宽）与字体放大档下盘面会变成圆角方块**。验收要在 vivo 上确认是正圆，并把字体调到最大档再看一次。
  - ⑤ 停止改成描边胶囊后：确认它读起来是个按钮（不是被禁用的标签），且点它和点圆盘都能停；顺便确认它与实心圆盘之间层级没打架。
  - ⑥ 说明行从圆盘上方挪到状态行下面：空闲/结束是两行、正在听是一行 ⇒ 状态切换时圆盘会有一行高的上下位移，确认这个位移不刺眼（没有做高度占位，是刻意的取舍）。
  - ⑦ 结果区标题「听出来了」提到 15 号正色、引擎小标签仍是 11 号暗字（与底部 tab 标签同号）：确认两级层级拉开了，且标题不再和歌曲行的歌名抢注意力。
  - ⑧ `not_ready` 态圆盘现在 `disabled`（点下去没有任何反应、边框退回 `c-border-background`、声纹用暗字）：确认这台手机做不到的表达是"按不动"，而不是"坏了"。
  - 上面这批目前**装不进手机**（`adb devices` 为空）。2026-10-12 00:36 已用当前工作树打出含四批全部改动的 release 包（5 个 split，`xunyin-v1.1.0-arm64-v8a.apk`，`BUILD SUCCESSFUL in 2m2s`，产物内 `assets/index.android.bundle` 8,179,916 字节），并读了 APK 里的 bundle 做探针：本批删掉的 `music_recognition_tip` / `music_recognition_engines_hint` 命中 **0** 次，保留与新增的 `_resolving` / `_not_found_yet` / `_privacy` / `_listening` / `_found` 各 **1** 次，`isReduceMotionEnabled` **1** 次（该串在全仓 `src/` 里只在 `ListeningRing.tsx` 出现）⇒ 这批改动**确实在包里**，缺的只是把它装上按一遍。注：这个包仍带另一条工作线的未提交改动，签名回落 `debug.keystore`，只用于真机验收，不用于对外发布。
- WebView 版本差异：OPPO Android 11 的系统 WebView 能否稳定 `WebAssembly.instantiate` 308KB 模块
- Hermes 上 A 的指纹耗时
- 注：本项目真机环境里 adb 文本注入进不了 RN 输入框、toast 抓不到，所以验收看**屏内状态文本**，不看 toast

---

## 9. 风险与失效模式（拆开讲，不打包票）

| 风险 | 性质 | 应对 |
| --- | --- | --- |
| 网易单方面给接口加鉴权/下线 | **会一夜之间全量崩，无预告**。接口非公开、无 SLA | 热更新配置（可远程关引擎）+ 失败退避 + 失败文案不承诺。**2026-10-11 之后这条已不再是"单点全崩"**：两个引擎每轮**并行**问，网易那路挂了 Shazam 那路照样出结果（原设计的"B→A 降级"根本不用实现，并行天然就是降级）。剩余风险是**两路同时**上风控，那时客户端只剩退避 + 远端关停，没有任何缓冲 |
| 用户量增长提高被网易注意到的概率 | 结构性矛盾：免费无后端 = 用"不受保护"换"零成本" | 连续失败退避 + 不暴露批量调用入口 + 每一轮必须录满 8 秒、**一次点按只开一个 60 秒会话**。**注意 2026-10-11 的量级变化**：每轮从 1 笔变 2 笔，单次点按从 ≈6 笔变 **≈12 笔**，命中后还要后台跨音源找歌条（最坏一场 ≈37 笔，见 §4.5 的完整账）。**客户端日限已按用户裁定取消（2026-10-11）**，单设备不再有日量上限，残余风险见 §4.5 |
| `afp.wasm` 是网易专有二进制，随 APK 分发 | 法律暴露面真实存在，且**不能塞进用户导入脚本**（QuickJS 无 wasm） | 明确记录在案；若不能接受，退化为"只做 A"，代价是华语命中率下降 + 必须自实现 DSP |
| 自实现 Shazam DSP 有工作量与准确率风险 | 参照实现是 GPL-2.0，不能搬代码 | 二期已按公开算法描述自写并与参照实现对拍锁住（§8）；若日后找到 MIT/BSD 实现可直接替换 `shazamSignature.ts` 内部 |
| 两个引擎都是逆向通道 | 长期不确定性 | 调度层按 provider 数组设计，加引擎不动录音链路 —— 二期加 A 时这一点已被验证：数组、录音、面板三处均未改。**2026-10-11 删掉引擎标签之后这条更成立**：加第三个引擎只是在结果区多一个分区（`ENGINES` 里多一项 + 一个 `nameKey`），界面与状态机一行都不用动，因为面板本来就不认引擎 |
| 新增 `react-native-webview` | 依赖面积变大，与 RN 0.73.11 需选 v13.x | 已到 **安装包级**验证（13.6.4 autolink 进 `PackageList`、`assembleDebug` 通过）；**WebView 能否真跑起 wasm 仍未在设备上验**。若 OPPO Android 11 上不稳，回炉重评 wasm3 原生方案 |
| Shazam 境外端点在国内可达性 | 慢或部分网络不通 | 已实测：vivo 真机国内网络命中正常，含网络整次引擎调用 1.3~1.5s。超时落地 9s（与 B 路一致，原计划的 5s 会把慢网判成失败），失败落 `failed` 走退避而不是静默 |
| 华语翻唱/纯音乐/冷门曲 | 网易给的是翻唱原曲或错配 | **仍然没有"换个结果"的按钮**。现在能做的比第一期多：行本身就是可点的歌曲条，Shazam 那栏查不到时「点一下去找」会重跑一次五源匹配（见 §4.7）。但**匹配策略是固定的**（ncm 按 songmid → 歌名歌手相等；Shazam 取五源第一条），用户没法说"不是这首、给我换下一批候选"，最终出口仍然是自己退出识曲页去搜索 |
| **本次翻案新增：一次猜测现在一点就播** | 2026-10-11 把结果换成可播歌曲条之后，识别错配不再只是"看错一行字"，而是**点下去播了一首别的歌**（翻唱、纯音乐版、同名现场版都会播错） | 三条兜法：① Shazam 那路查不到**绝不**合成行，宁可不给可点的东西（§4.7）；② ncm 合成行只在**真的带回了网易歌曲 id** 时才允许，播出来至少是网易那首；③ 分区标题与页脚那句说明把"这是第三方听出来的"写在结构上。**没有做也不打算做的是"识别置信度阈值"** —— 两个引擎都不回置信度分数（网易的响应里没有、Shazam 免密钥通道给的 `nodes` 也拿不到可靠排序），编一个阈值等于自欺 |

**明确不承诺**：不承诺识别成功率、不承诺接口长期可用。功能定位是"锦上添花，随时可能暂时失效"。

---

## 10. 分期与工作量

**第 0 期（已完成，2026-10-10）**

0. 前端骨架：搜索页入口卡片 + 双标签识曲页（**双标签已在 2026-10-11 删除**，见下面的补记 10）+ `Waveform` 声纹组件 + 三语文案；`RecognizePanel` 停在"识别还没接入"态。

**第一期（可用闭环）**

1. `RECORD_AUDIO` + iOS 麦克风描述 + `AudioRecordModule`（Kotlin，原生工作量主要在这）
2. `PcmSplitter`（纯 TS）
3. 隐藏 WebView 容器 + 打补丁的 ISC 胶水 + `afp.wasm` 注入
4. `NcmEngine` + provider 调度 + 限流 + 热更新配置
5. ~~`store/musicRecognition` + 结果卡接到已落地的识曲页 → 走 `musicInfo`/`findMusic`~~ —— **两条出入**：store 判定不需要（§4.6），结果卡这一项由下面补记 10（2026-10-11 下午）落地，且 **B 命中没走 `musicInfo` 详情请求**（搜索结果行自带 `songmid`，§6）
6. 单测（§8 前半）+ 两台真机验收

**第二期**

7. `ShazamEngine` 自实现指纹 + 对拍测试 —— **已完成（2026-10-11，vivo 真机验收通过）**
8. 结果列表的"换个结果"手动校正

**补记（2026-10-11 上午，已完成）：交互改成持续识别**

9. 交互从"点一次录 8 秒、一个结果"改成**持续识别会话**：一次点按听约一分钟、认出的歌逐条累积、整分钟没认出才给一句超时。落地件是 `session.ts`（会话预算与去重，9 条单测）+ `RecognizePanel` 的轮循环 + `ResultList`；`ResultCard.tsx` 与 `_matching`/`_no_match`/`_again` 三个文案键同时删除。理由、代价（单次点按请求数 1 → ≈6）与"为什么不是一次录满 60 秒"见 §4.5、§5。

**补记（2026-10-11 下午，已完成）：双引擎并行 + 结果改成歌曲条**

10. 这次一起做了四件互相咬合的事，动因是用户那句"直接在识曲得到结果前界面不展示两个入口，统一接收音频后进行识别处理"：
    - **删掉引擎标签**（`index.tsx` 不再有 `engineId` / tabs，面板不再认引擎），代价是**远端 `engines` 数组成了单独关停某个引擎的唯一杠杆**（§4.5）。
    - **一轮并行喂两个引擎**（`provider` 返回 `{ hits, failure }`，`createSelectedEngine(id)` → `createActiveEngines()`）；理由与代价见 §4.5，`RecognizeOutcome` 这个类型随之被 `RecognizeRound` 取代。
    - **新增 `resolve.ts`：命中 → 可播歌曲条的后台解析**（§4.7）。第一期第 5 项设计的"`store/musicRecognition` + 结果卡走 `musicInfo`/`findMusic`"到这里才真正落地，但有两条出入：**没建 store**（§4.6 的理由依然成立），且 **B 命中没走 `musicInfo` 详情请求**（搜索结果行自带 `songmid`，见 §6）。
    - **`ResultList`（纯文字行）→ `ResultSections`（按引擎两栏 + 通用歌曲条 + 等高暗字占位行 + 点行起播 + `ListMenu`）**，§6 的"结果不落搜索"裁定被用户本次推翻（只推翻一半：仍不跳搜索页）。
    - 文案随之增删（删 4 个按引擎分的说明键、增 `_tip`/`_resolving`/`_not_found_yet`，三份 lang 各 668 键）。
    - **流量账是这次改动的主要代价**：单次点按 ≈6 笔 → ≈12 笔，加上后台解析后最坏一场 ≈37 笔（§4.5）。**真机验收一项都没做**（当天无设备接入），清单见 §8。

11. **补记（2026-10-11 晚）：入口转场统一成白底过渡。** 用户那句「把点击进入的过渡动画和其他统一为白底过渡」落地成：识曲页不再是原生 `Navigation.push` 屏幕，而是 `Home/DetailStack.tsx` 里的一条 embedded 路由（`homeDetailActions.push({ type: 'musicRecognition' })`），于是拿到和其他二级页一样的"底色先满屏、下一帧才出内容"。删掉的是 `MUSIC_RECOGNITION_SCREEN`、`registerScreens` 那一行、`pushMusicRecognitionScreen`、`src/screens/index.ts` 的导出；`index.tsx` 改收 `{ onBack }`，根节点从 `PageContent` 换成 `flex: 1` 的 `View`。**四条连带行为变化**（都只能真机复核，见 §8）：底部多了 `PlayerBar`/`BottomTabBar`；硬件 BACK 改由详情栈接走；**切底部 tab 会 reset 栈从而结束正在听的会话**；按下入口要主动 `Keyboard.dismiss()`（原生 push 会把键盘带走，同屏替换不会）。闸门数字不变：`npm test` 263、`npx tsc --noEmit` 137、改动文件 eslint 无输出、Metro 全量打包通过（产出的 bundle 里已经搜不到 `lxm.MusicRecognitionScreen`，新的 `musicRecognition` 路由字面量在）。

12. **补记（2026-10-12）：入口卡片与识曲界面观感重做。** 动因是先量了一遍旧界面：圆盘 idle 用 `c-button-background`、busy 用 `c-primary-background`，而这两个 token 在 `buildActiveThemeColors` 里是**同一个值**，17 套主题逐一套出来算底色对比全是 **1.00** —— 按下去之后盘面其实没变。改动集中在四处（详见 §4.6「过程 UI」与「入口」两条）：聆听态翻成实心主色 + 反色声纹，其余状态退回淡底；新增 `ListeningRing`，**每开始一轮采集呼出一圈**（节拍打在真实事件上，不是循环动效；系统减弱动效时整个不出现）；「停止」从裸文字改成描边胶囊；说明行从圆盘上方移到状态行下面、只在有空可填时出现；圆盘半径从写死的 `84` 改成仓库惯用的 `9999`（`createStyle` 不换算半径，大屏会成圆角方块）；`not_ready` 态圆盘禁用；入口卡片左侧换成一枚圆盘缩微版的实心主色声波圆徽、文案从三行减到两行。删掉 `_engines_hint` 与 `_tip` 两个键（"引擎"是系统词汇），三份 lang 各 **666** 键、识曲键 **16** 个。闸门复跑：`npm test` **263/263**、`npx tsc --noEmit` **137**（= 基线，识曲文件零错）、改动文件 eslint 无输出、Metro 全量打包 exit 0（8,347,059 字节，产物里 `music_recognition_engines_hint`/`music_recognition_tip` 出现 0 次）。**观感类改动一律证不了自己：当天仍无设备接入，这一批真机一项都没验**，清单见 §8 的「入口卡片与识曲界面观感」。其中最需要在屏上确认的两条是：实心主色盘上的反色声纹在 `orange`/`pink` 主题只有 1.95~2.52 的对比（其余档位 2.7~10.7），以及涟漪会不会被读成"卡住的 loading"。

13. 第二期第 8 项「换个结果」手动校正：**仍未做**。现在的出口只有"点一下去找"（重跑同一套固定匹配策略），没有"给我下一批候选"。

**第三期（可选）**

14. AudD / ACRCloud 作为**用户在设置里自填 key** 的选装引擎（默认关闭、UI 不宣传）——它们都不满足硬约束（AudD 送 300 次一次性、ACRCloud 14 天试用、讯飞送 500 次但 15 天过期、腾讯云必须配后端），所以只能是"用户自己的选择"，不能是"App 的承诺"。

---

## 11. 待用户拍板

1. 接受把网易专有 `afp.wasm` 打进 APK 吗？不接受则跳过第一期、直接做第二期的自实现 DSP（华语命中率会更差）。
2. 入口只放搜索页，还是同时放播放页"更多"菜单？
3. ~~每日识别上限 30 次是否合适~~ —— **已定（2026-10-11）：次数上限整体取消**。理由：每日额度本身就是一种会过期的额度，与"永久免费"这条硬约束直接冲突。挡量的职责交给连续失败退避（1s/5s/30s）、运营侧远端开关，以及交互自身的节流 —— 每轮必须录满 8 秒，且**一次点按只开一个 60 秒会话**。**但"会话预算"这个数字同一天之内涨过两次**：持续识别把单次点按从 1 笔抬到 ≈6 笔，下午的双引擎并行 + 后台解析又抬到 **≈12 笔（最坏一场 ≈37 笔，含解析）**。完整口径见 §4.5 的流量账，改交互时那个表要一起改。
4. 多语言文案范围：本项目 i18n 键数量大且有一致性基线，识曲文案要不要一次补全全部语言。
