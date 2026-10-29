import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// RN 组件没有测试渲染器，只能读源码盯住"浮窗自己挂糊底"这条接线不能退回去。
// 背景：壁纸模式把 `c-content-background` 换成透明，不糊的话一整块内容直接压在照片纹理上，
// 每行字都要在图的明暗里找 —— Dialog / Popup / 分享卡都这么糊，菜单浮窗与更新窗口跟着同一手。
const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (relPath: string) => readFileSync(path.join(rootPath, 'src', relPath), 'utf8')

const menuSource = readSrc('components/common/Menu.tsx')
const popupSource = readSrc('components/common/Popup.tsx')
const dialogSource = readSrc('components/common/Dialog.tsx')
const shareCardModalSource = readSrc('components/ShareCard/ShareCardModal.tsx')
const modalContentSource = readSrc('navigation/components/ModalContent.tsx')
const noticeModalSource = readSrc('navigation/components/NoticeModal.tsx')
const pactModalSource = readSrc('navigation/components/PactModal.tsx')
const syncModeModalSource = readSrc('navigation/components/SyncModeModal.tsx')
const navigationUtilsSource = readSrc('navigation/utils.ts')
const songListSource = readSrc('screens/Home/Views/SongList/index.tsx')
const glassSource = readSrc('components/common/GlassBackdrop.tsx')
const musicMoreSheetSource = readSrc('screens/PlayDetail/Vertical/Player/components/MusicMoreSheet.tsx')
const lyricSettingSheetSource = readSrc('screens/PlayDetail/Vertical/components/LyricSettingSheet.tsx')
const shareModeSheetSource = readSrc('screens/PlayDetail/Vertical/components/ShareModeSheet.tsx')
const playlistSheetSource = readSrc('screens/PlayDetail/Vertical/Player/components/PlaylistSheet.tsx')
const artistPickerSheetSource = readSrc('components/ArtistPickerSheet/index.tsx')
const downloadQualitySheetSource = readSrc('components/DownloadQualitySheet/index.tsx')
const slideHookSource = readSrc('utils/hooks/useSheetSlideAnimation.ts')
const searchTipListSource = readSrc('components/SearchTipList/index.tsx')
const searchPageSource = readSrc('screens/Home/Views/Search/index.tsx')
const searchTipHostSource = readSrc('screens/Home/Views/Search/TipList.tsx')
const mylistSearchSource = readSrc('screens/Home/Views/Mylist/MusicList/ListMusicSearch.tsx')
const mylistListSource = readSrc('screens/Home/Views/Mylist/MusicList/index.tsx')

