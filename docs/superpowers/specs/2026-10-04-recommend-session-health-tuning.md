# 个性化推荐"连续不合胃口"调整方案（会话健康度机制）

- 日期：2026-10-04
- 状态：已实现，待真机验证
- 关联：`docs/superpowers/specs/2026-09-28-discover-recommend-tab-design.md`（推荐 tab 设计）

## 1. 问题

个性电台会出现连续好几首推荐不合胃口的情况：用户连切 2~3 首后，队列里排着的仍是同一路
（陌生歌单/榜单）的候选，要再切 5~6 首才能回到合胃口的歌。

## 2. 根因

排查 `src/core/recommend/` 后确认四个叠加原因：

1. **负反馈只影响单首单曲/单歌单**：早切只给单曲 -1 分、来源歌单 +0.25 负权重，这一首
   被移出候选池，但同歌单/同歌手的"兄弟候选"权重不变，继续排队。
2. **选歌不知道"用户正在连续切歌"**：每批 20 首生成时只看长期画像和通道配额，会话内的
   连续负反馈完全不参与配额与打分；负反馈要等下一批生成（且仅通过歌单权重间接）才生效。
3. **通道配额静态**：radio 模式固定 A9/B5/C4/D2——每 20 首里有 6 首来自低曝光/榜单通道
   （C/D），它们天然离画像较远，连切后这 6 首恰好是"连环踩雷区"。
4. **C/D 通道内部无画像序**：C 通道按纯新颖度排序（exploration/低曝光/低播放量），
   亲和度 0 的候选与画像边缘的候选概率相同；且两首探索曲目可以背靠背出现。

## 3. 调整内容

新增 `src/core/recommend/sessionHealth.ts`（纯函数，已被单测覆盖），并把会话健康度接入
选歌链路的四个环节。核心思想：**早切/低完成度/不喜欢在会话窗口内聚合，实时收紧探索，
把额度还给画像通道**。

### 3.1 会话健康度（sessionHealth.ts，新增）

观察最近 10 首已结算曲目（`session.recentTracks`），计算：

- `negativeStreak`：从最新一首往前数的连续负反馈条数（早切 <30% 听完、不喜欢；
  显式喜欢中断连击）。
- `negativeRate`：窗口内负反馈占比。
- `explorationNegativeRate`：仅 C/D 通道的负反馈占比（样本 <3 时回退总体占比）。
- `explorationFactor`：占比线性映射到 0.25~1 的探索额度系数（≤34% 不收缩，≥67% 收缩到下限）。
- `safeMode`：连续 ≥2 首负反馈触发。

### 3.2 通道配额动态收缩（channels.ts）

`planChannelQuotas` 新增 `explorationFactor` 入参：C/D 目标份额按系数缩小，
让出的额度按 A/B 占比流回（例如 factor=0.25 时每 20 首从 C4/D2 变为约 C1/D1、A12/B6）。
explore 模式照常不受影响（由调用方传 1）。

### 3.3 来源级会话惩罚（candidatePool.ts）

结算过的负反馈按歌手/来源歌单归因（越近权重越高，按 0.85 逐位衰减，上限 3）：

- 打分：命中歌手/歌单的候选权重乘 `1/(1+惩罚分)`（满命中约 ×0.25）——软惩罚，
  不封死来源。
- radio 模式下 C/D 通道新增亲和度闸门：权重 ×(0.55 + 0.45×affinity)，画像内候选优先
  于完全陌生的歌；explore 模式保持纯新颖度排序。
- 惩罚只作用于"与刚被切掉的歌同源"的候选，画像核心通道（A/B）不受影响。

### 3.4 探索间隔（diversity.ts）

选歌序列新增 `explorationGap`（默认 1，explore 模式为 0）：相邻两首 C/D 之间至少隔 1 首
非探索曲目；只有探索通道还有剩余额度时才放宽（记录 `exploration_gap_relaxed`），
保证配额不因间隔约束饿死。

### 3.5 安全模式熔断（index.ts）

`finishCurrent`（含手动切歌）与显式不喜欢之后评估健康度；`safeMode` 触发时（60s 冷却）：

- 从待播队列撤下命中"近期负反馈歌手/歌单"且惩罚 ≥1.8 的曲目（单次至多 10 首），
  只撤队列不删候选池，走既有 `onTrackRemoved` 通路同步移除播放器排队；
- 下一批生成自动获得收缩后的配额 + 更低温度（softmax 0.6 → 0.35，更贴高分候选）；
- 异步补货 4 次请求，避免清队后队列过薄。

### 3.6 数据面（behavior.ts / types.ts）

`SessionTrack` 新增 `artistKeys`，开始播放时冗余记录参与歌手，供惩罚归因；
旧会话数据缺该字段时按"无归因"处理，兼容无损。

## 4. 参数速查（config.ts）

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| sessionHealth.streakThreshold | 2 | 连续 N 首负反馈触发安全模式 |
| sessionHealth.window | 10 | 观察窗口曲目数 |
| sessionHealth.negativeListenRatio | 0.3 | 听完比例低于此值记负反馈 |
| sessionHealth.explorationThrottleStart/End | 0.34/0.67 | 探索收缩的占比起止点 |
| sessionHealth.explorationFactorFloor | 0.25 | 探索额度下限（保留撞新能力） |
| sessionHealth.deferPenaltyThreshold | 1.8 | 撤队所需的最小惩罚命中 |
| sessionHealth.safeModeCooldownMs | 60s | 熔断冷却，防连切反复清队 |
| channels.explorationAffinityFloor | 0.55 | C/D 亲和度闸门下限 |
| antiRepeat.explorationGap | 1 | 探索曲目最小间隔 |
| softmax.safeModeTemperature | 0.35 | 安全模式下的采样温度 |

## 5. 反馈闭环时序

```
切歌/播完 → 结算(coverage→listenRatio) → 会话健康度刷新
  ├─ streak≥2 → 熔断：撤下队列高风险曲目 + 低温补货
  └─ 下一批生成：explorationFactor 收缩 C/D 配额
       + 歌手/歌单惩罚降权 + C/D 亲和度闸门 + 探索间隔
→ 连切 2~3 首后队列立即转向画像核心内容
```

负反馈仍然全部是软信号：不封禁歌手/歌单，惩罚按新近度衰减、有上限，
窗口滑出后自然恢复。

## 6. 测试与验证

- `tests/recommend-algorithm.mts` 新增 8 个用例：连击检测、探索占比回退、额度映射、
  配额收缩、惩罚累计/封顶、打分降权与闸门、撤队阈值、探索间隔（含放宽路径）。
  `npm test` 78/78 通过；`eslint src/core/recommend` 干净；tsc 对 recommend 模块无新增错误。
- 真机验证建议：连切 2 首后观察 `getRadioStatus().sessionHealth`（streak/explorationFactor）、
  队列 `channels` 分布应向 A/B 倾斜；`[recommend:safeMode]` 日志应出现撤队计数。
- 后续可调参：若仍觉探索过猛，优先降 `explorationThrottleStart`（如 0.25）或
  `explorationAffinityFloor`（如 0.4）；若觉得太保守，反向调大。
