/**
 * 面板「背后画面」的快照 —— 真毛玻璃的底图。
 *
 * 为什么需要这一层：
 * 壁纸模式下，页面上浮着封面、文字、图标。弹层若只把「壁纸副本」糊一遍垫在下面，
 * 糊掉的只是那张照片 —— 背后真实显示的封面和文字一个像素都没被糊。观感因此是
 * 「面板自带了一张糊图」，而不是「背后的画面被一朵毛玻璃盖住」。这两件事在实机上
 * 差别很明显：前者面板内外是两张互不相干的图，后者是同一幅画面的清晰版与模糊版。
 *
 * 为什么截得到「背后」：
 * 这些面（Dialog / Popup / Menu / 各 Sheet / 更新窗口 / 分享卡）用的都是 RN 的 `Modal`，
 * 在 Android 上是独立的 Dialog window；而 view-shot 的 captureScreen 取的是
 * `activity.window.decorView` 里的 `android.R.id.content` —— 天然不含 Modal 自己的内容。
 * 于是面板挂载那一刻拍一张，拍到的正是它背后那一帧。
 *
 * 为什么降采样到 1/4：
 * 模糊会抹掉细节，1/4 分辨率糊 24 与全分辨率糊 24 肉眼没有差别，但解码与纹理上传的
 * 像素数少 16 倍。注意 view-shot 仍按全屏尺寸绘制一次（它的实现如此），省下来的是
 * 后续这一整段，不是绘制本身 —— 这也是下面要做并发合并与缓存的直接原因。
 *
 * 已知限制：抽屉（DrawerLayoutAndroid）与页面同处一个 window，它一旦滑进来就会出现在
 * 快照里。那一处的底图只能在「抽屉还在屏幕外」时拍，见 SongList 里的预拍说明。
 */
import { Dimensions, StatusBar } from 'react-native'
import { captureScreen } from 'react-native-view-shot'

import themeState from '@/store/theme/state'
import { windowSizeTools } from './windowSizeTools'

export interface BackdropSnapshot {
  uri: string
  /** 输出像素尺寸（已降采样），供调用方按比例铺图 */
  width: number
  height: number
  /** 拍摄时刻，用于 TTL 判定 */
  at: number
  /** 输出像素相对屏幕 DP 的比例；显示端据此等比缩小 blurRadius */
  scale: number
}

/** 输出缩到屏宽的 1/4：糊完看不出差别，解码与上传省 16 倍像素 */
const SNAPSHOT_SCALE = 0.25

/**
 * 同一份快照的复用窗口。
 *
 * 一次「打开一个面」往往会连着挂载多个 GlassBackdrop（Sheet 里再套 Dialog、
 * 分享卡里再套确认框），它们必须共用同一张图 —— 否则每个面各拍一次，
 * 一次点击就要付出好几次全屏绘制。
 *
 * 1.5s 是实测取舍：再短，连点 ⋮ 菜单那几下会各自重拍；再长，页面滚动过之后
 * 用到的就是一张「上一屏」的图。好在糊 24 再压 0.62 之后，内容本身已经不可辨，
 * 过时只会体现在明暗分布上。
 */
const CACHE_TTL = 1500

let cached: BackdropSnapshot | null = null
let pending: Promise<BackdropSnapshot | null> | null = null

const resolveSize = () => {
  const size = windowSizeTools.getSize()
  if (size.width >= 1 && size.height >= 1) return size
  // 冷启动早期 windowSizeTools 还没 init，退化到 Dimensions（同样是整屏，含状态栏）
  const win = Dimensions.get('screen')
  return { width: win.width, height: win.height }
}

const capture = async(): Promise<BackdropSnapshot | null> => {
  const size = resolveSize()
  const width = Math.max(1, Math.round(size.width * SNAPSHOT_SCALE))
  // captureScreen 拍的是 Activity 的 content 区，不包含状态栏；输出必须保持 content
  // 区自己的宽高比，否则显示回屏幕时会被纵向拉伸。显示端也会补回同样的状态栏偏移。
  const contentHeight = Math.max(1, size.height - (StatusBar.currentHeight ?? 0))
  const height = Math.max(1, Math.round(contentHeight * SNAPSHOT_SCALE))
  try {
    const uri = await captureScreen({
      format: 'jpg',
      quality: 0.9,
      result: 'tmpfile',
      width,
      height,
    })
    return { uri, width, height, at: Date.now(), scale: SNAPSHOT_SCALE }
  } catch {
    // 截图失败在真机上不是异常路径（老机型、安全窗口、无 Activity 都会走到这里），
    // 调用方据此退回「糊壁纸」那一版，不该把它抛到上层
    return null
  }
}

/**
 * 取一张「背后的画面」。maxAge 传 0 表示强制重拍。
 *
 * 在途请求不重复发起：多个面同时挂载时它们拿到的是同一个 promise。
 */
export const requestBackdropSnapshot = async(maxAge = CACHE_TTL): Promise<BackdropSnapshot | null> => {
  if (cached != null && Date.now() - cached.at <= maxAge) return Promise.resolve(cached)
  if (pending != null) return pending

  pending = capture().then((next) => {
    pending = null
    if (next != null) cached = next
    return next
  })
  return pending
}

/**
 * 强制重拍一张，供「抽屉关着、画面干净」的时刻调用（见 SongList）。
 *
 * 与 requestBackdropSnapshot(0) 的区别只在语义：这里明确表达「这一张是留给下一次用的底」，
 * 调用点不必再重复声明 maxAge = 0。
 */
export const primeBackdropSnapshot = async() => requestBackdropSnapshot(0)

/** 取仍有效的缓存；过期快照不显示，避免把上一屏画面铺到当前面板里 */
export const getCachedBackdropSnapshot = (maxAge = CACHE_TTL) => {
  return cached != null && Date.now() - cached.at <= maxAge ? cached : null
}

/**
 * 面板打开前的统一预拍。
 *
 * 玻璃面（`GlassBackdrop`）挂载时就要拿到"背后那一帧"，否则第一帧只能空着等截图
 * （60~150ms），观感是面板先透明、过一会儿才糊起来。先在打开动作里拍好，
 * 挂载时 `getCachedBackdropSnapshot()` 就能直接命中，面板从第一帧起就是最终形态。
 *
 * 普通主题不花这一趟：那边本来就没有毛玻璃。
 *
 * 超时兜底：截图本身若迟迟不回来，宁可先开面板（玻璃层会自己补），也不能把点击卡住。
 * 320ms 与面板入场的量级相当，用户感知不到。
 */
const PANEL_PRIME_TIMEOUT = 320

export const primeBackdropForPanel = async() => {
  if (!themeState.theme['is-wallpaper']) return null
  return Promise.race([
    requestBackdropSnapshot(),
    new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, PANEL_PRIME_TIMEOUT)
    }),
  ])
}
