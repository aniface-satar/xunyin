import type { Guard, RecognizeEngine, RecognizeHit, RecognizeRound } from './types.ts'

// 一轮 = 同一份音频并行喂给数组里的每个引擎，谁都别想把谁短路掉：
// 结果页要按引擎分区，「网易云听出来了」和「Shazam 也听出来了」是两件事，
// 串行降级只会让后一个引擎永远没机会开口。
// 并行而不是串行：串行的话一轮的匹配段从 ~2s 变成 ~3.3s，一分钟就少听一轮，
// 用同样的请求量换更少的听音覆盖。
//
// 四条不可让的语义（改动前先想清楚）：
// 1. 引擎「返回 null」是安静未命中，走 no_match；只有「抛异常」才算服务故障，
//    走 failed 并累计退避。把异常 catch 成未命中等于拆掉保险丝——
//    服务真挂了用户会无限重试。
// 2. 一轮只记一次账：两个引擎同时挂也只算一次失败（各记一次等于双倍惩罚用户），
//    只要有一个听到了歌就算这一轮成功，清零退避。
// 3. 闸门先于引擎：cooldown 期间一个请求都不发（每日次数上限已按用户裁定取消，
//    挡量的只剩退避与远端开关）。
// 4. engines 可能为空数组（运营把引擎全关，见 remoteConfig.sanitizeConfig；
//    也可能是这台设备的 WebView 起不来、ncm 被装配层剔除），这时返回 unsupported 而不是抛。
//
// pcm 是原生采集的原始窗口，这里原样把同一份引用与采样率交给每个引擎，不拷贝也不降采样：
// 网易引擎自己抽 8k，Shazam 引擎自己抽 16k。两个引擎同时读同一块内存，
// 所以这里更没有谁可以就地加工它。
export const recognizeWithEngines = async(
  engines: RecognizeEngine[],
  pcm: Int16Array,
  sampleRate: number,
  guard: Guard,
): Promise<RecognizeRound> => {
  const gate = await guard.check()
  if (gate != 'allow') return { hits: [], failure: gate }
  if (!engines.length) return { hits: [], failure: 'unsupported' }

  // allSettled 的返回值按传入顺序排，所以 hits 天然按引擎数组顺序，慢的那个不会插到前面。
  const settled = await Promise.allSettled(engines.map(async engine => engine.recognize(pcm, sampleRate)))

  const hits: RecognizeHit[] = []
  let threw = false
  for (const [index, result] of settled.entries()) {
    if (result.status == 'fulfilled') {
      if (result.value) hits.push({ engineId: engines[index].id, song: result.value })
    } else {
      threw = true
    }
  }

  if (hits.length) {
    await guard.onSuccess()
    return { hits, failure: null }
  }
  if (threw) {
    await guard.onFailure()
    return { hits: [], failure: 'failed' }
  }
  return { hits: [], failure: 'no_match' }
}
