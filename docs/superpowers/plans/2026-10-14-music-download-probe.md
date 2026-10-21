# 下载可行性探针（直链有效性 + 续传能力）

日期：2026-10-14
状态：**结论已出**（P1–P5 全部有实测答案，见 §6；设计文档 §4 §6 §7.2 §9 已按 §5 矩阵订正）
关联设计：`docs/superpowers/specs/2026-10-14-music-download-design.md` §6 §9

> 这份文档是"下载功能"立项前的**第一号 Task**。它不改产品代码，只回答五个问题；
> 结论会回头改写设计文档的落盘策略与队列策略。任何一条 P0 答案为"否"，下载功能要降级形态而不是硬上。
>
> 执行路径：Stage A（捞 logcat）判负 → Stage B（手机内探针）装上 v1 拿到了 wy 的全部结论，
> 但 v2 多源扫描**被 vivo 的 USB 安装确认拦下**（两次 `INSTALL_FAILED_ABORTED`，当时锁屏）→ 改走 **Stage C：PC 侧用 Node 垫片直接跑音源脚本**，
> 零装机拿到 kg/tx/kw/mg 的同类结论。临时探针代码已撤（`src/core/downloadProbe.ts` 已删、`src/core/init/index.ts` 已还原，`git grep downloadProbe` 无残留），
> **但设备上现在还跑着带探针 v1 的那枚包**，等能装机时换回干净包。

---

## 1. 探针要回答的五个问题

| # | 问题 | 为什么是它 | 失败时的后果 |
| --- | --- | --- | --- |
| P1 | 播放用的那条直链，能不能**整首**拉完（不是流媒体切片） | 播放器是"边流边播"，下载是"一次拿全"。有些链接只给前 30 秒 | 下载功能直接不成立 |
| P2 | 链接支不支持 **Range**（分段取，返回 206 而不是 200） | 决定能不能断点续传；不支持就只能整首重下 | 后台下载体验降级，断网即重头 |
| P3 | 链接的**存活时间**（TTL）有多长 | 30MB 的 flac 在手机上要几分钟；代码里没有任何过期记录（`src/utils/data.ts:519-529`） | TTL < 下载耗时 → 必须"每次下载前强制刷新链接" |
| P4 | 链接是否依赖 **UA / Referer / IP** | 现有下载靠注入移动端 UA 才跑得通（`src/utils/fs.ts:62-67`） | 原生服务必须自己带 header；IP 绑定则 PC 复放不可信 |
| P5 | 拿到的**实际格式与真实长度**（Content-Type / 扩展名 / Content-Length 可不可信） | 脚本可能返回 m4a 而音质标称 128k；Content-Length 可能缺失 | 文件名扩展名与"下完了没有"的判定规则要改 |

---

## 2. 数据来源：链接从哪来（已查实）

内置取链模块**全部注释**（`src/utils/musicSdk/api-source.js:3-34`），实际链路是：

```
player → getMusicUrl → handleGetOnlineMusicUrl (src/core/music/utils.ts:304)
       → musicSdk[source].getMusicUrl → apis(source).getMusicUrl
       → global.lx.apis[source].getMusicUrl (src/core/init/userApi/index.ts:88)
       → 你导入的音源脚本在 QuickJS 里发 HTTP → 回 { url }
```

所以探针测的就是**你现在听歌用的那条链接**，不需要新接口、不需要后端；
代价是：**能下的东西严格不超过脚本能给的东西**。脚本只给 128k，就下不到 flac。

---

## 3. Stage A：零代码探针（先做这个）

不改一行产品代码，不改包。已装的是 release 包且 `not debuggable`（`adb shell run-as` 已实测被拒），
所以不能读私有目录，只能靠日志。脚本侧的 `console.log` 会进 logcat：
`android/.../userApi/Console.java:17` → `Log.d("UserApi Log", ...)`。

### 3.1 捞链接

```bash
export PATH="$PATH:/e/Android/Sdk/platform-tools"
adb logcat -c
# 开始抓（后台跑 120 秒，落文件）
adb logcat -v time > /tmp/xunyin-play.log &

# >>> 此时在手机上：打开 App，在线播放一首歌，让它播满 30 秒 <<<

grep -oE 'https?://[^"'"'"' ,)]{25,}' /tmp/xunyin-play.log | sort -u | tail -30
```

捞到形如 `http://.../xxx.mp3?sign=...` 或带 `__ids=`、`timeout=` 参数的链接即成功。

**2026-10-14 实测：Stage A 判负，转 Stage B。**

