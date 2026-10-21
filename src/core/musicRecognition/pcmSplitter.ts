// 原始采集 PCM -> 引擎输入窗口的纯降采样。各引擎自己指定目标率，面板不掺和。
// 抽取公式必须与上游胶水 toNCMBuffer 逐点一致：out[i] = pcm[from * rate + i * (rate / target)]。
// 改了这里等于改了喂给识别器的样本顺序，识别会静默变差，不会报错。
export const NCM_SAMPLE_RATE = 48000
export const NCM_TARGET_RATE = 8000
export const LISTEN_SECONDS = 8
export const WINDOW_FROM_SECONDS = 1
export const WINDOW_LEN_SECONDS = 6

export const decimate = (pcm: Int16Array, sampleRate: number, targetRate: number, fromSeconds: number, lenSeconds: number): Int16Array => {
  const step = Math.round(sampleRate / targetRate)
  const start = fromSeconds * sampleRate
  const out = new Int16Array(lenSeconds * targetRate)
  for (let i = 0; i < out.length; i++) {
    const index = start + i * step
    out[i] = index < pcm.length ? pcm[index] : 0
  }
  return out
}

export const toLittleEndianBytes = (samples: Int16Array): Uint8Array => {
  const view = new DataView(new ArrayBuffer(samples.length * 2))
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true)
  return new Uint8Array(view.buffer)
}
