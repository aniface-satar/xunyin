# Wave 1 · Lane A 任务书 —— S2 排行榜 tx/wy/mg 榜单详情（收口 + 补全）

> 本文件是 Lane A 会话的唯一任务指令。开始前先读 `docs/waves/RULES.md` 与本文全文。
> 2026-10-25 按波前快照状态重写（旧版 Lane A 的 S1 五源搜索接线已由 B5 第八切片完成，作废）。

## 背景

B5 第九切片已完成 kw/kg 榜单详情与本地分页；主仓库在被叫停的排行榜会话里留下了
**半成品** `TxLeaderboard.kt` / `WyLeaderboard.kt` / `WyWeapi.kt`（未接进运行时、无测试），
`MgLeaderboard.kt` 完全没有。`LeaderboardRuntime.kt` 目前对 tx/wy/mg 的 `getListDetail`
仍返回「未接入」。本 lane 把这三个源的榜单详情收口。

## 任务

1. **先审计快照里的半成品**：`TxLeaderboard.kt` / `WyLeaderboard.kt` / `WyWeapi.kt`
   逐条对照 RN `src/utils/musicSdk/tx/leaderboard.js`、`wy/leaderboard.js`
   （tx：`c.y.qq.com` HTML period 抓取 → `musicu.fcg` GetDetail；
   wy：weapi 加密链 → searchMusicListByRanks → musicDetail 两段）。
   判定可用/需修/需重写，结论写 lane 报告「语义修正」节。
2. **实现 MgLeaderboard**：对照 RN `src/utils/musicSdk/mg/leaderboard.js`
   （`filterMusicInfoList` 链路、`sqsong/getDataByTag` 参数与翻页语义）。
3. **接进运行时**：`LeaderboardRuntime.kt` 的 `isDetailSupported/getListDetail`
   覆盖 tx/wy/mg，移除「该源的榜单详情暂未接入」提示；传输沿用现有
   HttpURLConnection 模式（tx 的 HTML 抓取需要按文本返回，必要时在 runtime 补一个
   fetchHtml 注入口）。
4. **黄金测试**：五源真实响应落盘 fixture 的做法照旧（kw/kg 已示范）——
   在本机用公开接口实际抓取 tx/wy/mg 各一个榜单的第一页响应原样落盘；
   某接口在本机不可达时改用合成 fixture 并在报告注明。
   解析/映射/翻页每个源至少 3 用例（正常、空/错误码门禁、字段缺失容错）。
5. **UI 验证**：`LeaderboardDetailPage` 对新三源的展示（序号高亮、加载更多、
   播放入口走临时列表链路）——只许改 `ui/leaderboard/` 内的行，导航路由不动。

## 范围（只许改这里）

