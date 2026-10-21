# 长期记忆批次：歌手先验 + 正反馈解锁探索 + 词面反哺搜索

- 日期：2026-10-05
- 状态：已实现，89/89 单测全绿，Metro 打包通过
- 关联：`2026-10-04-recommend-session-health-tuning.md`、`2026-10-05-recommend-open-source-batch.md`

本批补齐内核优化清单中承诺的剩余两项，并闭合一期词面学习的回路：

## 1. 长期歌手先验（artistPrior.ts，新增）

与词面学习同构、按歌手归因的持久统计（`state.artistStats`，state v6）：

- 记账点与词面学习一致：完播 +0.5、早切 −0.5；喜欢/入单 +1、不喜欢 −2；
- **45 天半衰期**（比 token 的 30 天长——歌手口味更稳定），权重上限 8，上限 800 个歌手；
- 打分因子 = 1 + pos×0.1 − neg×0.25，钳位 [0.55, 1.15]，全通道乘性修正。

与既有机制分工：会话惩罚（最近 10 首）管"现在"，歌手先验管"一直"——历史上
6 次里被切 5 次的歌手即使画像里有权重也会持续沉底，且不封禁、随时间松动。

## 2. 正反馈解锁探索（sessionHealth.ts 扩展）

健康度从单向收缩变为双向调节：

- 连续 ≥3 首正反馈（完播/喜欢）且不在安全模式时，`explorationFactor` 解锁到 1.25
  ——听得开心时多撞新歌；
- `channels.ts` 的 clamp 从 ≤1 放宽到 ≤1.5，C/D 目标份额按 factor 放大后重分配
  （1.25 时每 20 首从 C4/D2 变为约 C5/D2，A 微降）；
- 安全模式（连续负反馈）仍然只降不升，两个方向互不覆盖。

## 3. 词面学习反哺搜索关键词（一期闭环）

`getLearnedStyleTokens`：从 `tokenWeights` 提取"被完播/喜欢验证过、且从未被切"的
风格词（按衰减后正权重排序，最多 3 个），追加到发现搜索的关键词池末尾——
不挤占画像主关键词。负向标记（DJ版/Live）永远不会成为搜索词。

## 4. 状态迁移 v5 → v6

新增 `artistStats`（默认空，旧数据零损失）；`storage.artistStatsLimit = 800`。

## 5. 验证

- 新增 3 组单测：歌手先验（记账/衰减/钳位/封顶）、正反馈解锁（streak 语义/
  安全模式抑制/配额扩张）、关键词反哺（正权重排序/负标记排除/追加位置）；
  stateSchema 断言升 v6。`npm test` 89/89；eslint/tsc 干净；Metro bundle 15.0MB 通过。
- 测试还揪出两个实现缺陷并修复：正反馈扩展开关写在了 `factor < 1` 分支内永不生效；
  factor 合成语义错误导致负反馈收缩被覆盖（安全模式优先级已明确）。

## 6. 真机观察点

- 连续听完 3+ 首后 `getRadioStatus().sessionHealth.explorationFactor` 应 >1；
- `[recommend:generate]` 日志中 pickedByChannel 的 C+D 应随之上升；
- 总被切的歌手的曲目应在后续批次中逐渐消失（无日志，靠听感验证）。

## 追加批次（2026-10-05 晚）：召回升级 + 控制权与透明度

### 1. 画像歌手热门歌直采（candidate.ts）

- 每轮抓取在歌单搜索之外新增 `artistHitsPerRefresh: 2` 个强歌手直采请求
  （`maxRequestsPerRefresh` 12 → 14，discoveryBudget 8 → 10）；
- 强歌手 = 画像权重 ≥ topWeight×strongRatio 且不在屏蔽名单；rotation 在强歌手
  列表上滑动，多轮覆盖不同歌手；
- 直采歌以高亲和度（≥0.5）进 A 通道，reason 为 `artist_hits:<歌手>`，与歌单
  共现采到的同曲自动合并取较强者；
- 预算耗尽/请求取消静默停止，不影响主流程。

### 2. 推荐理由透明化（B4）

- `RecommendQueueItem` 新增 `reason`（入选线索，优先 artist_hits > playlist > chart）；
- 引擎新增 `explainTrack(trackKey)`：把机器线索解析为结构化
  `{ kind: artist|playlist|chart|search|radio, param }`（歌单 id 已解析为名字，
  从 observedPlaylists 查询）；队列内与最近出队（served 缓存）均可查；
- `radio.ts` 暴露 `getRadioTrackHint`；播放队列（PlaylistSheet）的电台曲目
  副行从"来源平台 · 歌手"替换为理由文案（三语）："因为你常听 X" /
  "来自歌单《X》" / "来自榜单精选"等。

### 3. 探索偏好三档（B5）

- 新设置 `recommend.exploreBias`（familiar/balanced/explore，默认 balanced），
  推荐页两张卡片之间新增三档选择条（三语文案）；
- radio 模式下生效：familiar 将探索额度封顶 0.6 且探索间隔加大到 2；
  explore 将探索额度保底 1.25 且取消探索间隔；balanced 完全交给自动机制；
  explore 模式不受该设置影响；
- 与会话健康度的关系：用户档位是最终调制层的硬约束，自动机制在其框架内继续工作。

### 验证

`npm test` 89/89；eslint/tsc 干净（candidate.ts 无单测覆盖，与其既有状态一致，
靠编译+lint 兜底）；Metro 打包通过。真机观察点：日志 `artist_hits:<歌手>` 出现、
队列电台曲目的理由副行、档位切换后 `[recommend:generate]` 的 C/D 配额变化。

## 再追加批次：榜单定向化 + 闲置巡捞 + 时段画像

### 1. 榜单定向化（profile.ts pickChartBoard + candidate.ts）

榜单选择从纯轮换改为关键词打分：board 名字命中画像关键词池（含词面学习验证过的
风格词，keywordPool 已含）越多越优先；并列时在命中榜间轮换、无命中退回纯轮换——
D 通道的撞新撞在听得懂的领域里。

### 2. 闲置深度巡捞（index.ts maybeIdleCrawl）

池子低于 targetSize(500) 且距上次抓取/巡捞均超过 30 分钟时，用 2× 预算
（28 个请求）补池。触发点：回到前台（AppState active）、每次成功生成队列之后；
与常规 refresh 共用单飞锁，异步不阻塞播放。resetProfile 一并复位。

### 3. 时段画像轻量版（timeSlot.ts，新增）

不新增持久化：直接从 radioHistory 按"当前时段"（清晨/白天/晚间/深夜四桶）
聚合歌手级完播/早切信号，A 通道候选按歌手命中获得 [0.9, 1.12] 的温和因子。
依赖 RadioPlayRecord.artistKeys（本日起逐步积累，旧记录自动跳过）；
当前时段样本 <4 时完全中性。边界情况：时段按本地时间划分。

### 验证

`npm test` 91/91（新增 pickChartBoard 与时段画像 2 组用例）；eslint/tsc 干净；
Metro 打包通过。
