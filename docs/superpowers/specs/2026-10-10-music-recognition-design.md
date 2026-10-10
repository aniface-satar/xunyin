# 听歌识曲（B 主 A 兜底）设计文档

日期：2026-10-10
状态：待用户复核
约束来源：AGENTS.md（竖屏锁定，本功能不触碰任何方向相关 API）

---

## 1. 目标与范围

**目标**：用户在 App 内点一下，录几秒环境音，识别出"这是哪首歌"，然后把这首歌接进现有的音源链路（播放 / 稍后播放 / 加入歌单）。

**非目标（本期明确不做）**：

- 不做识别历史记录、收藏、导出录音（Audile 那种独立识曲 App 的定位，不是本 App 的定位）
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

- 接口：`POST https://amp.shazam.com/discovery/v5/en/US/android/-/tag/{uuid}/{uuid}`，JSON body，签名塞在 `signature.uri = data:audio/vnd.shazam.sig;base64,...`
- 同样 **无 key、无 cookie**，UUID 随机生成
- 实测：8/8 请求成功，含本地指纹计算的总耗时平均 779ms
- **同一音频样本上两次给出错误歌名**（12s 窗 → "Home Alone"，4s 窗 → "Here With Me"，真值是"浆果/TINY7"）
- 窗口：4s 可用，12s 上限，**≥15s 必然失败**；上传体积 4.9 KB
- 指纹算法公开且有纯 JS 实现（1024 点 FFT + 4 频带峰值对哈希 + HSPG 封装），但参照实现是 **GPL-2.0**

### 2.3 由实测得出的三条设计取向

1. **B 当主力**：华语命中率实测优于 A，且返回网易云歌曲 ID（可跳过模糊搜索）。
2. **A 当兜底**：两者失效面不重合（境内 CDN vs 境外端点；华语库 vs 海外库）。
3. **A 的成本几乎全在"自己实现 DSP"**（参照实现是 GPL，不能搬进 Apache-2.0 的本项目），所以 A 排第二期，B 排第一期。

> 这一条修正了口头讨论时"第一期只做 A（风险最低）"的建议。修正原因：后续实测发现 B 的 JS 胶水是 **ISC 许可**（`ncm-audio-recognize@1.4.0`，可自由修改分发）、只依赖 `WebAssembly` 一个全局对象、且 `48kHz` 只是胶水里的断言（真实输入是每 6 个样本取 1 的 8kHz 数组）。B 的落地成本因此远低于 A 的自实现 DSP。残余风险只剩那个 231KB 的专有二进制。

---

## 3. 架构总览

