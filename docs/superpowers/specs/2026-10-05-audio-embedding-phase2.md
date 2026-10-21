# 二期：设备端音频风格嵌入（MusiCNN TFLite）

- 日期：2026-10-05
- 状态：管线已实现，原生代码编译通过；模型文件与真机运行时验证待落地
- 关联：`2026-10-05-recommend-open-source-batch.md`（一期开源批次）

## 1. 目标与思路

补上"无 genre 元数据"的根本缺陷：对用户**真实听完**的歌做设备端音频分析，
得到风格嵌入向量，聚合出"收听品味质心"，再把品味传导到候选——

- **不分析每个候选**（每首要下载+解码+推理，成本不可行）；
- 而是给**候选的来源歌单**打音频亲和度分：歌单里被分析过的歌曲与质心的平均余弦
  覆盖率达标时，该歌单的所有候选在画像通道获得加分。

## 2. 架构

```
完播(natural_end) → enqueueAudioAnalysis（后台队列：串行、≥5min 间隔、日限 20）
  → getMusicUrl（不切源）→ [原生] AudioFeatureDecode：MediaCodec → 16kHz mono float32 PCM（缓存文件）
  → [JS] base64 读回 → computeLogMelFrames（FFT512 + Hann + 96 HTK mel + log10）
  → buildPatches（187 帧 ≈ 3s/patch）→ [原生] AudioFeatureTflite 逐 patch 推理
  → 各 patch embedding 平均 → int8 量化（per-vector scale）→ state.audioEmbeddings

generateQueue → getTasteCentroid（剔除负反馈歌曲）→ computePlaylistAudioAffinity
  → candidatePool A 通道权重 += 0.1 × 歌单音频亲和度
```

模块划分：

| 文件 | 职责 |
| --- | --- |
| `audioFeature/AudioDecodeModule.java` | MediaExtractor/MediaCodec 解码任意 URL/本地文件 → 16kHz 单声道 float32 PCM 文件（best-effort，失败即跳过） |
| `audioFeature/TfliteModule.java` | 通用 TFLite 推理器：load/run/release，模型语义全部在 JS 侧 |
| `audioFeature/AudioFeaturePackage.java` | RN NativeModule 注册（MainApplication 已挂载） |
| `melSpectrogram.ts` | MusiCNN 输入特征（纯 JS DSP，FFT 已用正弦自检验证） |
| `audioEmbedding.ts` | 纯函数层：量化/质心/歌单亲和度（node 单测覆盖） |
| `audioFeature.ts` | IO 与队列：解析链接、读 PCM、调度、节流 |
| `nativeAudio.ts` | NativeModule 桥接与能力探测（iOS 缺原生实现时整体待命） |

## 3. 关键设计

- **模型是可选资源**：先找 APK assets `models/musiconn-discogs.tflite`，再找应用文档目录
  同名文件；两者都缺则功能待命（`audio_model_missing`），不影响其余推荐链路。

  **模型状态：已转换并内置（2026-10-05）**。msd-musicnn-1.pb（3.2MB，官方
  `https://essentia.upf.edu/models/legacy/autotagging/msd/msd-musicnn-1.pb`）经
  TFLiteConverter 转出 3.15MB tflite，原件存于 `tools/msd-musicnn-1.pb`，转换要点：
  - 真实图结构与 melSpectrogram 假设不同：输入为 **3 维 `[1, 187, 96]`**
    （batch, 帧优先，无通道维），不是 [1,96,187,1]——`buildPatches` 的帧优先一维
    布局恰好直接对应，只修正了 runModel 的 shape 声明；
  - 图中第二个 Placeholder 在输出路径之外，转换时被自动裁剪；输出节点 `model/Sigmoid`，
    输出 `[1, 50]`（MSD 50 标签激活，当风格向量用）；
  - 随机输入推理自检通过（输出值域合理）；gradle `mergeDebugAssets` 确认模型已进
    assets，重新打 APK 即内置；
  - 备选 mtt（188 维）如需更大风格分辨率，同法转换即可——嵌入维度运行时读取，
    质心按 modelId 隔离，混存安全。**分发前复核 models.html 许可证条款**。
- **DSP 参数**：对齐 essentia TensorflowInputMusiCNN（16k/512窗/256hop/Hann/96 HTK mel
  0~11kHz/log10(1e-10+x)/187 帧patch）。这些参数与 essentia 源码的一致性无法在本仓库
  验证，若真机上 embedding 异常，先对照 essentia 源码校准 mel 伸缩公式与频带范围。
- **量化**：embedding 400 维 × 600 首 ≈ int8+base64 后每条 ~550 字符，状态体积可控；
  余弦相似度在反量化后计算，量化保留方向（cos > 0.999 自检）。
- **质心剔除负反馈**：被切/低分歌的 embedding 不进质心——单测验证了不剔除时
  "反向歌单"反而得分更高的缺陷。
- **节流**：串行 + 5 分钟最小间隔 + 每日 20 首上限 + 已分析去重；全部 best-effort，
  链接失效/解码失败静默跳过并记 DEV 日志。

## 4. 验证状态

- `npm test` 86/86（新增：DSP 正弦自检、patch 布局、量化 roundtrip、质心/亲和度含负样本剔除）
- eslint / tsc 对推荐模块干净
- `gradlew :app:compileDebugJavaWithJavac` 通过（tensorflow-lite 2.14.0 依赖解析成功；
  编译器抓出 Executors import 笔误与 ReadableMap keySet 兼容问题，均已修复）
- **未验证（需真机）**：MediaCodec 对各音源的解码成功率、TFLite 推理输出、
  DSP 与 essentia 的一致性、模型文件本身

## 5. 真机验证步骤

1. 模型已内置（assets + gradle 打包验证），直接重新打 APK 安装；
2. 听几首电台歌曲直至自然播完，观察 DEV 日志 `[recommend:audioAnalyzed]`；
3. `getRadioStatus()` 之外可用 `getAudioFeatureStatus()` 看 nativeAvailable/modelReady/analyzed；
4. 攒够 ~5 首分析后重新生成队列，观察日志 `generate` 的通道分布变化（A 通道音频亲和度生效）；
5. 若 embedding 无区分度，优先核对 melSpectrogram 参数与 essentia TensorflowInputMusiCNN
   （注意真实模型输入为帧优先 [1,187,96]，已按此适配）。

## 6. 参数（config.ts `audioFeature`）

analyzeSeconds 30 / minIntervalMs 5min / dailyLimit 20 / embeddingLimit 600 /
playlistMinCoverage 0.3 / headers UA 透传 / modelAssetPath + modelDocFileName。