- 设备：vivo V2302A（`192.168.137.81:34011`），已装 `cn.toside.music.mobile`。
- `adb shell run-as cn.toside.music.mobile` → `run-as: package not debuggable`，私有目录（含存直链的 AsyncStorage）读不到。
- 清空 logcat 后采 180 秒（期间 App 处于前台，`dumpsys media_session` 确认 `state=PLAYING(3)`，即**真的在播在线歌**）：抓到 756 行，其中 `UserApi Log` **0 行**、URL **0 条**。说明当前用的音源脚本不打印直链，日志这条路给不出链接。
- 但确认了一件重要的事：`adb shell ls /sdcard/Android/data/cn.toside.music.mobile/files` **可读**（当前为空）。→ 探针结果可以落到这个目录，再 `adb pull` 回来，不依赖 logcat 能不能收到 console。

### 3.2 测 P2/P3/P4（PC 复放）

把捞到的链接存成变量，**保留原样**（含 query）：

```bash
URL='把捞到的链接粘这里'
UA_MOBILE='Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Mobile Safari/537.36'

# (1) 只看头：有没有 Content-Length / Accept-Ranges / Content-Type
curl -sI -A "$UA_MOBILE" "$URL" | tr -d '\r' | grep -iE "content-length|accept-ranges|content-type|http/"

# (2) P2 续传：取前 1KB，期望 206 + Content-Range
curl -s -o /tmp/h.part -D - -A "$UA_MOBILE" -r 0-1023 "$URL" | tr -d '\r' | grep -iE "HTTP/|content-range|content-length"

# (3) P1 整首：真下载，比对字节数
curl -s -o /tmp/full.bin -A "$UA_MOBILE" -w "http=%{http_code} bytes=%{size_download} time=%{time_total}s\n" "$URL"
ls -l /tmp/full.bin && head -c 4 /tmp/full.bin | xxd   # 看文件头：ID3/FLAC/ftyp(RIFF)/Ogg

# (4) P4 UA 依赖：裸 UA 再来一次，看是不是 403
curl -s -o /dev/null -w "no-ua=%{http_code}\n" "$URL"

# (5) P3 TTL：等 5 分钟后再请求一次，看是否已经失效
sleep 300
curl -s -o /dev/null -w "after5min=%{http_code} bytes=%{size_download}\n" -A "$UA_MOBILE" -r 0-1023 "$URL"
```

判定：

- (2) 返回 **206** 且有 `Content-Range` → P2 通过；返回 **200** → 该源不支持续传。
- (3) `bytes` 等于 (1) 的 `Content-Length` → P1 通过；`bytes` 远小于、或 (1) 根本没有 Content-Length → 记为"流式链接，不可整取"。
- (4) 裸 UA 403 而带 UA 200 → P4 确认 header 依赖，原生服务必须自己带。
- (5) 5 分钟后从 206/200 变成 403/404 → TTL 在分钟级 → **下载前强制刷新链接**（`getMusicUrl({ isRefresh: true })`）从"可选"变成"必须"。
- (5) 依然 2xx → TTL 宽松，可以复用缓存链接，省一次取链开销。

### 3.3 PC 复放结果的可靠性检查（必做，否则结论是假的）

手机和 PC 在同一个 NAT 后面，出口 IP 大概率相同——但**不能假定**。所以：

- PC 复放 **成功** → 结论可信（链接确实给外部客户端用）。
- PC 复放 **403/404，而手机上还在正常播放** → 说明链接绑了设备/IP/单次使用，PC 结果**作废**，必须进 Stage B 在手机上测。

---

## 4. Stage B：手机内探针（Stage A 判负后启用，2026-10-14 定稿）

必须在手机上跑——链接可能绑 UA / IP，PC 复放的结果不可信（§3.3）。
只加**临时**代码，跑完就撤，不进主线提交；不改任何产品界面（不加按钮）。

### 4.1 触发与取材

| 环节 | 用什么 | 位置 |
| --- | --- | --- |
| 什么时候跑 | App 冷启动、音源脚本初始化完成之后自动跑一次 | `src/core/init/index.ts:54`（`await initUserApi(setting)`）之后插一行 |
| 拿哪首歌 | 播放历史里最近一条在线歌 | `getPlaylistHistory()` `src/utils/data.ts:298` |
| 拿链接 | 现成取链链路，不自己发请求 | `getMusicUrl({ musicInfo, isRefresh: false })` `src/core/music/index.ts:22` |
| 结果写哪儿 | 应用外置私有目录（adb 可读，已实测） | `RNFS.ExternalDirectoryPath` → `/sdcard/Android/data/cn.toside.music.mobile/files/probe.json` |

