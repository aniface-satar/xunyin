import type { Guard, RecognizeEngine, RecognizeOutcome } from './types.ts'

// 按数组顺序串行降级：第一个给出结果的引擎就收工。
// 本期数组里只有 ncm；二期接 Shazam 时往尾部加一项，UI 与录音链路不动。
//
// 三条不可让的语义（改动前先想清楚）：
// 1. 引擎「返回 null」是安静未命中，走 no_match；只有「抛异常」才算服务故障，
//    走 failed 并累计一次退避。把异常 catch 成未命中等于拆掉保险丝——
//    服务真挂了用户会无限重试。
// 2. 闸门先于引擎：daily / cooldown 时一个请求都不发，也不占每日额度。
// 3. engines 可能为空数组（运营方把引擎全关，见 remoteConfig.sanitizeConfig），
//    这时返回 unsupported 而不是抛。
//
// pcm 是调用方抽好的 8kHz 识别窗口，这里原样透传同一引用，不拷贝也不重采样。
export const recognizeWithEngines = async(
  engines: RecognizeEngine[],
  pcm: Int16Array,
  guard: Guard,
): Promise<RecognizeOutcome> => {
  const gate = await guard.check()
  if (gate != 'allow') return { ok: false, reason: gate }
  if (!engines.length) return { ok: false, reason: 'unsupported' }

  await guard.onAttempt()
  let threw = false
  for (const engine of engines) {
    try {
      const song = await engine.recognize(pcm)
      if (song) {
        await guard.onSuccess()
        return { ok: true, song, engineId: engine.id }
      }
    } catch {
      threw = true
    }
  }
  if (threw) {
    await guard.onFailure()
    return { ok: false, reason: 'failed' }
  }
  return { ok: false, reason: 'no_match' }
}
