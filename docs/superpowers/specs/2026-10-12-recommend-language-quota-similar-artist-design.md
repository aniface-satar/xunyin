# 推荐引擎：语种硬配额 + 相似歌手通道

日期：2026-10-12
状态：设计已确认，待写实现计划
前置决策（用户拍板，不再讨论）：语种用**硬配额**（不是软权重）；路线 1（引擎内 + 国内接口）与路线 2（MusicBrainz/ListenBrainz）**同时做**。

## 1. 症状与根因

### 症状 A：中文设成 10%，却连着三四首中文

三条根因，全部有代码证据：

1. 问卷百分比只写正权。`onboarding.ts:63` `seedValueFor = percent/100 × saturation(4)`，`:86-89` `applySeedWeights` 只加 `positiveWeight`——滑到 10% 得到 +0.4，滑到 100% 得到 +4，**低百分比永远不会产生负权**，10% 的语义被实现成"稍微加一点点分"。
2. 抓分类时按轮次均匀轮换。`candidate.ts:295-303`：只要 `net > 0` 就进 `preferredTags`，然后 `preferredTags[rotation % preferredTags.length]`——10% 和 100% 的分类**被抓取频率完全相同**。
3. 曲目层根本没有语言。`PoolCandidate`（`types.ts:165-189`）没有语言字段；全仓库唯一的 CJK 正则在 `trackKey.ts:39,150,183`，用途是歌名归一化，不输出语言标签。占 20 首里 9 个额度的 A 通道来自种子歌单兄弟歌与 `artist_hits`（`candidate.ts:155`），D 通道来自国内榜单——这些来源天然以中文为主，任何语言权重都管不到它们。

结论：即使把权重公式改对，也只能缓解不能根治。**必须在曲目层建立语言标签，并把百分比变成配额。**

### 症状 B：连推同一歌手，推不到同类型其他歌手

1. 召回层没有"相似歌手"来源。`topArtists` 只由用户自己的收听构建（`profile.ts:361-375`），全仓库 grep `similarArtist|relatedArtist|neighbourArtist` 零命中。
2. `artist_hits` 每轮灌 2 位歌手 × 15 首，且 `affinity ≥ 0.5`（`candidate.ts:161`）；歌单兄弟歌的 affinity 常低于此值，被 `qualityGateRatio = 0.6` 的相对质量门槛筛掉后，A 池被少数熟歌手占领。
3. 抽样权重里没有任何"与最近几首相似"的惩罚（`diversity.ts:222-230` 只有曝光惩罚与同作品变体惩罚），多样性全靠硬间隔；而硬间隔阶梯最后一档被强制归零——`diversity.ts:191` `relaxConfigs[last].artistGap = 0`——池子同质时直接连推。
4. `antiRepeat.sameArtistInLast30 = 3` 本身允许 20 首里同一歌手出现 3 次。

## 2. 实测事实（全部本机/真机复现，非文档转述）

### 2.1 曲目语种字段可得性

| 源 | 端点（仓库实际调用的那个） | 逐曲语种 | 形态 |
|---|---|---|---|
| kg | `songsearch.kugou.com/song_search_v2`（`kg/musicSearch.js:11`） | **有** | `trans_param.language`，中文词表 |
| kg | `www2.kugou.kugou.com/yueku/v9/special/single/...`（`kg/songList.js:177`） | **有** | 同上 |
| tx | `fcg_ucc_getcdinfo_byids_cp.fcg?...&new_format=1`（`tx/songList.js:64`） | **有** | `language` 数字码 |
| kw | `nplserver.kuwo.cn/pl.svc`、`search.kuwo.cn/r.s` | 无 | 语种只在**歌单级** `tag="经典,华语,怀旧"` |
| mg | `c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0` | 无 | 语种在**歌单级** `data.tags[].tagName` |
| wy | `music.163.com/api/playlist/detail` | 无 | `album.tags` 为空、`result.tags=[]`；且 `weapi`/`v3` 路径已被平台拒 |

关键坑（已踩过）：tx 换掉 `new_format=1` 或改用 `only_source=1`，`language` 就整个消失；仓库现用 URL 是对的。