为什么不靠 logcat：release 包的 console 能不能进 logcat 不确定，文件是稳定通道。

### 4.2 探针要跑的六步（每步立刻落盘一次，中途被杀也留得住数据）

```ts
// src/core/downloadProbe.ts —— 临时文件，探针结束删除
type Probe = {
  song: { name: string, singer: string, source: string, quality: string }
  t0: number
  url?: string
  begin?: { statusCode: number, contentLength: number }   // ② RNFS downloadFile 的 begin 回调
  range?: { status: number, contentRange?: string, bytes: number }  // ③ P2 续传
  full?: { bytes: number, md5: string, seconds: number }  // ④ P1 整首 + P5 真实长度
  uaBypass?: { status: number, bytes: number }            // ⑤ P4 换 UA 还能不能拿
  ttl?: Array<{ at: number, status: number, bytes: number }> // ⑥ P3 TTL（+2/+5/+15 分钟）
  error?: string
}
```

1. **取链**：`getMusicUrl({ isRefresh: false })`，记 `url`、`t0 = Date.now()`。链接含 token，**只写进设备上的 probe.json，绝不提交、绝不贴进仓库**。
2. **整首下载**：`downloadFile(url, ExternalDirectoryPath + '/probe-full.bin', { begin, progress })`（走 `src/utils/fs.ts:62`，默认已注入移动端 UA）。从 `begin` 拿 `statusCode` 与 `contentLength` → **P5**。
3. **续传能力**：`fetch(url, { headers: { Range: 'bytes=0-1023' } })`，看 `status === 206` 且有 `Content-Range` → **P2**。返回 200 就是不支持。
4. **整首是否拉得完**：比较第 2 步落盘字节数与 `contentLength`；`RNFS.hash(path, 'md5')` 记指纹；`head -c 4` 由 PC 侧看文件头认格式（ID3 / fLaC / OggS / ftyp）→ **P1 + P5**。
5. **header 依赖**：同一 URL 再用**桌面 Chrome UA** 下一次 Range（前 1KB）→ **P4**。
6. **TTL**：`BackgroundTimer` 在 t0+2min / +5min / +15min 各重放一次 1KB Range，把 `status` 与字节数追加进 `ttl` 数组 → **P3**。这一段要求 App 别被杀；期间不要切走做别的。

### 4.3 收结果

```bash
export PATH="$PATH:/e/Android/Sdk/platform-tools"
adb pull /sdcard/Android/data/cn.toside.music.mobile/files/probe.json /tmp/   # 落在 /tmp，不进仓库
adb pull /sdcard/Android/data/cn.toside.music.mobile/files/probe-full.bin /tmp/
head -c 4 /tmp/probe-full.bin | xxd        # 认实际格式
```

### 4.4 代价与收尾（需要用户点头）

- 要**重新打一次包并 `install -r`**，会替换掉现在设备上那枚包（本地 assembleRelease，ETA **2–3 分钟**）。装机用的是 debug.keystore，`install -r` 不丢数据，但设备上正在复核的那版会暂时被探针版顶掉。
- 探针跑完：删掉 `src/core/downloadProbe.ts`、撤掉 `src/core/init/index.ts` 那一行，`git status` 确认无残留，再重新打一枚干净包装回去。
- 临时改动**不提交**。

---

## 4.5 Stage C：PC 侧直接跑音源脚本（装机被拦后启用，已跑通）

Stage B 需要 `install -r`，但 vivo 的 USB 安装要人在屏幕上点确认，两次都 `INSTALL_FAILED_ABORTED`，
而手机当时锁屏。于是换了一条**零装机**的路：音源脚本只是普通 JS，只依赖 `globalThis.lx` 的少数几个 API，
在 Node 里补一个垫片就能跑，取到的直链和手机上一模一样，取完之后在 PC 上量 Range / TTL。

- 垫片只需要：`EVENT_NAMES`、`on`、`send`、`request(url, options, cb)`、`utils.crypto.{md5,aesEncrypt}`、
  `utils.buffer.bufToString`、`version`、`currentScriptInfo.rawScript`。把 `version` 置空，脚本会走
  `mode.split('-').pop()` 与纯 JS 的 hex 分支，省掉一半适配面。