- `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/`（整个目录，
  含审计与修改 Tx/Wy/Mg 三个文件）
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/LeaderboardRuntime.kt`
- `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/ui/leaderboard/`
- 新增测试与 fixture 放对应包（`core/src/test/.../music/leaderboard/` 等）

## 禁触

- `core/.../music/search/`（只许 import `SearchRequest` 等既有类型，不许改）
- `core/.../crypto/`（只调用，不改；weapi 若缺能力，用私有辅助函数放 leaderboard 包内解决并记录）
- `core/.../setting/`、`ui/settings/`、`userapi/`（Lane B 范围）
- `ui/play/`、`core/.../lyric/`、`core/.../player/`（Lane C 范围）
- `AndroidManifest.xml`、`.github/`、gradle 与版本目录

## 验收

- `cd android-native && gradlew.bat ktlintCheck test assembleDebug` 全绿；
- tx/wy/mg 榜单详情在 `LeaderboardRuntime` 真实可用（不再返回未接入提示）；
- 每源至少 3 个 JVM 用例 + 真实/合成 fixture；
- lane 报告按 RULES.md 模板追加到本文件末尾并 commit。

## 真机验收清单（写进报告，由用户执行）

- tx 榜点开能看到当期歌曲（period 抓取成功）、wy 榜两段链取到完整元数据、
  mg 榜翻页与去重观感与 RN 一致；
- 三源「播放全部」→ 临时列表起播 → 后台补全全表。

---

## Lane 报告（2026-10-25）

- **结论**：完成。任务 1–4 全部落地（半成品审计→修正、MgLeaderboard 新建、
  三源接进 `LeaderboardRuntime`、每源 ≥3 条 JVM 用例 + fixture）；
  任务 5（UI 验证）核对后**无需改 `ui/leaderboard/`**——`LeaderboardDetailPage`
  只消费 `id/name/singer` 与 `BoardPager` 的 30 条展示分页，三源产出形状一致；
  唯一的「未接入」提示在范围外的 `ui/HomePage.kt`，见遗留问题 1。
- **commit**：`babefae`；测试数 **core 334 + app 19 全绿**（开工基线实测 309 + 19，
  本轮新增 25 条：Tx 7 / Wy 7 / WyWeapi 5 / Mg 6）。
  `ktlintCheck test assembleDebug` 全绿，产物 `app-debug.apk` 27,552,357 字节。
- **触碰文件清单**：
  - M `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/TxLeaderboard.kt`
  - M `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/WyLeaderboard.kt`
  - M `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/WyWeapi.kt`
  - A `android-native/core/src/main/kotlin/cn/toside/music/core/music/leaderboard/MgLeaderboard.kt`
  - M `android-native/app/src/main/kotlin/cn/toside/music/nativeapp/data/LeaderboardRuntime.kt`
  - A `android-native/core/src/test/kotlin/cn/toside/music/core/music/leaderboard/TxLeaderboardTest.kt`
  - A `android-native/core/src/test/kotlin/cn/toside/music/core/music/leaderboard/WyLeaderboardTest.kt`
  - A `android-native/core/src/test/kotlin/cn/toside/music/core/music/leaderboard/WyWeapiTest.kt`
  - A `android-native/core/src/test/kotlin/cn/toside/music/core/music/leaderboard/MgLeaderboardTest.kt`
  - A `android-native/core/src/test/resources/tx-leaderboard-26.json`（真实抓取，songInfoList 裁到 35 条）
  - A `android-native/core/src/test/resources/mg-leaderboard-27553319.json`（真实抓取，整榜 50 条）
  - A `android-native/core/src/test/resources/wy-playlist-detail.json`（合成）
  - A `android-native/core/src/test/resources/wy-song-detail.json`（合成）
  - 未改：`ui/leaderboard/LeaderboardDetailPage.kt`、`ui/HomePage.kt`、
    `core/.../music/search/`（只 import `SearchRequest`）、`core/.../crypto/`（只调用 `Crypto`）
- **语义修正与实证发现**（对照 RN 源码实证；格式同 B2 语义修正表）：

  | RN 实际行为（易误解点） | Kotlin 移植遵循 |
  |:--|:--|
  | tx `getList` 先 `bangid = parseInt(bangid)`，请求体 `topid` 是**数字**；半成品把字符串塞进 `topid` | `toLongOrNull()` 否则直接报错（字符串 topid 未做线上对照，但 RN 明确 parseInt，照 RN 走）；`code=2000` 实测来自**期号写错**那一行，不是 topid |
  | tx 歌曲封面按 **`album.name`** 判定（''/「空」→ 歌手图 `T001R500x500M000{singer[0].mid}`，否则专辑图 `T002…{album.mid}`）；半成品按 `album.mid` 判定 | 改为按 `album.name` 空/「空」分支，单测覆盖 T001 回退 |
  | tx `filterData` 读 `file.size_*`，条目无 `mid` 或无 `file` 时不产出歌曲项 | `toMusicInfo` 返回 null 丢弃（`total` 仍按原始条数计） |
  | tx 期号（period）只能从 `c.y.qq.com/node/pc/wk_v15/top.html` 的 `data-date` 取（实测 `2026-10-24`）；自己拼 `2026_10_24` 一律 `code=2000` | 移植 `getPeriods`：GET HTML + `PERIOD_REGEX` 建期号表，命中才 POST `musicu.fcg`；实例内缓存期号表 |
  | wy 响应无效（非 200 / 缺 trackIds）时 RN 是**递归重试**（最多 6 次）后 reject；半成品吞成空榜 → UI「暂无歌曲」且不重试 | 无效响应抛错走外层 6 轮；`trackIds` 为空数组是**合法空榜**，不再请求第二段 |
  | wy 第二段 `song/detail` 内部另有 3 次上限，超限抛「获取歌曲详情失败」，且固定 `User-Agent: X11 Linux Chrome/60` + `origin: https://music.163.com` | `fetchSongDetail` 内部 3 次 + 同两个固定头；抛错后由外层继续轮 |
  | wy `filterList` 的 privileges **先按下标配对**，id 不匹配才按 id 回找；找不到才跳过该曲 | `privileges.getOrNull(index)?.takeIf{id 匹配} ?: firstOrNull{id 匹配}` |
  | wy 音质档位：`maxBrLevel==='hires'` 追加 flac24bit；`maxbr` 999000/320000/192000/128000 是 fall-through（192000 与 128000 都只给 128k）；`types.reverse()` 让高音质在前；`size` 缺失时**保留 null 条目** | 同档位表 + `asReversed()`；`sizeOf()` 返回 null 仍写入 `qualitys`（半成品会丢条目） |
  | **wy weapi 第二轮 AES 的输入是「第一轮 Base64 文本」的 utf8 字节**（RN 写作 `aesEncrypt(btoa(round1), btoa(secretKey), iv)`，native 会先解码 btoa）；半成品直接把 round1 的 Base64 串当 b64 输入 → 加密的是第一轮**密文字节**，服务端解不开 | 两轮都改用 `Crypto.aesEncrypt(ByteArray,…)` 明确字节；用 node crypto 复刻 RN 链路复算金标 `FSfSanZArfIQG3/7BlNqYqtzHjFqhYfm…PkrQ=`（108 字符）并落测试；encSecKey 另对 node `publicEncrypt(RSA_NO_PADDING)` 的金标 hex |
  | 纯 JVM（单测环境）没有 `AES/CBC/PKCS7Padding` 拼写（实测 `NoSuchAlgorithmException`），`RSA/ECB/NoPadding` 可实例化 | 沿用 WySearch/KwLeaderboard 先例用 `PKCS5Padding`（16 字节块下即 PKCS#7）；`WyWeapi.encrypt(objectJson, secretKeyOverride)` 开测试缝 |
  | mg `querycontentbyId.do?columnId=&needAll=0` **不分页**（RN `getUrl(id, page)` 忽略 page），一次返回整榜；门禁 `body.code === '000000'` | 整榜一次拉全，`page` 只作记账；`limit=200` |
  | mg `newRateFormats` 的 ZQ 常常**只有 `androidSize`**（真实新歌榜 50 首：43 首 PQ,HQ,SQ,ZQ 全序、6 首到 SQ、1 首到 HQ）；`size ?? androidSize` 才有值 | 同回退；音质表 PQ/HQ/SQ/ZQ → 128k/320k/flac/flac24bit |
  | mg 时长从 `length`（形如 `00:03:23`）用 `/(\d\d:\d\d)$/` 取**尾段**，取不到就是 null | `LENGTH_REGEX` 尾段捕获；缺失写 `JsonNull`（UI 不显示时长） |
  | mg `getList` 的重试闸门是 `if (++retryNum > 3) reject` ⇒ **最多 3 次请求**，业务码不合格与传输异常同计数 | 本车道初稿只在异常时计数（parse 返回 null 会**死循环**），已改为按次数硬闸门，单测断言 3 次后抛错 |
  | BoardPager 对「一次返回整榜」的源同样成立：`maxSourcePage = ceil(total/limit)`，tx/wy/mg 恒为 1，展示分页按 30 条切 | 三源无需特殊分支；`reachedEnd` 用 `total/30` 判定，「到底啦」与加载更多照常 |

  其他实证记录：
  - wy `weapi/v3/playlist/detail` 本机直连持续返回 **HTTP 200 + 空体**（node https 两次、
    curl 带浏览器 UA/cookie 各一次均如此）→ 按任务书改用**合成 fixture**
    （3 首覆盖 hires/999000、320000、pc 后备 + 128000），已在测试类注释标注；
    加解密金标不依赖该接口，来自 node 独立实现。
  - tx/mg fixture 为本机公开接口真实响应原样落盘（tx `musicu.fcg` GetDetail topid=26、
    mg `querycontentbyId` columnId=27553319）。
  - 开工自检：分支 `w1/laneA`、`git status` 干净、`local.properties` 存在、
    基线 `309 + 19` 全绿。首跑带 `--rerun-tasks` 曾出现一次瞬时红（与并行构建争用），
    干净重跑即全绿，非代码问题。
  - 快照与三个 worktree 由并行的协调会话先一步建好（`51f53b6`），本车道核实后未重复造。

