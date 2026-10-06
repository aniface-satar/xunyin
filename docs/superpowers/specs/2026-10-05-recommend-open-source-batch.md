# 推荐算法开源引入批次：segmentit 分词 + SAR 会话共现 + Thompson bandit

- 日期：2026-10-05
- 状态：已实现，待真机验证
- 关联：`2026-10-04-recommend-session-health-tuning.md`（会话健康度机制）、`2026-09-28-discover-recommend-tab-design.md`

## 1. 目标

在无后端约束下引入开源项目/算法，让"用户感知到的歌"更贴合喜好。本批为纯 TS 批次
（无原生依赖），三个组件全部落地：

1. **segmentit**（纯 JS 中文分词）→ 词面级学习的基础设施
2. **SAR**（Microsoft recommenders 的 Smart Adaptive Recommendations）→ 会话共现算法移植
3. **Thompson bandit** → 通道配额从写死变为按实际表现自校准

明确排除（原因见讨论记录）：TensorFlow.js、transformers.js、MusicBrainz/Last.fm 等
第三方元数据 API（隐私 + 华语覆盖）、npm 上的多用户协同过滤库（单机无多用户数据）。
二期候选：react-native-fast-tflite + MTG essentia MusiCNN 模型做设备端音频风格嵌入。

## 2. 词面级学习（segmentit + tokenFeedback.ts）

**基础设施**（`tokenize.ts`）：
- `import * as segmentit from 'segmentit'` + 延迟实例化（词典构建约 200ms，首次调用才发生）；
  node ESM 把 CJS 导出收进 `default`、Metro interop 两者都可能，双取兼容。
- `tokenizeTrackName(name)`：歌名 → 降噪 token（去单字/纯数字/停用词，小写去重，≤12 个）。
  "泡沫DJ版" → `泡沫/DJ/版`；"夜晚爵士钢琴曲 伴奏" → `夜晚/爵士/钢琴曲/伴奏`。
- 体积影响：bundle 约 +4MB（dev 15MB 实测打包通过，release 压缩后增量更小）。

**学习回路**（`tokenFeedback.ts` + `behavior.ts`）：
- 开始播放时把歌名 token 快照存进 `RadioPlayRecord.nameTokens`；
- 结算信号记到 `state.tokenWeights`（完整 +0.25，早切 −0.5；显式喜欢/入单 +0.5，
  不喜欢 −1.0，复用 `ThemePreference` 结构 + 30 天半衰期衰减，上限 6）；
- 打分时 `nameTokenFactor`：候选歌名命中 token，取衰减后正/负权重最大值，
  因子 = 1 + pos×0.15 − neg×0.35，钳位 [0.5, 1.25]，全通道乘性修正。
  效果：总被切的"DJ版/翻唱"逐步沉底，常被听完的风格词升温。

## 3. SAR 会话共现（similarity.ts）

`buildSessionCoOccurrence(radioHistory, seedKeys)`：把用户自己的播放记录切成
"收听会话"（间隔 ≤30min 为同场）——

- **anchor**：画像种子歌且覆盖 ≥0.8（真听完才算正样本）；
- **member**：与 anchor 同场、覆盖 ≥0.5 的非种子歌（早切的不吸收信号）；
- 权重 = anchor 覆盖 × 时间半衰期衰减（14 天），跨会话累加后 `t/(1+t)` 饱和归一化。

候选打分接入：A 通道改为 `affinity×0.45 + playlistScore×0.25 + 歌单共现×0.15 + 会话共现×0.15`。
这是歌单共现之外第一个**完全来自用户自身播放序列**的品味信号："跟你的种子歌在同一场
收听里一起出现过的歌，你还没切它"。

## 4. Thompson bandit 配额（bandit.ts + channels.ts）

每通道一个 Beta(α, β) 臂（`state.channelBandit`）：完播/喜欢 α+1，早切/不喜欢 β+1，
同一 playId 只记一笔（`LedgerEntry.banditCounted` 幂等标记，显式反馈与隐式结算共享）。

- 读取时按 30 天半衰期衰减计数（品味漂移可被重新探索），样本 <5 的通道保持中性；
- `thompsonMultiplier`：整数形状 Gamma 和近似 Beta 采样，p 线性映射到 [0.5, 1.5] 乘数，
  p=0.5 恰好中性；
- `planChannelQuotas` 用乘数调制各通道目标份额后再分配配额——D 通道总被切就自动收缩，
  A 通道总出好歌就自动扩张，探索的随机性由 Thompson 采样天然提供。

## 5. 状态迁移 v3 → v4

`stateSchema.ts`：`STATE_VERSION = 4`，新增 `tokenWeights`、`channelBandit`（均默认空）。
v1/v2 迁移逻辑不变（旧候选池仍作废，学习数据保留）；v3 数据升级到 v4 零损失。

## 6. 测试与验证

- 新增 4 组单测：分词（版本标记/风格词/降噪）、词面反馈（降权/升温/半衰期/钳位）、
  bandit（计数上限/样本门槛/钳位/配额再分布）、SAR 共现（anchor 资格/早切隔离/半衰期/空种子）；
  stateSchema 断言升级到 v4。`npm test` 82/82 通过。
- `eslint src/core/recommend` 干净；tsc 无新增错误。
- **Metro 真实打包验证通过**（`react-native bundle --platform android`，dev bundle 15MB）。

## 7. 真机验证建议

1. 连续听完若干首后查看 `getRadioStatus()`：`sessionHealth` 之外，可观察队列里
   A 通道占比随完播率上升（bandit 生效）；
2. 主动切掉几首"DJ版/Remix"后，后续批次里该类歌名权重应下降（`tokenWeights['dj']` 负值）；
3. 收听会话越连续（少切歌），与种子歌同场的候选出现频率越高（SAR 生效）；
4. 参数都在 `config.ts` 的 `nameToken` / `sessionCoOccurrence` / `bandit` 三节，可微调。

## 8. 后续路线（二期候选）

- **设备端音频风格嵌入**：react-native-fast-tflite（v3.x，Nitro/JSI，活跃维护）+
  MTG essentia MusiCNN/MusicNN TFLite 模型（几 MB，随包内置），对已完播歌曲后台抽
  30 秒音频 → 风格向量 → 候选池内余弦相似度排序。这是补上"无 genre 元数据"根本缺陷
  的质变项，工程大头在音频解码的原生桥接；essentia 库 AGPLv3，只加载模型文件可规避传染。
- 词面学习反哺搜索关键词（分词后的风格词进入 `buildPlaylistKeywords` 候选池）。
