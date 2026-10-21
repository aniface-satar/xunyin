// 「当前正在播的这一首」的全屏播控页背景预焐。
//
// 为什么有它：背景的两种效果（① 莫奈取色 / ② 封面模糊）都由 coverPalette 按 `picUrl|font|algo`
// 现算现缓存 —— 而"现算"的触发点在 useCoverSurface，也就是**打开全屏播控页那一刻**。
// 于是从列表/首页切歌、或在别的页面上停了一会儿再进播放页，第一帧拿到的只能是保守底，
// 脸色要等原生图请求 + 一段空闲量化（monet 支实测 143ms）之后才浮现。下一首有 preloadNextMusic
// 的 palette/coverBytes 两步焐着（切歌即热），当前这一首反倒没人管 —— 这个模块补的就是这一格。
//
// 两条边界与预热那两步逐字相同（见 preloadNextMusic.ts 的 palette 步注释）：
// 1) **只焐 coverPalette 的缓存**：调 getCoverSurface / prefetchCoverImage，绝不碰
//    coverBackdropStore 的 attempts 账本与 generation —— 那张账管的是"该不该再问原生、什么时候自愈"，
//    去动它就是把「时有时无」那个缺陷重写一遍。两边按 `picUrl|font|algo` 合并 promise，
//    页面真正打开时读到的是同一条在途/同一格缓存，不会往原生队列里压第二条。
// 2) **失败静默**：这是"提前焐"，不是"必须有"。取不到就等页面打开时按账本自愈（NEGATIVE_TTL_MS 那条）。
//
// 触发点选 playerMusicInfoChanged 而不是 musicToggled：pic 是异步落定的 —— 先给 meta.picUrl，
// 随后可能被 getPicPath 的解析结果替掉（见 core/player/player.ts），而 useCoverSurface 读的正是
// 最后落定的那一格。每首歌这个事件会来好几次，所以按 pic 去重；档位进去重键是为了翻档后能重焐。
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { getCoverSurface } from '@/utils/monet'
import { normalizeCoverAlgo, type CoverAlgo } from '@/utils/monet/coverPalette'
import { ON_COVER_FONT_CSS } from '@/utils/monet/surface'
import { prefetchCoverImage } from '@/utils/nativeModules/palette'
import { defaultHeaders } from '@/components/common/Image'

/** 最近焐过的那一格。配色层的 LRU 会自己淘汰，这里只解决"同一首歌别焐第二遍"。 */
let warmedPic: string | null = null
let warmedAlgo: CoverAlgo | null = null

const warm = () => {
  // 关着就不焐：这一支的全部收益只发生在动态背景生效时，开关关掉时付出的却是
  // 一条原生图请求 + 一段空闲量化。主题自带背景图（bg-image）那一格不在这里判 ——
  // 与预热那两步同一个口径：那张表在 resolveCoverBackdrop 里，这里只做缓存预热。
  if (!settingState.setting['theme.dynamicBg']) return
  const pic = playerState.musicInfo.pic
  if (!pic) return
  const algo = normalizeCoverAlgo(settingState.setting['theme.dynamicBgAlgorithm'])
  if (pic === warmedPic && algo === warmedAlgo) return
  warmedPic = pic
  warmedAlgo = algo
  // 配色（surface：底色 + 蒙版 + 分台）与封面字节（ImageBackground 走 force-cache 的那份）各焐各的。
  // 两条都不 await、不 catch 分支：palette 层内部已经把失败收成 null/负缓存，这里没有可做的事。
  void getCoverSurface(pic, ON_COVER_FONT_CSS)
  void prefetchCoverImage(pic, defaultHeaders)
}

export default () => {
  global.state_event.on('playerMusicInfoChanged', warm)
  // 开关/档位翻动：设置页那边先 clearCoverPaletteCache()（配色层整代作废），
  // 这里必须把去重账清掉再焐一次 —— 不清的话"刚切完档、这一首已经焐过了"会一直挂在旧档的缓存上，
  // 直到下一首歌才热。清缓存之后到达的旧世代结果由配色层的 generation 判据自己丢掉（见 coverPalette）。
  const handleConfigUpdated: typeof global.state_event.configUpdated = (keys) => {
    if (keys.includes('theme.dynamicBg') || keys.includes('theme.dynamicBgAlgorithm')) {
      warmedPic = null
      warmedAlgo = null
      warm()
    }
  }
  global.state_event.on('configUpdated', handleConfigUpdated)
  // 启动时如果已经有一首在播/要播（比如上次退出时的队列恢复了），先焐一次；
  // 没有歌（pic 为空）就是一次空跑。
  warm()
}
