// 相对 import 必须带 .ts：这个文件被 `node --test` 直接加载，Node ESM 不认无扩展名的相对路径
// （实测 ERR_MODULE_NOT_FOUND: .../monet/sourceColor），而 Metro 0.80.12 带扩展名照样解析成功（已用探针 bundle 验过）。
import { analyzeArgbPixels, averageArgbOfPixels, measureArgbPixels, type CoverPixels } from './sourceColor.ts'
import { buildBlurSurface, buildCoverSurface, parseCssColor, type CoverBackdropMode, type CoverSurface } from './surface.ts'
import { TEXTURE_OUT_HEIGHT, type TextureRequest } from './texture.ts'
import { ATTEMPT_COOLDOWN_MS } from './attemptLedger.ts'
import type { IdleSchedule } from './analysisGate.ts'

/** 背景由哪一档给出。类型住在 surface.ts（配色层已经 import 它，反过来就成环），这里只是转发一个别名给调用方。
 *  ① monet：官方量化挑出的源色 + 洗色 + 蒙版；② blur：重度模糊的封面直接铺底，只用平均色与最亮块。
 *  两支共用同一套 tone 锚点写法与对比度闸门（见 spec §10.2），分岔只发生在"颜色从哪量出来"这一步。 */
export type CoverAlgo = CoverBackdropMode

/** 算法来自设置存储（用户可改、旧版本残留、被写坏都可能），所以在这里一次性归一。
 *  认不出的一律按 monet 走 —— 包括旧版本的「native」（安卓原生取色那条路已经整支删掉，
 *  它的种子色再也不会回来），也包括已经整档回退的「magic」（浓色模糊：旧设置里可能还存着这个值）。
 *  默认给 monet 而不是 blur 是有意的：② 还没在真机验收过（见 spec §10.4），
 *  脏值不该把一个没人看过的档位推到屏幕上。
 *  不归一的话脏值会开出第三个配色 key —— 白算一份色，还看不出来。 */
export const normalizeCoverAlgo = (value: unknown): CoverAlgo => value === 'blur' ? 'blur' : 'monet'

export const CACHE_LIMIT = 60
// 像素层单独设上限，而且要比 CACHE_LIMIT 小：一个 value 是最多 16384 个数字的数组，
// 比一条 CoverSurface 贵两个量级。pixelCache 原先只有 clearCache() 能清空，而全计划没有任何调用方，
// 长时间连播会把听过的每一张封面的原始像素都留在内存里。
export const PIXEL_LIMIT = 20
// 纹理层单独一个更小的上限：一条 value 是 132×294 PNG 的 base64（实测约 13 万字符），
// 比一条 CoverSurface 贵三个量级，60 条就是几 MB 的常驻字符串。
export const TEXTURE_LIMIT = 12

// 失败条目的保质期。原先失败和成功一样永久缓存，于是原生一次瞬时超时（移动网络下很常见）
// 就让那张封面整场会话不上色，用户唯一的出口是去设置里翻「动态背景」开关 —— 2026-10-15 真机
// 报的"时有时无"就是这个。现在失败只压一个窗口，过窗后同一张封面能重新问原生（自愈）。
// 必须比 store 那条 ATTEMPT_COOLDOWN_MS 小：两层时间戳都记在"结果到手那一刻"，而 store 的窗口
// 从"发起请求那一刻"起算，重试点要能落在像素层已过期之后，否则那次重试只是读到同一份 null，
// 自愈要多等一整个 store 窗口（约 30s 而不是 15s）。这里直接由冷却窗口减出来，
// 那条大小关系就是结构性的：改冷却，保质期跟着走，不会悄悄反过来。
// 减掉的 5_000 是给原生返回留的预算 —— 单次取色慢于 5s 时会落到第二个窗口，仍然会自己好。
export const NEGATIVE_TTL_MS = ATTEMPT_COOLDOWN_MS - 5_000

/** 像素到手之后的那一段配色，整段同步，所以要交给外面的调度闸门（见下面注入的 scheduleIdle）。
 *  ② blur 只量两个均值（逐像素一遍，实测比量化轻一个量级，不跑官方量化）；
 *  ① monet 还要跑量化挑源色（实测 143ms 里有 123ms 是那一段）。
 *  两支分岔只到"颜色从哪量出来"为止，底色锚点写法、蒙版与对比闸门共用 surface.ts 里的那一个定义。 */
const computeSurface = (pixels: CoverPixels, algo: CoverAlgo, fontArgb: number): CoverSurface | null => {
  // 一律传具名对象：average 与 highlight 传反不会报错，只会让闸门悄悄变乐观
  if (algo === 'blur') {
    const fields = measureArgbPixels(pixels)
    if (fields == null) return null
    return buildBlurSurface({ averageArgb: fields.average, highlightArgb: fields.highlight }, fontArgb)
  }
  const analysis = analyzeArgbPixels(pixels)
  if (analysis == null) return null
  return buildCoverSurface({ sourceArgb: analysis.source, averageArgb: analysis.average, highlightArgb: analysis.highlight }, fontArgb)
}