kg 语种词表实测出现：`国语 粤语 英语 日语 韩语 法语 德语 西班牙语 闽南语 纯音乐`。混着查不串（晴天→国语、Yesterday Once More→英语、恋風→日语、BTS→韩语、海阔天空→粤语、梦中的鸟→纯音乐）。

### 2.2 tx language 数字码（逐桶实测钉死）

用 tx 各语种标签下的官方歌单取单曲反推：

| 码 | 判定 | 证据 |
|---|---|---|
| 0 | 国语 | 国语桶歌单 266 首主值 |
| 1 | 粤语 | 「粤语周速递」by QQ音乐官方歌单，972 首主值 |
| 3 | 日语 | 日语桶 NIGHT DANCER/往け |
| 4 | 韩语 | 韩语桶 aespa/WINTER |
| 5 | 英语 | 英语桶 Ariana Grande/Taylor Swift |
| 6 | 法语 | 法语桶 Lara Fabian/Natasha St-Pier |
| 13 | 泰语 | ชอบเธออะ (I like you) |
| 16 | 西语 | Despacito、Waka Waka、DtMF |
| 24 | 越语 | See Tình、Xin Đừng Nhấc Máy |
| 7 / 9 / 10 | **不采信 → `unknown`** | 跨桶乱现（7 同时出现在国语/英语/法语歌单；9 有 Hans Zimmer 器乐也有 Charles Aznavour 法语歌） |

`genre` 字段同在，但本设计不用（问卷风格桶已有 themeWeights 通路）。

### 2.3 语种标签 id（配额召回的供给侧）

| 源 | 语种标签（名称→id） | 召回实测 |
|---|---|---|
| kw | 华语37 欧美35 韩语1093 粤语13 日语1091 小语种12 | `getTagPlayList&id=13&pn=1&rn=30` 200，total=51227；**id 只能传纯数字**，`13-10000` 形式报 `param error` |
| kg | 国语84 英语20 粤语19 日语21 韩语23 闽南语22 小语种24 法语570 | `getSpecial?t=5&c=19&p=1` 200，响应键是 **`special_db`**（不是 `list`） |
| tx | 国语1 英语3 粤语146 日语5 韩语4 闽南语113 小语种6 法语149 拉丁语3205 | `get_category_content` 200；歌单 id 在 `basic.tid`（`basic.mid` 是空串）；池容量 国语994/英语995/粤语988/日语977/小语种758/法语327/闽南语183/拉丁语129 |
| wy | 华语 欧美 日语 韩语 粤语（明文 `api/playlist/catalogue` 即通） | `api/playlist/list?cat=欧美&order=hot` 200 |
| mg | 国语1000001762 粤语1000001763 英语1000001766 日语1000001767 韩语1000001599 小语种1003449724 | `musiclistplaza-listbytag/release?tagId=...` code=000000；注意 `contentItemList[0]` 是 `template:"blank"` 占位，真歌单在 `template:"group1".itemList` |

两个失效模式：tx 闽南语(113) 与小语种(6) 的**首个**歌单 `songlist` 长度为 0——分类下歌单并非都有曲目，召回必须多取几个再验；`n=0` 时不能记为"该桶无货"。

### 2.4 相似歌手：国内五源全锁，只有 MB+LB 可用