- **遗留问题与对后续波次的建议**：
  1. `app/.../ui/HomePage.kt:341-352` 的「该源的榜单详情暂未接入」Toast 与
     `detailSupported` 判断现在恒为 true 的另一分支（本车道范围外，未动）。
     建议集成会话删掉该 Toast 分支；若无其他调用方，`LeaderboardRuntime.isDetailSupported`
     可一并收掉。
  2. wy 链路只证到「加解密形状对齐 RN + 两段请求形状/头对齐 RN」，**没证服务端接受**
     （本机不可达）。真机清单第 2 条是这轮唯一无法在 JVM 侧兜住的项。
  3. tx 期号表只在 `TxLeaderboard` 实例内缓存，进程重启后每个榜多一次 HTML 抓取
     （RN 同语义，未额外持久化）。若后续要做「切源秒开榜」，可考虑把 period 落存储。
  4. mg `getDetailPageUrl`（RN 依赖 `webId`，现 boardList 已无该字段 ⇒ 恒 null）未移植；
     当前 UI 无入口，等波次里有「在浏览器打开榜单」需求再补。
  5. 播放链路只做了「点击/播放全部 → 覆盖 TEMP 列表 → `playListById` → 后台 `getListDetailAll`
     补全」，与 RN `handlePlay` 一致；但曲源 `musicInfo` 的 `meta.qualitys/_qualitys`
     在 wy 侧允许 `size: null`，取链侧是否会因此选不到音质未在本车道验证（属 Lane C/播放范围）。
  6. 文档「验证基线」仍是 309 + 19；本轮后应为 **core 334 + app 19**，请集成会话更新
     `docs/kotlin-migration-progress.md`（本车道按 RULES 只读该文档）。