// now 是注入的时钟，只为让单测能把时间拨过窗口（node --test 里等 10 秒不可接受）；
// 生产调用方（index.ts）不传，走 Date.now。
// scheduleIdle 把"量化 + 配色"那一步（analyzeArgbPixels，实测 128×86 封面 143ms 全同步）
// 交给外面的调度闸门：播放页展开动画是 JS 驱动的 800ms timing，这段计算落在窗口里就掉帧。
// 默认值保持"立刻跑"，这样未注入闸门的调用方（含全部单测与纹理支）行为一字不变。
export const createCoverPalette = (
  fetchPixels: (url: string) => Promise<CoverPixels | null>,
  buildTexture: (request: TextureRequest) => Promise<string | null>,
  now: () => number = Date.now,
  scheduleIdle: IdleSchedule = async <T>(task: () => T): Promise<T> => task(),
) => {
  // 两层缓存：像素按 url 缓存（下载+量化只一次），配色按 url|font 缓存（暗/亮主题各一份）
  const pixelCache = new Map<string, Promise<CoverPixels | null>>()
  const pixelOrder: string[] = []
  const cache = new Map<string, CoverSurface | null>()
  const cacheOrder: string[] = []
  // clearCache() 之后，之前那一次在途请求算出来的结果不再写回（判据在文件末尾的代数比较）
  let generation = 0
  const pending = new Map<string, Promise<CoverSurface | null>>()
  const textureCache = new Map<string, string | null>()
  const textureOrder: string[] = []
  const pendingTexture = new Map<string, Promise<string | null>>()
  // 失败条目的落地时刻（像素按 url、配色按 key）。只有失败才记：成功那份色不会随时间变，
  // 过期机制只欠"失败要能自己好"这一件事，给成功条目设 TTL 等于白重下一张封面。
  const pixelFailedAt = new Map<string, number>()
  const surfaceFailedAt = new Map<string, number>()

  // 判据写成 now() >= at + TTL：时钟被拨回（at 落在未来）时这条为假，条目就一直压到时钟追上为止 ——
  // 宁可自愈晚点，也不能在这里开出第二条并发请求去挤原生那条单线程队列。
  const isExpired = (key: string, failedAt: Map<string, number>) => {
    const at = failedAt.get(key)
    return at !== undefined && now() - at >= NEGATIVE_TTL_MS
  }

  // 过期淘汰要把 LRU 顺序表里的这一条一起摘掉。不摘的话数组里留下幽灵项，length 虚高，
  // 真正的条目会被提前判成"最老"而淘汰（PIXEL_LIMIT/CACHE_LIMIT 的语义就漏了）。
  const drop = (order: string[], key: string) => {
    const index = order.indexOf(key)
    if (index !== -1) order.splice(index, 1)
  }

  // async 是仓库规则要求的（@typescript-eslint/promise-function-async：非 async 函数返回 Promise 会报），
  // 不是功能需要。去重靠 pixelCache 里那条原始 promise：async 包装只是再套一层壳，
  // 命中缓存时不会第二次调用 fetchPixels，第 2、7 条用例仍然量得到。
  const fetchOnce = async(picUrl: string): Promise<CoverPixels | null> => {
    // 失败过期：把这条 url 从像素层整个摘掉，下面就走回"没缓存"那条路，重新问原生。
    if (isExpired(picUrl, pixelFailedAt)) {
      pixelCache.delete(picUrl)
      pixelFailedAt.delete(picUrl)
      drop(pixelOrder, picUrl)
    }
    const cached = pixelCache.get(picUrl)
    if (cached) return cached
    // 取色失败（null）也进缓存，但只压 NEGATIVE_TTL_MS 那么久：原生侧是单线程队列，
    // 坏源封面若不缓存就会每跳一次这首歌再排一次失败请求，把当前这首歌的上色挤到一串失败后面。
    // 2026-10-15 之前的版本没有期限，于是"一次瞬时超时 = 这首歌整场会话不上色"，
    // 用户只能去设置里翻「动态背景」开关（那已经是唯一的出口，见 NEGATIVE_TTL_MS 注释）。
    const fetch = (async() => {
      let value: CoverPixels | null = null
      try {
        const result = await fetchPixels(picUrl)
        // 原生桥是真实边界：行宽只能在这里自证。长度与宽高不自洽时纹理会跨行采样，
        // 斜纹是"看得见的花屏"，比直接不涂色更难查 —— 不如在这里判成失败走回落。
        if (result != null && Array.isArray(result.pixels) && result.pixels.length > 0 &&
          result.width >= 1 && result.height >= 1 && result.pixels.length === result.width * result.height) {
          value = result
        }
      } catch {
        // 原生桥抛错就是取色失败：这里不改 value（初始化已是 null），时刻由下面那条 .then 记
      }
      return value
    })()
    // 失败时刻记在"结果到手"这一刻，和配色层那份同源（两层同时到期，重试不会一层通了另一层还压着）。
    // 两个细节是承重的：
    // 1) 挂在 .then 而不是内层函数体里 —— 内层若同步抛错（fetchPixels 不是 async 的替身），
    //    在 IIFE 里引用正在初始化的 task 会踩到 TDZ 直接 ReferenceError；.then 回调永远在微任务里跑。
    // 2) 只有还是当前条目时才改账 —— 被 LRU 提前淘汰的那条在途任务若也写时刻，就会留下
    //    "条目没了、时间戳还在"的旧记录，下一次同 url 的在途任务会被它误判成过期，
    //    等于自己开出第二条并发原生请求（这里要避免的恰恰就是这个）。
    const task = fetch.then(value => {
      if (pixelCache.get(picUrl) !== task) return value
      // 对称改账：失败记时刻、成功清时刻。isExpired 只认时间戳，好色那一格若留着旧的失败时刻，
      // 就会被判成过期的失败条目 —— 每过一个窗口白重下一张封面（配色层同理，见 remember）。
      if (value == null) pixelFailedAt.set(picUrl, now())
      else pixelFailedAt.delete(picUrl)
      return value
    })
    pixelCache.set(picUrl, task)
    pixelOrder.push(picUrl)
    if (pixelOrder.length > PIXEL_LIMIT) {
      const oldest = pixelOrder.shift()!
      if (oldest !== picUrl) {
        pixelCache.delete(oldest)
        // 时间戳跟着条目一起删：url 都不在这层了，留着旧时刻下次会被拿来判新一轮的过期
        pixelFailedAt.delete(oldest)
      }
    }
    return task
  }

  // 读写两处的 key 只由这一条式子生成。配色层命中与否全看这两处串不串得上，
  // 而只数 fetchPixels 调用次数的断言观察不到它：把写入那处的分隔符改掉，8 条用例照样全绿（控制方实测）。
  // algo 必须进 key：同一张封面 + 同一支字色，三档算出来的就是三份色，共用一格会变成
  // "切了档但屏幕上还是上一次那份色"。像素层不带这个维度是有意的 —— 三档读的是同一份像素
  // （差别只在"要不要再跑一次量化挑源色"），切档只换用哪支色，不该把封面重下一遍。
  const paletteKey = (picUrl: string, fontArgb: number, algo: CoverAlgo) => `${picUrl}|${fontArgb}|${algo}`

  // outWidth 进 key：纹理是按屏幕宽高比折算的那张，尺寸变了就是另一张图，复用会把纹路拉歪。
  const textureKeyOf = (picUrl: string, fontArgb: number, outWidth: number) => `${picUrl}|${fontArgb}|${outWidth}`

  // 纹理层没有失败期限（配色/像素两层有），这是有意的：这一支现在没接进任何界面
  // （2026-10-15 spec §8 定的是"纹理代码留着但不接线"），没有用户看得见的"永远不上色"要自愈。
  // 真要启用纹理，这里的失败也得照 NEGATIVE_TTL_MS 过期，否则就是同一个缺陷的复刻。
  const rememberTexture = (key: string, value: string | null) => {
    if (!textureCache.has(key)) {
      textureOrder.push(key)
      if (textureOrder.length > TEXTURE_LIMIT) {
        const oldest = textureOrder.shift()!
        if (oldest !== key) textureCache.delete(oldest)
      }
    }
    textureCache.set(key, value)
  }

  const remember = (key: string, value: CoverSurface | null) => {
    // 失败才记时刻，成功必须把旧时刻删掉：isExpired 只认时间戳、不看这一格现在装的是不是好色，
    // 留着旧时刻等于把一份成功的色判成过期 —— 每过一个窗口白重下一张封面。
    if (value == null) surfaceFailedAt.set(key, now())
    else surfaceFailedAt.delete(key)
    if (!cache.has(key)) {
      cacheOrder.push(key)
      if (cacheOrder.length > CACHE_LIMIT) {
        const oldest = cacheOrder.shift()!
        if (oldest !== key) {
          cache.delete(oldest)
          surfaceFailedAt.delete(oldest)
        }
      }
    }
    cache.set(key, value)
  }

  // 同上：async 只为过 lint。pending 里的原始 promise 仍是去重的那一条。
  const load = async(key: string, picUrl: string, fontArgb: number, algo: CoverAlgo): Promise<CoverSurface | null> => {
    // 失败的配色过保质期就整个摘掉，下面重新算（像素层那一格同样会在那一刻过期，见 fetchOnce）
    if (isExpired(key, surfaceFailedAt)) {
      cache.delete(key)
      surfaceFailedAt.delete(key)
      drop(cacheOrder, key)
    }
    if (cache.has(key)) return cache.get(key)!
    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const task = (async() => {
      try {
        const pixels = await fetchOnce(picUrl)
        if (pixels == null) return null
        // 配色整段同步（monet 支实测 143ms），所以要等"没有交互在手"再跑。
        // 这里排在 fetchOnce 之后：像素那条 promise 已经进缓存，等调度器的这段时间不会重问原生。
        // 两档都在闸门之后 —— blur 那一段虽然轻，仍是逐像素循环，压在补间中间照样看得见。
        return await scheduleIdle(() => computeSurface(pixels, algo, fontArgb))
      } catch {
        return null
      } finally {
        pending.delete(key)
      }
    })()
    pending.set(key, task)
    return task
  }

  const loadTexture = async(key: string, picUrl: string, fontArgb: number, outWidth: number): Promise<string | null> => {
    if (textureCache.has(key)) return textureCache.get(key)!
    const inFlight = pendingTexture.get(key)
    if (inFlight) return inFlight
    const task = (async() => {
      try {
        // 钉成 monet：纹理支没有接进界面（spec §8 / 2026-10-15 §8），
        // 让它跟着设置里的算法漂等于给一条没人验收的路径改行为。
        const surface = await load(paletteKey(picUrl, fontArgb, 'monet'), picUrl, fontArgb, 'monet')
        if (surface == null) return null
        const source = await fetchOnce(picUrl)
        if (source == null) return null
        // 色阶带与那一支颜色来自同一次配色：带内每一档都已过对比度校验，纹理只在这个区间里摆明暗
        if (surface.band == null) return null
        return await buildTexture({ source, band: surface.band, tint: surface.tint, outWidth, outHeight: TEXTURE_OUT_HEIGHT })
      } catch {
        return null
      }
    })()
    pendingTexture.set(key, task)
    // 只摘自己：clearCache() 后同一 key 可能已挂上新一代的任务，误摘会让下一次并发再算一遍（一次 300ms+）。
    // 内层已 catch 全部异常，这条 finally 链不会 reject。
    void task.finally(() => {
      if (pendingTexture.get(key) === task) pendingTexture.delete(key)
    })
    return task
  }

  return {
    getCoverSurface: async(picUrl: string | null | undefined, fontColor: string, algo?: CoverAlgo | null): Promise<CoverSurface | null> => {
      if (!picUrl) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      const useAlgo = normalizeCoverAlgo(algo)
      const key = paletteKey(picUrl, fontArgb, useAlgo)
      const gen = generation
      return load(key, picUrl, fontArgb, useAlgo).then(surface => {
        // 还在同一代里才写回：翻开关 clearCache() 之后才到达的旧判定（多半是 null）必须丢掉，
        // 否则它会立刻把刚清空的这一格重新占住，自愈（NEGATIVE_TTL_MS）和翻开关两条出口一起被压住。
        if (gen === generation) remember(key, surface)
        return surface
      })
    },
    getCoverTexture: async(picUrl: string | null | undefined, fontColor: string, outWidth: number): Promise<string | null> => {
      if (!picUrl || !Number.isInteger(outWidth) || outWidth < 1) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      const key = textureKeyOf(picUrl, fontArgb, outWidth)
      const gen = generation
      return loadTexture(key, picUrl, fontArgb, outWidth).then(uri => {
        // 与配色层同一套代数判据：翻开关 clearCache() 之后晚到的结果必须丢掉
        if (gen === generation) rememberTexture(key, uri)
        return uri
      })
    },
    // 分享卡的明暗判定只看"这张封面整体偏亮还是偏暗"，所以只要平均色，不跑官方量化那 123ms。
    // 复用像素层的 fetchOnce：同一张封面在播放页已经暖过，海报页不该再问一次原生。
    getCoverAverageArgb: async(picUrl: string | null | undefined): Promise<number | null> => {
      if (!picUrl) return null
      return averageArgbOfPixels(await fetchOnce(picUrl))
    },
    clearCache() {
      generation++
      pixelCache.clear()
      pixelOrder.length = 0
      pixelFailedAt.clear()
      cache.clear()
      cacheOrder.length = 0
      surfaceFailedAt.clear()
      pending.clear()
      textureCache.clear()
      textureOrder.length = 0
      pendingTexture.clear()
    },
  }
}
