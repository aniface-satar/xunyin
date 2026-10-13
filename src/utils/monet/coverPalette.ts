// 相对 import 必须带 .ts：这个文件被 `node --test` 直接加载，Node ESM 不认无扩展名的相对路径
// （实测 ERR_MODULE_NOT_FOUND: .../monet/sourceColor），而 Metro 0.80.12 带扩展名照样解析成功（已用探针 bundle 验过）。
import { analyzeArgbPixels } from './sourceColor.ts'
import { buildCoverSurface, parseCssColor, type CoverSurface } from './surface.ts'

export const CACHE_LIMIT = 60
// 像素层单独设上限，而且要比 CACHE_LIMIT 小：一个 value 是最多 16384 个数字的数组，
// 比一条 CoverSurface 贵两个量级。pixelCache 原先只有 clearCache() 能清空，而全计划没有任何调用方，
// 长时间连播会把听过的每一张封面的原始像素都留在内存里。
export const PIXEL_LIMIT = 20

export const createCoverPalette = (fetchPixels: (url: string) => Promise<number[] | null>) => {
  // 两层缓存：像素按 url 缓存（下载+量化只一次），配色按 url|font 缓存（暗/亮主题各一份）
  const pixelCache = new Map<string, Promise<number[] | null>>()
  const pixelOrder: string[] = []
  const cache = new Map<string, CoverSurface | null>()
  const cacheOrder: string[] = []
  const pending = new Map<string, Promise<CoverSurface | null>>()

  // async 是仓库规则要求的（@typescript-eslint/promise-function-async：非 async 函数返回 Promise 会报），
  // 不是功能需要。去重靠 pixelCache 里那条原始 promise：async 包装只是再套一层壳，
  // 命中缓存时不会第二次调用 fetchPixels，第 2、5 条用例仍然量得到。
  const fetchOnce = async(picUrl: string): Promise<number[] | null> => {
    const cached = pixelCache.get(picUrl)
    if (cached) return cached
    // 取色失败（null）也进缓存，这是 Task 5 第 4 条用例钉住的行为：原生侧是单线程队列，
    // 坏源封面若不缓存就会每跳一次这首歌再排一次失败请求，把当前这首歌的上色挤到一串失败后面。
    // 代价是"瞬时失败即整会话不再上色"，出口在 Task 6：翻动"动态背景"开关时 clearCoverPaletteCache()。
    const task = Promise.resolve(fetchPixels(picUrl)).catch(() => null)
    pixelCache.set(picUrl, task)
    pixelOrder.push(picUrl)
    if (pixelOrder.length > PIXEL_LIMIT) {
      const oldest = pixelOrder.shift()!
      if (oldest !== picUrl) pixelCache.delete(oldest)
    }
    return task
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
  const load = async(picUrl: string, fontArgb: number): Promise<CoverSurface | null> => {
    const key = `${picUrl}|${fontArgb}`
    if (cache.has(key)) return cache.get(key)!
    const inFlight = pending.get(key)
    if (inFlight) return inFlight

    const task = (async() => {
      try {
        const pixels = await fetchOnce(picUrl)
        const analysis = pixels == null ? null : analyzeArgbPixels(pixels)
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

  return {
    getCoverSurface: async(picUrl: string | null | undefined, fontColor: string): Promise<CoverSurface | null> => {
      if (!picUrl) return null
      const fontArgb = parseCssColor(fontColor)
      if (fontArgb == null) return null
      return load(picUrl, fontArgb).then(surface => {
        remember(`${picUrl}|${fontArgb}`, surface)
        return surface
      })
    },
    clearCache() {
      pixelCache.clear()
      pixelOrder.length = 0
      cache.clear()
      cacheOrder.length = 0
      pending.clear()
    },
  }
}