| 候选 | 结果 |
|---|---|
| kg `kmr.service.kugou.com/v1/author/similar` | 活着但 `data: []`（3520/1574/22/7997 全空）；HTTPS 版证书 `ERR_TLS_CERT_ALTNAME_INVALID` |
| kg `v5/singer/similar`、`gateway.kugou.com/v4/singer/similar`、`v3/singer/related` | 404 / 502 / `Access Deny ! No Actions !` |
| kg `v5/singer/recommend` | 200 但 100 位歌手对**所有** singerid 完全相同 = 全站热门，无个性化价值 |
| kw `wapi.kuwo.cn/api/ir/artist/{id}/related`、`bd-api`、`openapi`、`nplserver op=similartist` | 404 / `402 request invalid` / 502 / `PARAM_ERROR` |
| tx `music.SimilarSingerSvr`、`music_singer/SingerSimilarList`、`GetSingerRelated`、`web_singer_info_svr/get_similar_singer` | `code:500003 subcode:860100005` / `req.code=2510001`；**仓库 `tx/utils.signRequest` 解锁不了** |
| wy `api/discovery/simiArtist` | `{"code":400,"message":"参数错误"}`（linuxapi 400、weapi 200 空体） |
| mg `MIGUM2.0/.../similarSinger.do` 及 realId/relatedSinger/resource 变体 | 全部 `"299996 路由请求不支持"` |
| **ListenBrainz Labs** `labs.api.listenbrainz.org/similar-artists/json` | **通**，100 条，无 key。`algorithm` 现为**必填**（不给→400 `algorithm field required`）；键名 `artist_mbid,name,comment,type,gender,score,reference_mbid`（是 `name` 不是 `artist_name`）；`count/offset` 与逗号批量 mbid 均 400，即一次一个 MBID |
| **MusicBrainz** `musicbrainz.org/ws/2/artist/?query=...&fmt=json` | **通**，无 key。检索期即返回 `tags`（不必 `inc`）；`country` 恒有；10/10 华语/日语艺人命中且 tags 可推语种（mandopop/cantopop/c-pop/j-pop/zhongguo feng）；>1 req/s 出现 503 busy |

### 2.5 手机端可达性（原唯一未消风险，已消）

V2302A（10AE2N03QR0041Y）走 **5G 蜂窝网络**（非家里 Wi-Fi），DNS 与 HTTPS 均实测成功：

- `labs.api.listenbrainz.org` 浏览器实开，返回 100 条相似歌手 JSON（周杰伦种子，含 Coldplay/Adele/Linkin Park/BEYOND/鄧紫棋 等，score 344→72 递减）。
- `musicbrainz.org` 浏览器实开，「告五人」`score=100`、`country=TW`、`tags` 含 `mandopop`、**`aliases` 含英文艺名 `Accusefive`**（locale zh/en 各一条）。

后者顺带解决了"平台歌手名 ↔ MB 名"的匹配难点：**用 MB 的 aliases 建反向索引**，而不是拿 LB 的繁简混排名字去猜。

截图存 `Temp/probe-rec-2026-10-12/phone-{lb,mb}.png`；探测后已把前台还给 `cn.toside.music.mobile`。

## 3. 方案

### 3.1 语言标签：新纯函数模块 `src/core/recommend/language.ts`

输出枚举 `LangBucket = 'zh' | 'yue' | 'en' | 'ja' | 'ko' | 'other' | 'instr' | 'unknown'`。四级推断，取第一个命中的：

| 级 | 来源 | 说明 |
|---|---|---|
| L1 | 接口逐曲字段 | kg `trans_param.language` 词表映射；tx `language` 按 §2.2 码表映射。要穿过三层：各源 `filterData` 保留原始语种 → `toNewMusicInfo`（`src/utils/index.ts:28`）白名单加 `lang`（照现成的 `releaseDate` 那行的写法）→ `PoolCandidate.lang` |
| L2 | 来源语种桶 | 候选在召回时已知自己来自哪个语种标签（§3.3 的桶召回），直接打 `langHint`，不依赖分类淘汰 |
| L3 | 歌手语言表 | 本地持久化 `歌手名 → 桶`。两个喂入口：① 播放时歌词脚本统计（白捡，见下）；② MB tags/country（路线 2 顺带） |
| L4 | 歌名/歌手名脚本统计 | 汉字→zh/yue 歧义时交 L3；假名→ja、谚文→ko、纯拉丁→`unknown`（**不**判成 en，英文艺名的中文歌手很多） |

L3 的歌词喂入是零额外请求的：电台每首播都取歌词，且**两条路径都要接**——`player.ts:186`（切歌立即取词）与 `player.ts:218`（`debouncePlay` 里补取，temp 队列走这条）。挂载点选在两处 `getLyricInfo(...).then()` 的 **`if (musicInfo.id != ...) return` 守卫之后**（守卫之前会把已切走的歌写进表），调用新入口 `recommendationEngine.observeLyricLanguage(musicInfo, lyricInfo.lyric)`。

这个入口只做一件事：统计字符占比 → 更新歌手语言表。**不得**改候选池、不得改队列、不得同步落盘（沿用 `storage.ts:52 saveState` 的防抖写入）。纯音乐判据只在"歌词请求成功且返回空"时成立；请求失败（`catch` 分支）不写任何值，避免把网络问题记成"这人是纯音乐歌手"。

