import { cosine } from './melSpectrogram.ts'
import type { AudioEmbedding, ObservedPlaylist } from './types.ts'

/**
 * 音频嵌入的纯函数层：量化/反量化、品味质心、歌单音频亲和度。
 * 无 react/原生依赖，可被 node 单测覆盖；IO 与队列在 audioFeature.ts。
 */

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    result += BASE64_CHARS[b0 >> 2]
    result += BASE64_CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    result += b1 == null ? '=' : BASE64_CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    result += b2 == null ? '=' : BASE64_CHARS[b2 & 63]
  }
  return result
}

export const base64ToBytes = (text: string): Uint8Array => {
  const clean = text.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4))
  let buffer = 0
  let bits = 0
  let cursor = 0
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[cursor++] = (buffer >> bits) & 0xff
    }
  }
  return out.subarray(0, cursor)
}

/** int8 量化：per-vector scale，byte 值带 +128 偏移（base64 只编码无符号字节）。 */
export const quantizeEmbedding = (vector: Float32Array) => {
  let maxAbs = 0
  for (let i = 0; i < vector.length; i++) maxAbs = Math.max(maxAbs, Math.abs(vector[i]))
  const scale = maxAbs > 0 ? maxAbs / 127 : 1
  const bytes = new Uint8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round(vector[i] / scale) + 128))
  }
  return { q: bytesToBase64(bytes), scale }
}

export const dequantizeEmbedding = (embedding: AudioEmbedding): Float32Array => {
  const bytes = base64ToBytes(embedding.q)
  const vector = new Float32Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) vector[i] = (bytes[i] - 128) * embedding.scale
  return vector
}

/**
 * 模型标识：由真实张量形状与输出维度派生，替换写死的字符串。
 * 换模型或换输出层都会改变标识，旧向量因此自动失效（不会与新质心做余弦）。
 */
export const audioModelId = (inputShape: string, outputShape: string, outputDim: number): string =>
  `in${inputShape.replace(/[^0-9a-zA-Z]+/g, 'x')}-out${outputShape.replace(/[^0-9a-zA-Z]+/g, 'x')}-d${outputDim}`

/**
 * 品味质心应当使用的模型标识：数量最多的 modelId；无可比样本时返回 null。
 * 质心与亲和度共用该判定，保证两处过滤在同一代向量空间里。
 */
const centroidModel = (
  embeddings: Readonly<Record<string, AudioEmbedding>>,
  excludeKeys: ReadonlySet<string>,
): string | null => {
  const list = Object.entries(embeddings)
    .filter(([trackKey]) => !excludeKeys.has(trackKey))
    .map(([, embedding]) => embedding)
  if (!list.length) return null
  const countByModel = new Map<string, number>()
  for (const embedding of list) countByModel.set(embedding.modelId, (countByModel.get(embedding.modelId) ?? 0) + 1)
  let majorityModel = list[0].modelId
  let majorityCount = 0
  for (const [modelId, count] of countByModel) {
    if (count > majorityCount) {
      majorityModel = modelId
      majorityCount = count
    }
  }
  return majorityModel
}

/**
 * 收听品味质心：embedding 的均值；无数据返回 null。
 * excludeKeys 用于剔除负反馈歌曲（被切/不喜欢）——负样本会把质心拉向
 * 品味反方向，导致"反向歌单"反而得分更高。
 * 不同模型（modelId）的向量空间不可比，质心只取多数派的模型。
 */
export const getTasteCentroid = (
  embeddings: Readonly<Record<string, AudioEmbedding>>,
  excludeKeys: ReadonlySet<string> = new Set(),
): Float32Array | null => {
  const majorityModel = centroidModel(embeddings, excludeKeys)
  if (majorityModel == null) return null
  // 模型混用时按数量最多的 modelId 过滤，避免不同向量空间做余弦
  const sameModel = Object.entries(embeddings)
    .filter(([trackKey, embedding]) => !excludeKeys.has(trackKey) && embedding.modelId == majorityModel)
    .map(([, embedding]) => embedding)
  if (!sameModel.length) return null
  const dim = sameModel[0].dim
  const centroid = new Float32Array(dim)
  for (const embedding of sameModel) {
    const vector = dequantizeEmbedding(embedding)
    for (let i = 0; i < dim; i++) centroid[i] += vector[i] / sameModel.length
  }
  return centroid
}

/**
 * 歌单音频亲和度：歌单内已分析歌曲与品味质心的平均余弦（归一化到 0~1）。
 * 覆盖率不足 minCoverage 的歌单不参与，避免一两首样本产生噪声分。
 * 只有与质心同一 modelId（同一代模型）的向量参与打分：换模型后旧向量既不计入
 * 分子也不计入覆盖，覆盖率分母仍是该歌单已获取的曲目数。
 */
export const computePlaylistAudioAffinity = (
  embeddings: Readonly<Record<string, AudioEmbedding>>,
  observedPlaylists: Readonly<Record<string, ObservedPlaylist>>,
  minCoverage = 0.3,
  excludeKeys: ReadonlySet<string> = new Set(),
): Record<string, number> => {
  const centroid = getTasteCentroid(embeddings, excludeKeys)
  if (!centroid) return {}
  // 质心来自哪一代模型，歌单样本就必须来自同一代，否则余弦没有意义
  const centroidModelId = centroidModel(embeddings, excludeKeys)
  const result: Record<string, number> = {}
  for (const playlist of Object.values(observedPlaylists)) {
    const total = playlist.fetchedTracks.length
    if (!total) continue
    let covered = 0
    let sum = 0
    for (const trackKey of playlist.fetchedTracks) {
      const embedding = embeddings[trackKey]
      if (!embedding) continue
      if (centroidModelId && embedding.modelId != centroidModelId) continue
      covered += 1
      sum += (cosine(dequantizeEmbedding(embedding), centroid) + 1) / 2
    }
    if (covered / total < minCoverage) continue
    result[playlist.id] = Math.max(0, Math.min(1, sum / covered))
  }
  return result
}