- 歌曲 id 用各平台**公开搜索接口**在 PC 上现取（同一首歌 周杰伦–晴天 269s，在 kg/tx/kw/mg 各拿到真实 id 与每档声明大小），
  这样"脚本给的链接"和"平台自己声明的文件大小"能互相对账。
- 全首只测**头尾与长度**，不追求把 30MB 存下来；结果与 URL 只落在
  `AppData/Local/Temp/xunyin-probe/`，**含 token 的链接一个字都没进仓库**，文档里只留主机名。

### 4.5.1 测到的硬事实

- **P1 整首能下**：kg / tx / mg / kw 的 CDN 直链都能按 Content-Length 精确取完（wy 之前在手机侧已验过，字节数与 MD5 都对得上）。
- **P2 续传**：五源全给 `206` + `Content-Range`，没有一把是 200。断点续传按标准能力设计。
- **P4 header 无关**：移动端 UA / 桌面 UA / 不带 UA 三种请求在 kg、tx、mg 上都 206。
  → 原生服务仍要自带 UA（`src/utils/fs.ts:62-67` 的现状），但**不能把"UA 不对所以失败"当默认解释**。
- **P5 长度可信、格式不可信**：Content-Length 一直等于真实长度；但**扩展名不能按 URL 尾巴或 Content-Type 定**：
  tx 的 flac（`F000….ape` 那种命名）有后端报 `audio/x-ogg`；kw 同一档有 mp3 也有 ogg（320k 给 5,860,576B 的 ogg）。
  → 落盘格式只能**看文件头字节**（`ID3` / `fLaC` / `OggS` / `ftyp`）。
- **★ 同一次请求可能是试听片段**：tx 走"越权"后端时，128k/320k/flac **四档都返回同一条 `RS02….mp3`，长度 960,887B（≈24–60 秒）**；
  换一次调用又可能拿到 M500/M800/F000 的**完整曲**（4,317,292 / 10,792,943 / 55,397,039，与平台搜索元数据 `size128/size320/sizeflac` 逐字节相等）。
  → **"链接解析成功"≠"下载成功"**。下载器必须拿"实到下字节数"和搜索元数据里那档声明的 size 对账，对不上就重新取链，
    而不是把 24 秒片段当成 320k 成品存进音乐库。
- **★ 有后端会拿 200 返回 JSON 错误页**：某聚合脚本的 kg 后端 `200 OK` 但 `Content-Type: application/json`，
  同一脚本的 tx 代理 403、mg 代理 404。
  → 只判 `statusCode === 200` 会把错误页存成 mp3。**必须校验音频文件头**再发布。
- **kw 的可用性取决于脚本，不是平台**：星澜 v4.0.0 八次全给同一个死代理（`175.27.166.236:8928` → 400），
  而星海 v2.3.13 / 溯音 v1 / HYW 公益版都给 `car-er.kuwo.cn` / `kw-er.kuwo.cn` 的 206 真链接（长度同样 4,317,292 / 10,792,943）。
  另有一次 `kw-er.kuwo.cn` 直接 **410 Gone**。
  → 队列要允许"**换后端重取链**"，并且把 410/403 归为"链接作废"而不是"网络坏了"。
- **免费档就给你免费档**：不带 cookie 时 tx/kw 的最高可用档是 flac/320k，但同一首歌在不同后端的档位映射并不严格一致
  （HYW 的 tx "128k" 实际返回 M800 即 320k 文件）。→ 音质面板要按**下完之后实测到的字节/格式**回写，不能按请求的那档吹牛。

---

## 5. 结果 → 设计决策矩阵（跑完照此改设计文档）

| 探针结论 | 设计怎么改 |
| --- | --- |
| P1 否（整首拉不完） | 下载功能降级为"离线听歌缓存"，设计文档 §1 目标与验收标准全部重写，考虑不立项 |
| P2 否（不支持 Range） | 去掉断点续传；`.part` 改名 `tmp` 且重下即清空；设计 §6 续传段删除；进度条允许倒退 |
| P3 短（TTL < 约 3 分钟） | 每个任务起手一律 `isRefresh: true`；重试预算从 3 次降到 1 次；并发上限默认从 2 降到 1（减少同批链接过期） |
| P4 依赖 header | `DownloadModule.startTask` 的 payload 必带 `headers`，原生侧不许用默认 UA |
| P5 格式与标称音质不符 | 扩展名以 URL 尾巴 + Content-Type 为准，`LX.Download.FileExt` 需要加 `m4a`/`ogg` |
| 五源之间结论不一致 | 按 source 记录差异，音质面板对"已知下不动"的档位直接置灰 |
| **实测已命中：给完整曲的同时夹带试听片段** | P1/P5 的判定不能只看"下完了"，要**与搜索元数据那档声明的 size 对账**；对不上就重取链，两次仍不符就判失败并告知用户"这个源只有试听"。设计 §6 落盘校验、§7 音质面板都要加这一关 |
| **实测已命中：200 返回 JSON 错误页** | 发布前的校验只看**文件头魔数**，不看 statusCode；魔数不认识就丢弃临时文件并重取 |
| **实测已命中：410 / 403 直接作废** | 失败分类要区分"链接作废"（→重取链，不换源）与"网络断了"（→挂起等网络）；两者 UI 文案不同 |
| **实测已命中：同一档不同后端给不同格式** | `FileExt` 由实际魔数决定（`mp3/m4a/ogg/flac`），且 `LX.Download.Item` 要记 `实际格式` 供离线播放恢复时用 |