歌手语言表的存储：独立键 `xunyin_recommend_artist_lang_v1`，值 `歌手名 → { bucket, hits, updatedAt }`，上限 500 位（超出按 `hits` 最低淘汰）。**不设 TTL**——歌手语种不随时间漂移，`hits` 只用来在两次观测冲突时取多数。表为空时（首装、或用户还没听够）L3 直接跳过、由 L4 落桶，汉字歧义此时一律记 `zh`（本 App 曲库以华语为主，这个猜法命中率最高），不阻塞 P1。

`unknown` 的语义是"不占任何桶的名额，也不能用来满足配额"。

### 3.2 硬配额：新纯函数模块 `languageQuota.ts`

照 `channels.ts:49` 的滚动窗口缺口写法：

```
窗口 = channels.windowSize = 20
目标数 target[b] = round(问卷百分比/100 × 20)，问卷没覆盖的桶按剩余名额分
已出现 used[b] = 最近 20 首里 lang == b 的首数
本轮上限 cap[b] = max(0, target[b] - used[b]) + 容差
```

语义（实现者不要自行猜）：

- **百分比是绝对占比**，不是相对偏好。中文 10% = 20 首里最多 2 首中文，与用户还滑了什么无关。
- 各语言是独立滑条（`sanitizeWeights` 允许多个 0~100），**加起来可能超过 100**。此时按声明值比例把 `target` 整体缩到窗口大小（同 `allocateByWeights` 的最大余数法），不静默丢弃。
- 加起来小于 100 时，剩余名额是"自由名额"：任何桶都能拿，但**已声明桶的上限照样卡住**——这就是"只滑了中文 10%"必须靠 §3.3 供给侧才能兑现的原因。
- 问卷**全空/跳过**时不设语言配额，只保留连播硬规则与 `instr` 上限，行为等同今天。
- `unknown` 可以拿自由名额，但**不计入任何已声明桶的达成**（不能用一堆判不出语言的歌冒充非华语）。
- 容差 = 1 首，且只允许"本轮不再选该桶"这种向下收紧，不回溯删除已排进队列的曲目。
- 执行点：`diversity.ts:249` 的 eligible 谓词里加 `langWithinCap(item, caps)`，与同歌手间隔同级；`FinalQueueItem` 加 `lang`，`buildFinalQueueItems`（`candidatePool.ts:272`）透传，`pushMusicInfo`（`index.ts:369`）就地算 lang（它能拿到 musicInfo，而 `recent` 里 musicInfo 已被丢掉，必须在这里补）。
- 阶梯：**语言约束在第 3、4 档放开**，放开时写 `reasons.push('lang_quota_relaxed')`——日志能看出"没凑够是因为池里没货"，不会假装满足。落地位置要说清，别按"有 radio 专用阶梯"的假想写：`getRelaxConfigs`（`diversity.ts:79`）是**零参函数**，五档是硬写的对象字面量（`diversity.ts:81-129`，逐字段取自 `recommendationConfig.antiRepeat`），全仓库只有 `diversity.ts:189` 一处调用，`radio.ts` 根本不碰它（电台对档位的唯一影响是 `radio.ts:104` 的 `getRecommendations(10)`）。所以给 `RelaxConfig`（`diversity.ts:69-77`）加一个 `langQuotaEnforced: boolean`，并在**五个字面量里逐个填值**（0~2 档 `true`、3~4 档 `false`），漏填就编译不过。
- 配额的传入路径：`selectFinalQueue` 是纯函数，拿不到问卷也拿不到池，`langCaps` 必须挂在 `FinalQueueSelectionOptions` 上由调用方（`candidatePool.ts`）算好传进来；同处注意 `diversity.ts:195` 的 `pickedByChannel` 是按 `A/B/C/D` 写死的字面量，加通道 E 时要一起补，否则 E 的计数是 `undefined`。
- 连播硬规则（独立于配额）：同一种语言不连播超过 2 首，直接掐死"连三四首中文"。
- `instr`（纯音乐）不占语言名额，单独限 20 首里最多 2 首。