- **真机验收清单**（由用户在 vivo 上执行；两条设备均按既有约定）：
  1. 发现页 → 排行榜 → 源切「企鹅音乐」→ 点「热歌榜」：列表非空、序号前 3 高亮、
     下滑到 30 条自动拉下一页（tx 一次返回整榜，本地分页应无网络请求也成立）、
     到底显示「到底啦~」。
  2. 源切「网易音乐」→ 点「飙升榜」/「热歌榜」：能出整榜歌曲且歌名/歌手/时长非空
     （这条是 wy weapi 加密链的**唯一实证**，若一直转圈或报「获取歌曲详情失败」
     说明金标形状过了但服务端拒绝，需要回看请求 `params` 与 cookie）。
  3. 源切「咪咕音乐」→ 点「新歌榜」：条数应接近 50（RN 同），重复曲目不出现两次，
     时长显示 `mm:ss`。
  4. 三源各点一首歌：进入播放页能起播（走 TEMP 临时列表），队列长度先=当前页条数、
     后台整榜拉全后变长；返回详情页点「播放全部」：从第 1 首起播且队列=整榜。
  5. tx 榜在**跨天/跨期**后再点开一次（期号表按天变），验证重新抓 HTML 不报「加载失败」，
     且失败时点「重试」可恢复。