test('菜单浮窗（歌曲条 ⋮ / 歌单条 ⋮ / 音源选择）铺自己的糊底', () => {
  assert.match(menuSource, /import GlassBackdrop from '\.\/GlassBackdrop'/)
  assert.match(menuSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
})

test('「打开更新窗口」那个弹窗铺同一张糊底', () => {
  assert.match(modalContentSource, /import GlassBackdrop from '@\/components\/common\/GlassBackdrop'/)
  assert.match(modalContentSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
  // overlay 与页面同 window：补拍会把自己拍进去，底图只认挂载前预拍的那一张
  assert.match(modalContentSource, /<GlassBackdrop selfCapture=\{false\}/)
})

test('糊底按各自的圆角裁掉溢出的那一圈', () => {
  assert.match(menuSource, /overflow: 'hidden'/)
  assert.match(modalContentSource, /overflow: 'hidden'/)
})

// 更新 / 公告 / 协议 / 同步模式这四个窗口走的是 RNN 的 showOverlay，不是 RN Modal ——
// 它们跟页面同处一个 Activity 的 content。挂上之后再截图，画面里已经带着它们自己
// （黑色遮罩 + 面板），玻璃面糊的就是"糊中糊"。统一从 showOverlayWithBackdrop 进：
// 壁纸模式先拍背后那一帧再挂，窗口第一帧拿到的就是它背后真实的页面。
test('更新 / 公告 / 协议 / 同步窗口都先拍背后画面再挂', () => {
  assert.ok(navigationUtilsSource.includes('const showOverlayWithBackdrop'), 'overlay helper missing')
  assert.match(navigationUtilsSource, /if \(themeState\.theme\['is-wallpaper'\]\) await primeBackdropForPanel\(\)/)
  assert.match(navigationUtilsSource, /return Navigation\.showOverlay\(options\)/)
  // 四个打开函数一律走 helper；不许再有直连 Navigation.showOverlay 的旁路
  const helperCalls = navigationUtilsSource.match(/showOverlayWithBackdrop\(\{/g) ?? []
  assert.equal(helperCalls.length, 4, 'every overlay opener must go through the helper')
  assert.doesNotMatch(navigationUtilsSource, /^\s+(void|await) Navigation\.showOverlay\(/m)
})

// 公告 / 协议 / 同步模式与更新窗口是同一块面：都套 ModalContent，壁纸模式里
// 那块透明面板由它铺糊底。只要有一个没套，那个窗口在自定义背景主题下就是一块纯黑/纯白。
test('公告 / 协议 / 同步模式与更新窗口共用同一块糊底', () => {
  for (const source of [noticeModalSource, pactModalSource, syncModeModalSource]) {
    assert.match(source, /import ModalContent from '\.\/ModalContent'/)
    assert.match(source, /<ModalContent>/)
  }
})

// 选择文件夹是全屏高度的面，`c-content-background` 在壁纸模式里是透明的 ——
// 不铺糊底，整页目录就摊在照片纹理上。
test('选择文件夹弹窗也铺糊底', () => {
  const choosePathSource = readSrc('components/common/ChoosePath/List.tsx')
  assert.match(choosePathSource, /import GlassBackdrop from '@\/components\/common\/GlassBackdrop'/)
  assert.match(choosePathSource, /theme\['is-wallpaper'\] \? <GlassBackdrop/)
})

// 歌单页那个「默认」标签抽屉（DrawerLayoutAndroid）跟弹窗是同一类面：壁纸模式下它的底板
// 也是透明的，不糊就是一整列标签压在照片纹理上。它比弹窗多一道坑 —— 抽屉关闭时整块导航
// 视图在屏幕外，位置若只在 onLayout 测一次，糊图会整体偏出一个抽屉宽。
test('歌单页「默认」标签抽屉铺同一张糊底', () => {
  assert.match(songListSource, /import GlassBackdrop from '@\/components\/common\/GlassBackdrop'/)
  assert.match(songListSource, /theme\['is-wallpaper'\]/)
  assert.match(songListSource, /<GlassBackdrop measureKey=\{measureKey\} \/>/)
})

test('抽屉挪动时糊底重新测量', () => {
  assert.match(songListSource, /onDrawerStateChanged=\{handleDrawerStateChange\}/)
  assert.match(songListSource, /glassRef\.current\?\.remeasure\(\)/)
  assert.match(songListSource, /measureKey=\{measureKey\}/)
  assert.match(glassSource, /measureKey\?: unknown/)
  assert.match(glassSource, /\}, \[measureKey, startSettleLoop\]\)/)
})

// 入场是 250ms 的原生位移，糊图却靠 measureInWindow 每帧去追 —— 测量回调慢原生动画一帧以上，
// 起步最快的几帧错位最大，落定时再猛地对齐，观感就是背景"跳一下"（用户反馈的播放列表）。
// 面板的 onLayout 坐标不含 transform，就是落定后的位置，直接当锚点用。
test('弹层糊底按静止坐标钉死，不逐帧追入场动画', () => {
  assert.match(glassSource, /restOffset\?: \{ x: number, y: number \} \| null/)
  assert.match(glassSource, /const windowOffset = restOffset \?\? measuredOffset/)
  assert.match(glassSource, /if \(restOffset != null\) return/)
  assert.match(slideHookSource, /sheetLayout/)
  assert.match(slideHookSource, /setSheetLayout/)
  for (const source of [
    musicMoreSheetSource,
    lyricSettingSheetSource,
    shareModeSheetSource,
    playlistSheetSource,
    artistPickerSheetSource,
    downloadQualitySheetSource,
  ]) {
    assert.match(source, /restOffset=\{slide\.sheetLayout\}/)
  }
})

// 壁纸模式下弹层的面是透明的，所以它自己得变成毛玻璃 —— 糊的是**背后真实显示的那一帧**
// （封面、文字、图标一起进去），不是"面板里另贴一张糊壁纸"。前者面板内外是同一幅画面的
// 清晰版与模糊版；后者两张图互不相干，一眼能看出面板自带了张糊图。
test('壁纸模式的玻璃层糊的是背后真实画面', () => {
  const snapshotSource = readSrc('utils/backdropSnapshot.ts')
  assert.match(snapshotSource, /captureScreen\(\{/)
  assert.match(snapshotSource, /result: 'tmpfile'/)
  assert.match(glassSource, /getCachedBackdropSnapshot/)
  assert.match(glassSource, /source=\{\{ uri: snapshot\.uri \}\}/)
  // 不再把壁纸原图当底：那是"图片为底的模糊"，面板背后有什么它完全不知道
  assert.doesNotMatch(glassSource, /customSource\.uri \}/)
})

// 模糊只算这一层：快照是清晰截图，没有预先糊过，所以不存在两层叠加。
// 半径按快照的降采样比例折回（1/4 图糊 4 = 全屏糊 16），放大回屏幕后强度才与设定一致。
test('玻璃层只算一次模糊，并按降采样比例折算半径', () => {
  assert.match(glassSource, /blurRadius=\{Math\.max\(1, blurRadius \* snapshot\.scale\)\}/)
  assert.doesNotMatch(glassSource, /snapshot == null \? blurRadius/)
})

// 底图只有一张，挂载时若缓存已命中就固定住 —— 换一张新 URI 就是换底，
// 内容、亮度、位置会一起变，观感就是背景"跳一下"（用户反馈的定时停止弹窗）。
test('玻璃层一旦有图就不再换底', () => {
  const fnStart = glassSource.indexOf('const cached = getCachedBackdropSnapshot()')
  const fnEnd = glassSource.indexOf('}, [wallpaper, flat, canUseBackdrop', fnStart)
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'snapshot effect not found')
  const effectSource = glassSource.slice(fnStart, fnEnd)
  const cachedAt = effectSource.indexOf('setSnapshot(cached)')
  const requestAt = effectSource.indexOf('requestBackdropSnapshot()')
  assert.ok(cachedAt >= 0, 'glass layer ignores the pre-captured snapshot')
  assert.ok(requestAt > cachedAt, 'glass layer re-captures even when a snapshot is cached')
  // 缓存命中后直接 return，不再补拍第二张
  const between = effectSource.slice(cachedAt, requestAt)
  assert.match(between, /return/)
})

// applyToPlayer 只决定播控页自己铺哪张底图，不该让弹层的玻璃底一起消失
// （关掉它「更多」面板就会独独没有模糊）。
test('弹层糊底不再按 applyToPlayer 关门', () => {
  assert.doesNotMatch(glassSource, /playerScope/)
  assert.doesNotMatch(musicMoreSheetSource, /playerScope/)
  // 判据只剩"自定义背景图源在不在"
  assert.match(glassSource, /const canUseBackdrop = customSource != null/)
})

test('糊底按窗口坐标铺满整屏，并补回状态栏偏移', () => {
  assert.match(glassSource, /left: -windowOffset\.x,/)
  // captureScreen 拍不到状态栏，铺回屏幕时要从状态栏下缘开始
  assert.match(glassSource, /top: statusBarHeight - windowOffset\.y,/)
  assert.match(glassSource, /width: windowSize\.width,/)
  assert.match(glassSource, /height: Math\.max\(1, windowSize\.height - statusBarHeight\),/)
})

// RN Android 给非资源图默认带 300ms 淡入（ReactImageView 的 REMOTE_IMAGE_FADE_DURATION_MS），
// 底图不关掉淡入，面板就会"先透明一下再糊起来"。
test('糊底不走图的默认淡入，第一帧就该是糊的', () => {
  const fadeProps = glassSource.match(/fadeDuration=\{0\}/g) ?? []
  assert.equal(fadeProps.length, 2, 'both backdrop layers must disable the 300ms image fade')
  assert.match(glassSource, /fadeDuration=\{0\}[\s\S]{0,200}blurRadius=\{Math\.max/)
})

// 模糊与压暗统一收回组件默认值（16 / 0.3），各处不许单独盖 ——
// 菜单、弹窗、抽屉、底部面板、下拉看到的要是"同一幅画面的磨砂版"。
// 压暗层之所以是轻档而不是跟着页面柔光：快照里已经烘着页面那层柔光了，再按页面那档压一遍
// 就会明显比四周黑一截、像一块深色框。
test('所有玻璃面共用同一档模糊与压暗', () => {
  assert.match(glassSource, /blurRadius = 16, overlayOpacity = 0\.62, scrimOpacity = 0\.3,/)
  assert.match(glassSource, /opacity: scrimOpacity,/)
  assert.doesNotMatch(glassSource, /clampWallpaperVeil/)
  const callSites: Record<string, string> = {
    菜单: menuSource,
    弹窗: popupSource,
    对话框: dialogSource,
    更新窗口: modalContentSource,
    分享卡: shareCardModalSource,
    歌单抽屉: songListSource,
    更多: musicMoreSheetSource,
    分享面板: shareModeSheetSource,
    歌词设置: lyricSettingSheetSource,
    播放列表: playlistSheetSource,
    歌手选择: artistPickerSheetSource,
    音质选择: downloadQualitySheetSource,
    搜索建议: searchTipListSource,
  }
  for (const [name, source] of Object.entries(callSites)) {
    assert.doesNotMatch(source, /blurRadius=\{\d+\}/, `${name}不该单独覆盖模糊半径`)
    assert.doesNotMatch(source, /scrimOpacity=\{\d/, `${name}不该单独覆盖压暗`)
  }
})

test('搜索输入时的建议下拉也铺糊底', () => {
  assert.match(searchTipListSource, /import GlassBackdrop from '@\/components\/common\/GlassBackdrop'/)
  assert.match(searchTipListSource, /theme\['is-wallpaper'\] \? <GlassBackdrop restOffset=\{anchor\} \/>/)
  // 宿主页面测出下拉所在的窗口坐标（含 PagerView 切页后的重测）
  assert.match(searchPageSource, /contentRef\.current\?\.measureInWindow/)
  assert.match(searchPageSource, /collapsable=\{false\}/)
  assert.match(searchPageSource, /contentOffsetRef\.current\)/)
  assert.match(searchTipHostSource, /setHeight\(height, anchor\)/)
  assert.match(mylistListSource, /contentOffsetRef\.current\)/)
  assert.match(mylistSearchSource, /setHeight\(height, anchor\)/)
})

// 玻璃层要糊的是"面板背后那一帧"，而截图要 60~150ms 才回来。先挂面板、再等快照，
// 那一段里面板只能空着（背后清晰可见），快照回来才糊上 —— 观感就是背景从清晰突然变模糊。
// 所以各面板必须在挂载之前把图拍好（播控页「更多」「播放器设置」「播放列表」都在此列）。
test('播控页面板先拍背后那一帧再挂载', () => {
  for (const source of [musicMoreSheetSource, lyricSettingSheetSource, shareModeSheetSource, playlistSheetSource]) {
    const primeAt = source.indexOf('void primeBackdropForPanel()')
    const mountAt = source.indexOf('setMounted(true)', primeAt)
    assert.ok(primeAt >= 0, 'sheet does not prime the backdrop snapshot')
    assert.ok(mountAt > primeAt, 'sheet mounts before the snapshot is captured')
  }
  // 搜索建议下拉不是 Modal，但同样要在 setVisible 之前拍好（截图会把它自己也拍进去）
  const tipPrimeAt = searchTipListSource.indexOf('void primeBackdropForPanel()')
  const tipShowAt = searchTipListSource.indexOf('setVisible(true)', tipPrimeAt)
  assert.ok(tipPrimeAt >= 0 && tipShowAt > tipPrimeAt)
  // 歌单抽屉同样是"先拍再滑入"
  const drawerPrimeAt = songListSource.indexOf('void primeBackdropForPanel()')
  const openAt = songListSource.indexOf('drawer.current?.openDrawer()', drawerPrimeAt)
  assert.ok(drawerPrimeAt >= 0 && openAt > drawerPrimeAt)
})

// 通用弹窗（Dialog / Popup / Menu）在 setVisible(true) 里统一预拍：
// 「播放器设置」「定时停止播放」这类面都从这条路进来，不必每个业务调用点各写一遍。
test('通用弹窗开窗前预拍背后画面', () => {
  const modalSource = readSrc('components/common/Modal.tsx')
  const primeAt = modalSource.indexOf('primeBackdropForPanel()')
  const openAt = modalSource.indexOf('setVisible(true)', primeAt)
  assert.ok(primeAt >= 0, 'common modal does not prime the backdrop snapshot')
  assert.ok(openAt > primeAt, 'common modal opens before the snapshot is captured')
  // 还没开完就点了关：批次号作废在途的开窗
  assert.match(modalSource, /openTokenRef/)
})

// 截图万一迟迟不回来也不能把点击卡住：预拍带超时兜底，到点先开面板，玻璃层自己会补。
test('预拍带超时兜底，不阻塞面板打开', () => {
  const snapshotSource = readSrc('utils/backdropSnapshot.ts')
  assert.match(snapshotSource, /PANEL_PRIME_TIMEOUT/)
  assert.match(snapshotSource, /Promise\.race\(/)
  assert.match(snapshotSource, /themeState\.theme\['is-wallpaper'\]/)
})