### 3.3 供给侧：按语种桶召回

配额能不能兑现取决于池里有没有货。新增桶召回：

- 每轮刷新先算 `缺口 = target - 池内该桶候选数`，按缺口降序挑 1~2 个桶，用 §2.3 的标签 id 抓该语种的歌单（最新:最热仍守 7:3）。
- 五源都参与，但**优先 kg/tx**（有 L1 逐曲语种，闭环最准）。
- 抓到 `songlist` 为空时**不记为无货**，换下一个歌单重试（§2.3 已实测到 tx 的这个坑）。
- 池内 `unknown` 占比超过 30% 时，本轮预算优先给 kg/tx 的桶召回（L1 能直接把它变成有标签的候选）。

### 3.3.1 同时修掉软权重侧的两个反向 bug

不修这两处，召回会持续过量抓华语歌单，配额只能每轮破例，等于硬配额替软权重擦屁股：

1. **低百分比要产生负权**。`applySeedWeights`（`onboarding.ts:81-90`）改成以 50% 为中性点：`p ≥ 50` 记 `positiveWeight += (p-50)/50 × saturation`；`p < 50` 记 `negativeWeight += (50-p)/50 × saturation × 0.5`。中文 10% 于是变成"华语分类净负权"，`themeAffinityFactor` 自然把它压下去。
   **两件事必须一起做，缺一不可：**

   a) `revokeSeedWeights`（`onboarding.ts:93-104`）现在只减 `positiveWeight`，整个函数不碰 `negativeWeight`，删除条件也是"正权归 0 且负权本来为 0"。播种分量一旦可带符号，这里必须按符号分两支对称回退（负分量去减 `negativeWeight`），否则用户重置问卷后**负权永久残留**，会把该分类压死。
   b) **`STATE_VERSION` 8 → 9，加一条重播种迁移**（原文写"不需要迁移"是错的）。存量用户的 `seededThemeWeights` 已经按老公式写成纯正分量，只改代码的话他们不会重新过问卷，这次修正对其真实偏好**永远不落地**。迁移做法：`stateSchema.ts:55 migrateRecommendationState` 里按版本闸门（照 `:66 dropLegacyCandidates`、`:69` onboarding 重置的既有写法）对 `version < 9` 的记录先用老分量做 a) 的回退，再用存下的 `onboarding.weights`（百分比原值一直在）按新公式重播种。学习数据（tracks/playlists/session）不动。
2. **分类轮换改按权重抽样**。`candidate.ts:295-303` 的 `preferredTags[rotation % preferredTags.length]` 是等频轮转（10% 与 100% 同频），改为按 `net` 的轮盘抽样（复用 `diversity.ts:6` 的 `softmaxSample` 思路，温度单独放 config），让低净权分类真的少被抓。

### 3.4 相似歌手通道 E

provider 链（依次尝试，成功即止，结果带来源标记）：

1. **MB 检索**（中文艺名，1 请求）→ MBID + tags + country + aliases，顺带喂 §3.1 的 L3 表。
2. **LB similar-artists**（1 请求，必带 `algorithm`）→ 100 条 `{artist_mbid, name, score}`。
3. **MB 别名反查**：只对分数靠前的 3~5 位做（1 请求/位），拿规范名与 aliases，**不采信 LB 的 name 直接当歌手名**（实测繁简混排：周杰伦 100 条里 77 汉字 + 23 拉丁）。
4. **kg `song_search_v2`** 按名取热门歌（1 请求/位）→ 进 E 池，`lang` 由 L1 直接拿到。

约束（把账算明白，别让实现者自己凑）：