---

## 6. 记录表（跑完填，填进设计文档 §9）

| 源 | 档位 | 文件大小 | Content-Length 可信 | Range 206 | TTL | 裸 UA | 实际格式 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wy | 320k | 2,160,893 | ✅ 精确 | ✅ | +5min 仍 206，**约 12min 后 403** | 不影响（206） | mp3（`ID3`） | 手机内探针（never meant to hurt you）；`m801.music.126.net`；RNFS 回报的 mimeType 是 `application/octet-stream`，与真实格式无关 |
| kg | 128k | 4,317,292 | ✅ | ✅ | **+16min 仍 206** | 206 | mp3 | 与搜索元数据 `FileSize` 逐字节相等 |
| kg | 320k | 10,792,943 | ✅ | ✅ | +16min 仍 206 | 206 | mp3 | = `HQFileSize`；**下完的 MD5 直接等于 `HQFileHash`**，白送一道完整性校验 |
| kg | flac | 31,633,244 | ✅ | ✅ | — | 206 | flac | = `SQFileSize` |
| tx | 128k | 4,317,292（`M500…`） | ✅ | ✅ | +16min 仍 206 | 206 | mp3 | = `size128` |
| tx | 320k | 10,792,943（`M800…`） | ✅ | ✅ | +16min 仍 206 | 206 | mp3 | = `size320` |
| tx | flac | 55,397,039（`F000…`） | ✅ | ✅ | — | 206 | flac | = `sizeflac`；**有后端把这条报成 `audio/x-ogg`**，Content-Type 不可信 |
| tx | 任意档（试听） | **960,887（`RS02…mp3`）** | ✅（长度诚实） | ✅ | +16min 仍 206 | 206 | mp3 24–60s | ★128k/320k/flac/flac24bit **四档返回同一条片段链接**；换个后端又给整首 → 只能靠"与声明 size 对账"识破 |
| kw | 320k | 10,792,943 | ✅ | ✅ | +16min 仍 206 | 206 | mp3 | `car-er.kuwo.cn`；**同一脚本（星澜）八次给的都是死代理 `:8928` → 400**，星海/HYW/溯音才给 CDN；另见一次 **410 Gone** |
| kw | 128k | 4,317,292 | ✅ | ✅ | — | 206 | mp3 | 同档另一后端给的是 **ogg 5,860,576B** → 同一"128k"可以是两种封装 |
| mg | 320k | 10,792,962 | ✅ | ✅ | +16min 仍 206 | 206 | mp3 | `freetyst.nf.migu.cn`，URL 长 562 字符 |
| mg | flac | 31,529,675 | ✅ | ✅ | — | 206 | flac | |

五源合起来对五个问题的回答：**P1 是**（整首能按 Content-Length 取完，但存在"整首"其实是试听的坑）；**P2 是**（无一例外 206 + `Content-Range`）；**P3 分钟级**（wy 5–12min，其余四个 16min 未死 → 起手强制刷新，且不能假设重取一定换新链）；**P4 否**（三种 UA 结果一致，链接没绑 UA）；**P5 长度可信、格式与档位都不可信**（Content-Length 一直准，封装与"这是哪一档"必须由落盘字节嗅探 + 与声明 size 对账决定）。

---

## 7. 明确不在本探针范围内

- 前台服务能否活过息屏、安卓 15+ 的 `dataSync` 6 小时限制（那是设计文档 §9 里另外两条"待真机验证"，属于第二阶段探针）。
- MediaStore 发布后自带"音乐"App 是否索引（同上）。

这两项要在链接结论出来之后再做，否则白搭一次构建。
