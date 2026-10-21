import { httpFetch } from '@/utils/request'
import { buildMatchBody, buildTagUrl, createTagId, parseMatchResponse, SHAZAM_HEADERS, unwrapMatchBody } from './shazamApi.ts'
import { SHAZAM_SAMPLE_RATE, signatureFromPcm16k } from './shazamSignature.ts'
import { decimate, LISTEN_SECONDS, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS } from './pcmSplitter.ts'
import type { RecognizeEngine, RecognizedSong } from './types.ts'

// 超时交给 httpFetch（同 ncmEngine）。Shazam 端点在境外，本机实测 0.3~0.7s，
// 真机上给到 9s 与网易一致：再长就是在「匹配中」干等，短了会把正常慢网判成失败。
const REQUEST_TIMEOUT_MS = 9000

// pcm 是原生采集的原始窗口（48kHz），Shazam 要 16kHz，这里自己抽。
// numberSamples < 128 时 signatureFromPcm16k 才回 null，而定长窗口恒为 96000 个样本，
// 所以那条分支只在采集本身空了的时候才走到 —— 那是故障，不是「没听到歌」，照契约抛。
export const recognizeShazam = async(pcm: Int16Array, sampleRate: number): Promise<RecognizedSong | null> => {
  const window16k = decimate(pcm, sampleRate, SHAZAM_SAMPLE_RATE, WINDOW_FROM_SECONDS, WINDOW_LEN_SECONDS)
  const startedAt = Date.now()
  const signature = signatureFromPcm16k(window16k, LISTEN_SECONDS)
  if (!signature) throw new Error('shazam signature is empty')
  if (__DEV__) {
    console.log('[recognition] shazam signature:', (signature.uri.length / 1024).toFixed(1) + 'KB',
      (Date.now() - startedAt) + 'ms')
  }

  const body = buildMatchBody(signature.uri,
    Math.round(signature.numberSamples * 1000 / SHAZAM_SAMPLE_RATE), Date.now())
  const resp = await httpFetch(buildTagUrl(createTagId(), createTagId()), {
    method: 'post',
    headers: SHAZAM_HEADERS,
    body,
    timeout: REQUEST_TIMEOUT_MS,
  }).promise
  // 与 ncm 同一套规矩：非 2xx / 没解析成 JSON 一律抛出去，不许降级成 null，
  // 否则「服务挡了我们」会一路被说成「没听到歌」，退避保险丝永远不跳。
  return parseMatchResponse(unwrapMatchBody({ ok: resp.ok, status: resp.statusCode, body: resp.body }))
}

export const createShazamEngine = (): RecognizeEngine => ({
  id: 'shazam',
  recognize: recognizeShazam,
})