- 一位种子歌手走完全链路的请求数：MB 检索 1 + LB 相似 1 + 前 3 位相似歌手的 MB 规范名 3 + 3 位歌手的 kg 搜索 3 = **8 次**，分处两条队列（MB/LB 5 次走慢队列，kg 3 次走国内快队列）。
- 因此 E **不每轮跑**：每 3 次刷新起 1 位新的种子歌手；`config.ts:384` 的 `maxRequestsPerRefresh = 14` 里给 E 划子上限 `similarArtistBudgetPerRun = 4`（**计入**总预算，不是额外额度），且**歌单召回永远优先**——E 只花歌单召回用剩的额度，剩余额度 < 2 时本轮整条 E 链路直接跳过，不做只够半步的无用请求。
- 8 次 > 单轮 4 次 ⇒ **一条链路必然跨轮续跑**。E 维护一张任务表 `{ seedArtist, stage, resolvedMbids, pendingNames[] }`，每轮从当前 stage 接着推进，已成功的请求不重发。它与结果缓存同放 `xunyin_recommend_artistsim_v1`，但键内分两块：`byArtist`（受 30 天 TTL 管）与 `pending`（**不受 TTL 管**，链路跑完即删）——否则跨轮的中间态会被同一个 TTL 清掉，链路永远铺不完。
- 单轮耗时上限取两条队列中较慢的那条：慢队列受 1 req/s 约束，4 次里的 MB/LB 部分约 4~5 秒；kg 搜索不受慢队列限流。
- 代价说清楚：topArtists 前 10 位铺满要约 30 次刷新（正常收听下约几天）；命中缓存后 E 的预算归零，只花 kg 搜索那几次。这是"无后端 + 1 req/s"下的固有速度，不是缺陷。
- MB/LB 全局 **1 req/s** 串行队列（实测超限 503 busy）；国内源请求不受此限，两条队列分开。
- 缓存：`歌手名 → { similar:[{mbid,name}], source, fetchedAt }`，上限 200 位、TTL 30 天，独立存储键 `xunyin_recommend_artistsim_v1`。**不进 `STATE_VERSION`**——版本闸门只管 state 键（`storage.ts:12 loadState`），独立键没有版本戳，兼容策略是"读不出来或结构不认识就当作无缓存重新获取"，见 §3.6。
- 冷路径：MB/LB 全挂时 E 通道静默缺席，A 通道行为退回今天的样子，不弹错、不断粮。

新增第 5 个通道的改动面（现在处处按 `A/B/C/D` 写死，漏一处就编译不过或配额算错）：`types.ts` 的 `ChannelId` 与 `CHANNEL_IDS`、`channels.ts` 的 `emptyChannelCounts`/`countChannels`/`countFinalChannels`、`config.ts` 的 `channels.targetPerWindow`/`exploreTargetPerWindow`/`fallbackOrder`/`coldStartFallbackOrder`/`exploreFallbackOrder`、`bandit.ts` 的通道计数、`candidatePool.ts` 的 `channelWeightsFor`、`index.ts` 的 `availability` 组装、`radio.ts` 的诊断输出。**探索模式 E = 0**（探索未知仍由 C/D 供货），只在电台模式给 2。**`coldStartFallbackOrder` 里不要加 E**——冷启动没有 `topArtists` 就没有种子歌手，这条链路必然空跑；该数组今天不含 D，保持同样的取舍。

### 3.5 治连推（与 E 通道配套）

- `artist_hits`：每轮 2 人×15 首 → **1 人×8 首**，affinity 门槛 0.5 → 0.6。
- A 通道额度 9 → 7，让出的 2 个名额给 E（`config.ts:24` `targetPerWindow`）。
- 抽样权重加软惩罚：`weightFor`（`diversity.ts:222`）里"最近 6 首同歌手 ×0.35 / 12 首内 ×0.6"。
- 删掉 `diversity.ts:191` 的 `artistGap = 0` 兜底，最低一档也保持隔 2 首；候选真枯竭时宁可少给几首并记 `reasons`，也不连推。
- `sameArtistInLast30` 3 → 2。

### 3.6 数据兼容

