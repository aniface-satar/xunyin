/* eslint-disable require-atomic-updates */
import RNFS from 'react-native-fs'
import { getMusicUrl } from '@/core/music'
import { getState, saveState, trimState } from './storage.ts'
import { buildPatches, computeLogMelFrames, MEL_BANDS, PATCH_FRAMES } from './melSpectrogram.ts'
import { decodeToPcmFile, isNativeAudioAvailable, loadModel, releaseModel, runModel } from './nativeAudio.ts'
import { recallLog } from './log.ts'
import { recommendationConfig as cfg } from './config.ts'
import { quantizeEmbedding, base64ToBytes, audioModelId } from './audioEmbedding.ts'

/**
 * 设备端音频风格嵌入管线（Android，MusiCNN 系 TFLite 模型）：
 * 完播的电台歌曲 → 后台解析播放链接 → 原生解码 30s 16kHz PCM → JS 计算 log-mel →
 * 原生 TFLite 推理 → 各 patch embedding 平均 → int8 量化存入本地状态。
 * 音频品味通过"歌单音频亲和度"传导到候选：不分析每个候选，
 * 而是用已分析歌曲的质心给候选来源歌单打分（纯函数见 audioEmbedding.ts）。
 *
 * 模型文件为可选资源（assets 或应用文档目录）；缺失时整个功能待命，不影响其余推荐链路。
 */

export { computePlaylistAudioAffinity } from './audioEmbedding.ts'

interface ModelInfo {
  path: string
  outputDim: number
  modelId: string
}

let modelInfo: ModelInfo | null = null
let modelPromise: Promise<ModelInfo> | null = null

const parseDim = (shape: string): number => {
  return shape.split('x').reduce((acc, part) => acc * (Number(part) || 1), 1)
}

const ensureModel = async(): Promise<ModelInfo> => {
  if (modelInfo) return modelInfo
  if (!modelPromise) {
    modelPromise = (async() => {
      const candidates = [
        cfg.audioFeature.modelAssetPath,
        `${RNFS.DocumentDirectoryPath}/${cfg.audioFeature.modelDocFileName}`,
      ]
      let lastError: unknown = null
      for (const path of candidates) {
        try {
          const shape = await loadModel(path)
          const inputDim = parseDim(shape.inputShape)
          const outputDim = parseDim(shape.outputShape)
          if (inputDim != PATCH_FRAMES * MEL_BANDS) {
            throw new Error(`unexpected model input shape: ${shape.inputShape}`)
          }
          modelInfo = { path, outputDim, modelId: audioModelId(shape.inputShape, shape.outputShape, outputDim) }
          recallLog('audioModelLoaded', { path, modelId: modelInfo.modelId, inputShape: shape.inputShape, outputShape: shape.outputShape })
          return modelInfo
        } catch (error) {
          lastError = error
        }
      }
      modelPromise = null
      throw lastError instanceof Error ? lastError : new Error('audio_model_missing')
    })()
  }
  return modelPromise
}

interface AnalysisJob {
  trackKey: string
  musicInfo: LX.Music.MusicInfo
}

const jobQueue: AnalysisJob[] = []
let draining = false
let lastRunAt = 0

export const getAudioFeatureStatus = () => {
  const state = getState()
  return {
    nativeAvailable: isNativeAudioAvailable(),
    modelReady: modelInfo != null,
    queued: jobQueue.length,
    analyzed: Object.keys(state.audioEmbeddings).length,
    dayCount: state.audioAnalysis.dayCount,
    dailyLimit: cfg.audioFeature.dailyLimit,
    lastRunAt: state.audioAnalysis.lastRunAt,
  }
}

const analyzeTrack = async(job: AnalysisJob): Promise<void> => {
  const model = await ensureModel()
  // 分析用直链，不允许切源（切源解析对"这首真实听过的歌"来说意义不大且更慢）
  const url = await getMusicUrl({ musicInfo: job.musicInfo, allowToggleSource: false })
  if (!url) throw new Error('no_play_url')
  const decoded = await decodeToPcmFile(url, cfg.audioFeature.analyzeSeconds, cfg.audioFeature.headers)
  try {
    const base64 = await RNFS.readFile(decoded.path, 'base64')
    const bytes = base64ToBytes(base64)
    const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4))
    const frames = computeLogMelFrames(pcm)
    const patches = buildPatches(frames)
    if (!patches.length) throw new Error('no_mel_patches')
    const average = new Float32Array(model.outputDim)
    for (const patch of patches) {
      // msd-musicnn 冻结图输入为 [batch, frames, bands]（帧优先，无通道维），
      // 与 buildPatches 的帧优先一维布局直接对应
      const result = await runModel(model.path, Array.from(patch), [1, PATCH_FRAMES, MEL_BANDS])
      for (let i = 0; i < model.outputDim; i++) average[i] += (result.output[i] ?? 0) / patches.length
    }
    const state = getState()
    const quantized = quantizeEmbedding(average)
    state.audioEmbeddings[job.trackKey] = {
      ...quantized,
      dim: model.outputDim,
      modelId: model.modelId,
      analyzedAt: Date.now(),
    }
    trimState()
    saveState()
    recallLog('audioAnalyzed', { trackKey: job.trackKey, dim: model.outputDim, patches: patches.length })
  } finally {
    RNFS.unlink(decoded.path).catch(() => {})
  }
}

const sleep = async(ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

const drainQueue = async(): Promise<void> => {
  if (draining) return
  draining = true
  try {
    while (jobQueue.length) {
      if (!isNativeAudioAvailable()) {
        jobQueue.length = 0
        break
      }
      const state = getState()
      const dayKey = new Date().toISOString().slice(0, 10)
      if (state.audioAnalysis.dayKey != dayKey) {
        state.audioAnalysis.dayKey = dayKey
        state.audioAnalysis.dayCount = 0
      }
      if (state.audioAnalysis.dayCount >= cfg.audioFeature.dailyLimit) {
        jobQueue.length = 0
        recallLog('audioQueue', { reason: 'daily_limit' })
        break
      }
      const wait = cfg.audioFeature.minIntervalMs - (Date.now() - lastRunAt)
      if (wait > 0) await sleep(wait)
      const job = jobQueue.shift()
      if (!job) break
      if (getState().audioEmbeddings[job.trackKey]) continue
      try {
        await analyzeTrack(job)
        lastRunAt = Date.now()
        const fresh = getState()
        fresh.audioAnalysis.lastRunAt = lastRunAt
        fresh.audioAnalysis.dayCount += 1
        saveState()
      } catch (error) {
        lastRunAt = Date.now()
        recallLog('audioAnalysisError', {
          trackKey: job.trackKey,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    draining = false
  }
}

/** 完播后调用：把这首歌排进后台分析队列（已有 embedding 或不满足条件时静默跳过）。 */
export const enqueueAudioAnalysis = (trackKey: string, musicInfo: LX.Music.MusicInfo): void => {
  if (!cfg.audioFeature.enabled || !isNativeAudioAvailable()) return
  if (!musicInfo || 'progress' in musicInfo) return
  if (getState().audioEmbeddings[trackKey]) return
  if (jobQueue.some(job => job.trackKey == trackKey)) return
  jobQueue.push({ trackKey, musicInfo })
  void drainQueue()
}

export const releaseAudioModel = async(): Promise<null> => releaseModel()