```
[搜索页麦克风按钮]
        |
        v
  store/musicRecognition  ---- 状态机：idle / permission / recording / fingerprinting / matching / result
        |
        v
  原生 AudioRecordModule (Kotlin)  -- 唯一录音点，48kHz 单声道 PCM16，滚动缓冲
        |
        +---> PcmSplitter：
        |        (a) 每 6 个样本取 1 -> Float32Array(8kHz)   喂 B
        |        + (b) 31 抽头低通 + 每 3 个取 1 -> Int16Array(16kHz)  喂 A（二期）
        |
        +---> [B] NcmEngine：隐藏 WebView 跑 afp.wasm -> rawdata(2KB) -> fetch 网易接口
        |
        +---> [A] ShazamEngine：纯 JS 指纹 -> fetch amp.shazam.com      （二期）
        |
        v
  RecognitionResult { name, singer, neteaseSongId?, confidence }
        |
        +-- 有 neteaseSongId -> wy/musicInfo.js 按 ID 取详情 -> 直接生成 musicInfo
        +-- 无 ID            -> musicSdk.findMusic() 跨全部音源模糊匹配
        v
  现有搜索结果列表 / MusicAddModal（零改动复用）
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
- `react-native-webview` 是本仓库当前**完全没有**的依赖（`package.json` 已核）。选 v13.x 以匹配 RN 0.73.11。

---

## 4. 组件与接口

每个单元的契约：它做什么 / 怎么调用它 / 它依赖什么。

### 4.1 `AudioRecordModule`（新增 Kotlin 原生模块）

- **做什么**：一次性录 N 秒（默认 8s）麦克风音频，返回 48kHz 单声道 PCM16 字节。不做流式、不做后台、不做前台服务。
- **怎么用**：`startRecord(seconds): Promise<base64>`；内部用 `AudioRecord`（`采样率 48000`、`CHANNEL_IN_MONO`、`ENCODING_PCM_16BIT`，均为 Android 通用能力）。
- **依赖**：新权限 `android.permission.RECORD_AUDIO`（运行时申请）；`AndroidManifest.xml` 现有权限列表在 `android/app/src/main/AndroidManifest.xml:5-20`，**不含 RECORD_AUDIO**，需新增。
- **范式来源**：照抄同目录 `audioFeature/AudioFeaturePackage.java` 的 Package/Module 写法，并注册进 `MainApplication.java:36-43`。
- **隐私硬要求**：只在用户主动点击后录音，到达设定时长立即停止并释放 `AudioRecord`；不落盘、不加"继续录"选项。

### 4.2 `PcmSplitter`（纯 TS，无依赖）

- **做什么**：把 48kHz PCM16 转成两路引擎要的格式。录音固定 8 秒，B 取 `from=1s, len=6s` 窗口（对齐官方插件 `from=4s,len=6s` 的"跳过开头"思路，开头 1 秒用于避开点击噪声），A 用整段 8 秒（实测 4–8s 均可命中，且不超过 12s 上限）。
  - B 路：`float[i] = pcm[from*8000*6 + i*6] / 32768`，`i` 取 `0 .. len*8000-1` —— 索引公式与胶水 `toNCMBuffer` 的 `buf[now*48000/8000 + from*48000]` 等价
  - A 路：低通 + 3:1 抽取到 16kHz int16
- **为什么不能各自录一次**：Android 10 起同一设备开第二个 `AudioRecord` 客户端，在相当一部分机型上会被静音或降权。**全程只允许一次采集**。
- **测试**：索引对齐和归一化边界用固定 fixture 做单测（见 §8）。

### 4.3 `NcmEngine`（B，第一期）

- **做什么**：48k PCM → `rawdata` 字符串 → 请求网易接口 → 解析结果。
- **对外**：`recognize(pcm: Float32Array, opts): Promise<EngineResult | null>`
- **内部**：一次性初始化隐藏 WebView（挂载即创建、识别完不销毁，避免每次 300KB 注入）；WebView 内跑打了补丁的 ISC 胶水（wasm 加载改成注入字节）。
- **返回结构**（实测）：`data.result[] -> { startTime, song: { id, name, artists[].name, album: { name, id, picUrl } } }`；无命中时 `data.result = null` 且带 `data.noMatchReason`。
- **依赖**：`react-native-webview`、`afp.wasm`（放 `android/app/src/main/assets/` 或 JS bundle 资源目录）、`src/utils/request.js:20 httpFetch`。

### 4.4 `ShazamEngine`（A，第二期）

- **做什么**：16kHz int16 → 自实现指纹 → `amp.shazam.com` → 解析。
- **指纹实现**：按公开算法描述自写（1024 点 FFT、Hann 窗、4 频带、峰值对哈希、HSPG 编码 + CRC）。**禁止拷贝 GPL-2.0 参照实现的代码**；参照实现只用于本机对拍生成基准，不进仓库、不作依赖。
- **性能预算**：4s 窗口在 Hermes 上目标 < 1.5s（中端机），超出则在录音结束时预热计算而非等用户。
- **返回结构**（实测）：`track.title / track.subtitle / matches[].{timeskew,frequencyskew}`，无国内音源 ID。

### 4.5 `provider` 调度层（`src/core/musicRecognition/`）

- **做什么**：把引擎变成可插拔数组，按优先级串行降级。
- **调用顺序**：B → A（A 上线后）。第一个命中即返回，不再等后续引擎。
- **限流**：单设备每日上限 **30 次**（本地计数，按自然日重置）；连续失败按 `1s/5s/30s` 退避；同一段 PCM 的重复识别走内存缓存。
- **热更新配置**：从项目现有 GitHub/Gitee 仓库的 raw 地址拉一个 `recognition-config.json`（静态文件，走 CDN，**不是后端**），字段限定为 `{ version, engines: [{ id, enabled, endpoint, params }] }`，并做**域名白名单**校验（只允许网易/苹果官方域，防止这个文件被改成任意 URL）。拉取失败用内置默认值。
- **意义**：接口改路径/加参数时改一次提交即可全量生效，不必等应用市场审核。

### 4.6 状态与 UI

- **状态**：本仓库不用 zustand/redux，是模块级 state + `global.state_event`（`src/config/globalData.ts:81`，订阅范式见 `src/store/common/hook.ts:5-17`）。新建 `src/store/musicRecognition/{state,action,hook}.ts`，仿 `src/store/search/music/`。
- **入口**：搜索页头部 `src/screens/Home/Views/Search/HeaderBar/index.tsx` 加麦克风按钮。选它的理由：识曲结果天然就该落到现成的搜索结果列表，用户不需要理解"两个界面"。
- **过程 UI**：录制的 8 秒用波纹动画（本项目已有 morph/动画基建，沿用现成时长与曲线，不新造动画体系）；进度文案分三段："正在听…"/"正在匹配…"/"没听出来"。
- **结果卡**：歌名、歌手、专辑、封面；主按钮"找这首歌"；次按钮"稍后播放"。
- **失败文案（重要）**：写"识曲能力由第三方提供，可能暂时不可用"，**不要**写成服务承诺语气。

---

## 5. 数据流与状态机

```
idle --点麦克风--> permission(仅首次) --已授权--> recording(8s, 可提前停止)
recording --得到PCM--> fingerprinting(B: 注入WebView并算 rawdata)
fingerprinting --rawdata--> matching(B 请求 365ms 量级)
matching --命中--> result
matching --未命中/异常--> matching(A 引擎, 二期) --> result | nomatch
result --点"找这首歌"--> 关识曲浮层 + 走搜索链路
```

- 全程 UI 阻塞在一个浮层里，用户可随手取消；取消即 `AudioRecord.stop()` 并丢弃缓冲。
- `fingerprinting` 与 `matching` 之间不缓存 PCM（内存里用完即弃），只缓存指纹字符串 10 分钟。

---

## 6. 结果落地（两条路径，取决于有没有歌曲 ID）

1. **B 命中（有网易云 `song.id`）**：直接 `src/utils/musicSdk/wy/musicInfo.js:6`（按 ID 取详情）生成 `musicInfo`，再交给 `src/utils/musicSdk/index.js:74 findMusic(musicInfo)` 找其它音源的对应版本。比纯歌名匹配稳得多，因为起点是 ID 而非字符串。
2. **A 命中（只有歌名+歌手）**：直接 `src/utils/musicSdk/index.js:62 searchMusic({name, singer, limit})`，跨全部音源并发搜索，复用现有结果列表与排序逻辑。

两条都收敛到现成的 `MusicAddModal` / 播放逻辑，**下游零改动**。

---

## 7. 权限与隐私

- 新增 `RECORD_AUDIO`（Android）与 `NSMicrophoneUsageDescription`（iOS，当前 `ios/LxMusicMobile/Info.plist` 只有定位描述）。
- 拒绝授权：给出一次性说明 + 跳设置，不反复弹窗。
- 上传内容：**只有指纹（2–5 KB），不上传录音**。这句要写进功能说明，是实打实的隐私卖点。
- 不做任何录音落盘、不做识别历史列表（少存少错）。
- 调试日志按本项目惯例加 `__DEV__` 门控（release 构建不剥 console，历史上踩过）。

---

## 8. 测试策略

**能进单测的（本地可复现，必须写）**：

- `PcmSplitter`：48k→8k 取样索引 == 胶水公式；48k→16k 低通后能量分布；`/32768` 归一化边界（-32768 不溢出）
- 结果解析：用两份**脱敏存档响应**（网易 `result[]` 正常/`noMatchReason` 未命中各一份；Shazam `track` + `matches` 一份）做 contract 单测，mock 掉 `httpFetch`
- 调度层：B 命中就绝不发 A 请求；B 抛异常要降级到 A；日限 30 次的计数与跨自然日重置；退避序列 `1s/5s/30s`；热更新配置的域名白名单拒绝非白名单 endpoint
- 指纹自实现（A，二期）：与本机参照实现对拍 `ExtractQueryFP` 之前的采样数组与最终哈希峰值，逐帧 diff

**只能真机验的（不能拿单测结论代替）**：

- vivo（Android 16，无线调试）+ OPPO PCHM10（Android 11）各跑一遍完整流程
- 权限拒绝 → 重试；识别期间来电/切后台；外放自家歌曲自识别；安静环境下误触发
- WebView 版本差异：OPPO Android 11 的系统 WebView 能否稳定 `WebAssembly.instantiate` 308KB 模块
- Hermes 上 A 的指纹耗时
- 注：本项目真机环境里 adb 文本注入进不了 RN 输入框、toast 抓不到，所以验收看**屏内状态文本**，不看 toast

---

## 9. 风险与失效模式（拆开讲，不打包票）

| 风险 | 性质 | 应对 |
| --- | --- | --- |
| 网易单方面给接口加鉴权/下线 | **会一夜之间全量崩，无预告**。接口非公开、无 SLA | B→A 降级 + 热更新配置 + 失败文案不承诺；这是本方案不可消除的固有代价 |
| 用户量增长提高被网易注意到的概率 | 结构性矛盾：免费无后端 = 用"不受保护"换"零成本" | 客户端日限 30 次 + 退避 + 不暴露批量调用入口，让单设备流量特征贴近"人手动点几下" |
| `afp.wasm` 是网易专有二进制，随 APK 分发 | 法律暴露面真实存在，且**不能塞进用户导入脚本**（QuickJS 无 wasm） | 明确记录在案；若不能接受，退化为"只做 A"，代价是华语命中率下降 + 必须自实现 DSP |
| 自实现 Shazam DSP 有工作量与准确率风险 | 参照实现是 GPL-2.0，不能搬代码 | 放二期；若日后找到 MIT/BSD 实现可直接替换 `ShazamEngine` 内部 |
| 两个引擎都是逆向通道 | 长期不确定性 | 调度层按 provider 数组设计，加引擎不动 UI 与录音链路 |
| 新增 `react-native-webview` | 依赖面积变大，与 RN 0.73.11 需选 v13.x | 第一期落地即验证；若 WebView 路线在 OPPO 上不稳，回炉重评 wasm3 原生方案 |
| Shazam 境外端点在国内可达性 | 慢或部分网络不通 | B 优先（境内 365ms）；A 超时设 5s 直接放弃 |
| 华语翻唱/纯音乐/冷门曲 | 网易给的是翻唱原曲或错配 | 结果卡同时展示歌名歌手，让用户可点"换个结果"走 `searchMusic` 自行校正 |

**明确不承诺**：不承诺识别成功率、不承诺接口长期可用。功能定位是"锦上添花，随时可能暂时失效"。

---

## 10. 分期与工作量

**第一期（可用闭环）**

1. `RECORD_AUDIO` + iOS 麦克风描述 + `AudioRecordModule`（Kotlin，原生工作量主要在这）
2. `PcmSplitter`（纯 TS）
3. 隐藏 WebView 容器 + 打补丁的 ISC 胶水 + `afp.wasm` 注入
4. `NcmEngine` + provider 调度 + 限流 + 热更新配置
5. `store/musicRecognition` + 搜索页麦克风入口 + 结果卡 → 接 `musicInfo`/`findMusic`
6. 单测（§8 前半）+ 两台真机验收

**第二期**

7. `ShazamEngine` 自实现指纹 + 对拍测试
8. 结果卡"换个结果"手动校正

**第三期（可选）**

9. AudD / ACRCloud 作为**用户在设置里自填 key** 的选装引擎（默认关闭、UI 不宣传）——它们都不满足硬约束（AudD 送 300 次一次性、ACRCloud 14 天试用、讯飞送 500 次但 15 天过期、腾讯云必须配后端），所以只能是"用户自己的选择"，不能是"App 的承诺"。

---

## 11. 待用户拍板

1. 接受把网易专有 `afp.wasm` 打进 APK 吗？不接受则跳过第一期、直接做第二期的自实现 DSP（华语命中率会更差）。
2. 入口只放搜索页，还是同时放播放页"更多"菜单？
3. 每日识别上限 30 次是否合适（太紧会影响重度用户，太松会放大被风控的概率）？
4. 多语言文案范围：本项目 i18n 键数量大且有一致性基线，识曲文案要不要一次补全全部语言。