- `PoolCandidate.lang` 与 `FinalQueueItem.lang` 都设为**可选**。旧池候选是在 `toNewMusicInfo` 白名单加 `lang`、以及桶召回上线**之前**落盘的，既没有 L1 字段也没有 L2 的 `langHint`，所以 `loadCandidateCache` 载入后只能由 **L3/L4** 就地推导（derive-on-read），不 bump `STATE_VERSION`。推导结果只在本轮内存里用，不回写缓存键——下一轮载入会重新推一次，代价是一次字符统计，比迁移磁盘数据安全。（与 §3.3.1 要求的 v8→v9 不矛盾：那次迁移管的是问卷播种分量，走 state 键；候选池在这个无版本戳的独立键里，版本闸门本来就够不到它。）
- 池数据的真实位置要说清，别按"独立键里另存一份"来写：内存里就是 `state.candidateCache`，落盘由 `behavior.ts:334/336/386` 调 `saveCandidateCache` 写独立键 `xunyin_recommend_candidates_v2`（`candidateStore.ts:6`）；`storage.ts:48` 只是把 `candidateCache` 从 state 键里剥掉避免序列化超大数组，**不代表池被清空**。所以 derive-on-read 的挂载点是 `candidateStore.ts:10 loadCandidateCache`（模块级 memo `cache`，只推一次）。
- 落盘是**整体数组 JSON 重写**（`candidateStore.ts:37`、`:41 saveCandidateCacheNow`），容量 `candidateCacheLimit = 1500`（`config.ts:366`）。每条候选多一个 `lang` 短字符串对这个量级可以接受，但正因为每次都是全量重写，推导结果才**绝不回写**；同理别在推导里做额外序列化。
- 桶多样性要落到**淘汰排序**：`candidatePool.ts:125-131` 的 `sort + slice(0, maxSize)` 决定谁留在池里，只在召回端努力、这里照样会被按分数截断掉非华语候选。给比较器加一项桶配额惩罚（超配的桶往后排），而不是再叠一层入池截断。
- 若验收时需要"干净重测"，走 `candidateStore.ts:50 clearCandidateCache()`（同时清内存 memo 与独立键），语言表另有其键要一起清。

## 4. 测试

### 4.1 单测（新增 `tests/recommend-language.mts`、`tests/recommend-similar-artist.mts`，并入 `package.json` test 脚本）

语言：
- kg 词表、tx 码表逐值映射（含 7/9/10 → `unknown`）；
- 脚本统计：假名/谚文/汉字/纯拉丁各自落桶，英文艺名中文歌手不被误判 en；
- 配额：10% → 20 首里目标 2 首；已出现 2 首后第 3 首中文在 relax 0~2 档不合格；池内只有中文时第 3~4 档放行且写 `lang_quota_relaxed`；
- 连播：构造全中文池，断言输出不存在 3 连同语言；
- `instr` 不占语言名额、超 2 首被挡；
- 歌词喂入（L3 表）：空歌词不写、歌词请求失败不写、同一歌手两次观测冲突时按 `hits` 取多数、500 位上限时淘汰 `hits` 最低的那位；
- derive-on-read：给一条既无 `lang` 又无 `langHint` 的旧池候选，断言载入后能落到某个桶、且**没有把推导结果写回缓存键**（用假 storage 计写入次数）。

注意 `package.json` 的 `test` 脚本是**显式文件白名单**而非 glob，新增测试文件必须把路径追加进去，否则 `npm test` 静默不跑。

问卷播种改造（§3.3.1）的连带用例——现有 `tests/recommend-onboarding.mts` 里有四条会被直接打破，改代码时同批改：
- `:31` "applySeedWeights adds onto existing positive" → 改成以 50% 为中性点的两支；
- `:40` "revokeSeedWeights subtracts only the seeded component" → 补负分量分支；
- `:78` `assert.equal(state.version, 8)` → 跟 `STATE_VERSION` 一起改；
- `:101` "a version 8 stored onboarding survives migration untouched" → **这条断言本身要被推翻**（v9 要主动重播种），改成"老分量被精确回退、按新公式重播种"。

新增：`p=10` 只产生 `negativeWeight`；带符号分量 `revoke` 往返后正负两侧都归零且条目删除；v8→v9 迁移幂等（同一份 `weights` 连跑两次结果一致）。

相似歌手：
- provider 链回退（第一个失败走第二个，全失败时 E 缺席且不影响出队）；
- 1 req/s 限流器（注入假时钟，断言无并发越限）；
- 缓存命中/过期/200 条上限淘汰；`pending` 任务表不受 TTL 影响（假时钟推到 31 天后仍能续跑）；
- 跨轮续跑：一位种子歌手分两轮跑完，断言第二轮不重发第一轮已成功的请求（用假 provider 计调用次数）；
- 请求预算：E 通道不得越过自己的子预算去挤占歌单召回；本轮剩余额度 < 2 时整条 E 链路跳过，不留半步状态。

