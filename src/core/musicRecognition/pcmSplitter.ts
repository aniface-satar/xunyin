// 48kHz 单声道 PCM16 -> 网易指纹输入的纯降采样。
// 抽取公式必须与上游胶水 toNCMBuffer 逐点一致：out[i] = pcm[from * rate + i * (rate / 8000)]。
// 改了这里等于改了喂给 afp.wasm 的样本顺序，识别会静默变差，不会报错。
export const NCM_SAMPLE_RATE = 48000
export const NCM_TARGET_RATE = 8000
export const LISTEN_SECONDS = 8
export const WINDOW_FROM_SECONDS = 1
export const WINDOW_LEN_SECONDS = 6

export const decimateTo8k = (pcm: Int16Array, sampleRate: number, fromSeconds: number, lenSeconds: number): Int16Array => {
  const step = Math.round(sampleRate / NCM_TARGET_RATE)
  const start = fromSeconds * sampleRate
  const out = new Int16Array(lenSeconds * NCM_TARGET_RATE)
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
