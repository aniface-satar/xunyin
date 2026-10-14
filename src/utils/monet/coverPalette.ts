// 相对 import 必须带 .ts：这个文件被 `node --test` 直接加载，Node ESM 不认无扩展名的相对路径
// （实测 ERR_MODULE_NOT_FOUND: .../monet/sourceColor），而 Metro 0.80.12 带扩展名照样解析成功（已用探针 bundle 验过）。
import { analyzeArgbPixels, type CoverPixels } from './sourceColor.ts'
import { buildCoverSurface, parseCssColor, type CoverSurface } from './surface.ts'
import { TEXTURE_OUT_HEIGHT, type TextureRequest } from './texture.ts'

export const CACHE_LIMIT = 60
// 像素层单独设上限，而且要比 CACHE_LIMIT 小：一个 value 是最多 16384 个数字的数组，
// 比一条 CoverSurface 贵两个量级。pixelCache 原先只有 clearCache() 能清空，而全计划没有任何调用方，
// 长时间连播会把听过的每一张封面的原始像素都留在内存里。
export const PIXEL_LIMIT = 20
// 纹理层单独一个更小的上限：一条 value 是 132×294 PNG 的 base64（实测约 13 万字符），
// 比一条 CoverSurface 贵三个量级，60 条就是几 MB 的常驻字符串。
export const TEXTURE_LIMIT = 12

export const createCoverPalette = (
  fetchPixels: (url: string) => Promise<CoverPixels | null>,
  buildTexture: (request: TextureRequest) => Promise<string | null>,
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

  // async 是仓库规则要求的（@typescript-eslint/promise-function-async：非 async 函数返回 Promise 会报），
  // 不是功能需要。去重靠 pixelCache 里那条原始 promise：async 包装只是再套一层壳，
  // 命中缓存时不会第二次调用 fetchPixels，第 2、7 条用例仍然量得到。
  const fetchOnce = async(picUrl: string): Promise<CoverPixels | null> => {
    const cached = pixelCache.get(picUrl)
    if (cached) return cached
    // 取色失败（null）也进缓存，这是 Task 5 第 4 条用例钉住的行为：原生侧是单线程队列，
    // 坏源封面若不缓存就会每跳一次这首歌再排一次失败请求，把当前这首歌的上色挤到一串失败后面。
    // 代价是"瞬时失败即整会话不再上色"，出口在 Task 6：翻动"动态背景"开关时 clearCoverPaletteCache()。
    const task = (async() => {
      try {
        const value = await fetchPixels(picUrl)
        // 原生桥是真实边界：行宽只能在这里自证。长度与宽高不自洽时纹理会跨行采样，
        // 斜纹是"看得见的花屏"，比直接不涂色更难查 —— 不如在这里判成失败走回落。
        if (value == null || !Array.isArray(value.pixels) || value.pixels.length === 0) return null
        if (value.width < 1 || value.height < 1) return null
        return value.pixels.length === value.width * value.height ? value : null
      } catch {
        return null
      }
    })()
    pixelCache.set(picUrl, task)
    pixelOrder.push(picUrl)
    if (pixelOrder.length > PIXEL_LIMIT) {
      const oldest = pixelOrder.shift()!
      if (oldest !== picUrl) pixelCache.delete(oldest)
    }
    return task
  }

  // 读写两处的 key 只由这一条式子生成。配色层命中与否全看这两处串不串得上，
  // 而只数 fetchPixels 调用次数的断言观察不到它：把写入那处的分隔符改掉，8 条用例照样全绿（控制方实测）。
  const paletteKey = (picUrl: string, fontArgb: number) => `${picUrl}|${fontArgb}`

  // outWidth 进 key：纹理是按屏幕宽高比折算的那张，尺寸变了就是另一张图，复用会把纹路拉歪。
  const textureKeyOf = (picUrl: string, fontArgb: number, outWidth: number) => `${picUrl}|${fontArgb}|${outWidth}`

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
    if (!cache.has(key)) {
      cacheOrder.push(key)
      if (cacheOrder.length > CACHE_LIMIT) {
        const oldest = cacheOrder.shift()!
        if (oldest !== key) cache.delete(oldest)
      }
    }
    cache.set(key, value)
  }

  // 同上：async 只为过 lint。pending 里的原始 promise 仍是去重的那一条。
  const load = async(key: string, picUrl: string, fontArgb: number): Promise<CoverSurface | null> => {
    if (cache.has(key)) return cache.get(key)!
    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const task = (async() => {
      try {
        const pixels = await fetchOnce(picUrl)
        const analysis = pixels == null ? null : analyzeArgbPixels(pixels.pixels)
        return analysis == null ? null : buildCoverSurface(analysis.source, analysis.average, fontArgb)
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
        const surface = await load(paletteKey(picUrl, fontArgb), picUrl, fontArgb)
        if (surface == null) return null
        const source = await fetchOnce(picUrl)
        if (source == null) return null
        // 色阶带来自同一次配色：带内每一档都已过对比度校验，纹理只在这个区间里摆明度
        return await buildTexture({ source, band: surface.band, outWidth, outHeight: TEXTURE_OUT_HEIGHT })
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
    getCoverSurface: async(picUrl: string | null | undefined, fontColor: string): Promise<CoverSurface | null> => {
      if (!picUrl) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      const key = paletteKey(picUrl, fontArgb)
      const gen = generation
      return load(key, picUrl, fontArgb).then(surface => {
        // 还在同一代里才写回：翻开关 clearCache() 之后才到达的旧判定（多半是 null）必须丢掉，
        // 否则那次失败会重新占住这个 key，把「翻开关重试」这条唯一的出口一起废掉。
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
    clearCache() {
      generation++
      pixelCache.clear()
      pixelOrder.length = 0
      cache.clear()
      cacheOrder.length = 0
      pending.clear()
      textureCache.clear()
      textureOrder.length = 0
      pendingTexture.clear()
    },
  }
}