### 4.2 闸门

`npm test`（当前基线 293，本功能只增不减）+ `npx eslint src/core/recommend src/utils/musicSdk` + `npx tsc --noEmit` 过滤本次路径零报 + Metro bundle 产物 grep 特征串（`lang_quota_relaxed`、`xunyin_recommend_artistsim_v1`、`xunyin_recommend_artist_lang_v1`）。

### 4.3 真机验收（需要手机，届时另行招呼）

临时把语言分布打进 `console.error`（release 包 `__DEV__` 为假，`recallLog` 全静默），每批输出 20 首的桶计数与 `reasons`。验收项：
1. 问卷中文 10% → 连听两批（40 首），中文 ≤ 6 首，且无 3 连同语言；
2. 池内非华语不足时，日志出现 `lang_quota_relaxed` 而不是静默破规；
3. 故意快切几首后，E 通道能带出**没听过的新歌手**，且不是同一歌手刷屏；
4. 断网/屏蔽 MB+LB 时电台照常起播、无报错弹窗。

## 5. 明确不做

- 不做设备端音频风格模型（YAMNet/discogs-effnet）：现有 TFLite 每天只分析 20 首完播歌，对这两个症状帮助不成比例。
- 不做 Last.fm/Deezer：前者要申请 key（违反"永久免费、无到期额度"约束），后者本机直连已失败、华语覆盖弱。
- 不做自建代理或后端缓存 MB/LB 结果。
- 不做"每日固定推荐列表"（沿用既有决策）。
- 不新增任何上报。

## 6. 分期

| 期 | 内容 | 依赖 |
|---|---|---|
| P1 | `language.ts` + tx/kg 语种字段穿过 `toNewMusicInfo` + `languageQuota.ts` + 连播硬规则 + **歌手语言表与歌词喂入（L3 零请求那半）** + **§3.3.1 软权重两个反向 bug（含 v8→v9 重播种迁移）** + 连推治理（§3.5）+ **最小版桶召回（只做 kg/tx 两源）** | 无外部依赖，纯离线可单测 |
| P2 | 五源全量桶召回 + `unknown` 占比治理（§3.3 全部） | P1 的桶定义 |
| P3 | 通道 E：MB→LB→kg 链 + 限流 + 缓存 + L3 的第二个喂入口（MB tags/country） | 手机端可达性**已实测通过** |
| P4（可选） | 离线预置相似歌手表打进 APK（本机批量跑 MB/LB 生成，3000 位歌手约 1 小时、产物 1~2MB） | 仅当真机出现"蜂窝网络下 MB/LB 连不上"才做；目前证据是通的 |

P1 为什么必须带上 kg/tx 的最小桶召回：只有配额、池里却没有非华语候选时，每一轮都会在 relax 第 3~4 档破例，比例照样下不来——**配额和它的供给侧不能拆在两期**。kg/tx 恰好是唯二能逐曲给出语种的两源，闭环最短。

L3 语言表为什么也在 P1：§3.6 里旧池候选 derive-on-read 只剩 L3/L4 可用。若把语言表推到 P3，P1 上线时存量候选全靠歌名字符猜，而汉字无法区分国语/粤语——恰恰是症状 A 最需要分清的那一对。歌词喂入零请求，没有理由延期。

§3.3.1 为什么和 v9 迁移同批：迁移闸门是一次性的消耗品，跑过一次就把 `version < 9` 的记录全部作废重播。若先把负权公式推后、只上配额，等于放着召回端的过量华语抓取不修，让配额每轮都在第 3~4 档破例；反之若先跑迁移再改公式，重播出来的还是老的正分量，得再等一个版本才能修，而那时已经没有迁移闸门可用了。两者都纯离线可单测，绑在一起做。

各期兑现什么：
- **P1**：症状 A 的"连三四首"消失（连播硬规则 + 中文上限），症状 B 的连推明显缓解（`artist_hits` 降量 + 软惩罚 + 去掉 `artistGap=0`）。
- **P2**：中文占比真正收敛到 10% 附近。
- **P3**：症状 B 根治——能刷到没听过、且风格相近的其他歌手。
