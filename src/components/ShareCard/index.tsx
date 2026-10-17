import { forwardRef, useEffect, useRef, useState } from 'react'
import { ImageBackground, StyleSheet, View, type ViewStyle } from 'react-native'

import { defaultHeaders } from '@/components/common/Image'
import { getCoverAverageArgb } from '@/utils/monet'
import LyricCard from './LyricCard'
import MusicCard from './MusicCard'
import { normalizeCoverUri } from './CoverImage'
import { LYRIC_CARD_THEME, pickMusicCardTheme, type CardTheme } from './cardTheme'
import { type LyricBlockLine } from './fitLyricBlock'

export const CARD_WIDTH_RATIO = 0.78
export const CARD_MAX_HEIGHT_RATIO = 0.62
export const CARD_PADDING = 20
// 播放页那一支模糊底有两个半径：src/components/player/CoverBackdrop/index.tsx:13 的 WASH_BLUR_RADIUS=90
// （① 莫奈档，糊到只剩大块起伏）与 :17 的 COVER_BLUR_RADIUS=5（②「动态取色」，要隐隐看出是封面）。
// 分享卡的底对着的是 ① 那一支（spec §1 的"虚化封面铺底"），所以是 90，不要跟着 ② 改成 5。
// 已知代价：Fresco 的框糊会在边缘读到图外面，留一圈发暗的边 —— 播放页用 OVERSCAN=1.25 的 GPU 变换躲开，
// 这一支整屏铺满、那条边正好落在导出图的屏幕上沿。Task 11 真机清单要看这一条，别看漏就照着播放页加外扩。
export const BLUR_RADIUS = 90

// 歌词卡底部那一坨，最坏情况：省略号一行 22×1.5=33 + 分隔线（14+1+14=29）+ 小封面行（歌名两行 2×~19 + 歌手 2+~17 + 落款 16+20 ≈ 93）≈ 155。
// 卡内上下边距不在这里，由下面 CARD_PADDING * 2 单独扣。
const LYRIC_FOOTER_RESERVE = 160
// 音乐卡里封面之外的那几行：标题 18+3×30=108、歌手 6+2×~25=56、落款 16+20=36 ≈ 200
const MUSIC_CARD_TEXT_RESERVE = 200
// 上面两笔预算全是原始 dp，成立的前提是卡内每一枚 Text 都写了 allowFontScaling={false}：
// 安卓默认会按**系统**字号把 fontSize/lineHeight/letterSpacing 一起乘（1.3 档就是 +30%），
// 文字块一胀就顶穿 MUSIC_CARD_TEXT_RESERVE，落款渲染到圆角卡底外面 —— 而且是在导出的成品图里，
// 和 41f4181 修的是同一个症状，只是从系统字号这扇门进来。

export interface ShareCardData {
  name: string
  singer: string
  pic: string | null | undefined
}

export interface ShareCardProps {
  mode: 'music' | 'lyric'
  musicInfo: ShareCardData
  lyricLines?: readonly LyricBlockLine[]
  width: number
  height: number
  /** false = 这一层那三路异步信号还没到齐，拍摄按钮该禁用（Task 1 探针 2 的结论落在这里）。
   *  就绪只有这一个出口：卡封面、整屏糊底、配色三路各自的状态都在**这一层**合起来再报出去，
   *  别的层（ShareCardModal）只吃这一个布尔值、不另存自己的 ready —— 各存一份就会有人漏掉某一路。
   *  没有封面（本地歌）时三路都会当场落定，导出不会永远卡住。 */
  onReadyChange?: (ready: boolean) => void
}

const ShareCard = forwardRef<View, ShareCardProps>(({ mode, musicInfo, lyricLines, width, height, onReadyChange }, ref) => {
  const [averageArgb, setAverageArgb] = useState<number | null>(null)
  const [paletteSettled, setPaletteSettled] = useState(false)
  const [coverReady, setCoverReady] = useState(false)
  const uri = normalizeCoverUri(musicInfo.pic)

  // 糊底这一路：它和卡封面是两趟请求，而 blurRadius 走 Fresco 的 per-request post-processor
  // （IterativeBoxBlurPostProcessor），落在 bitmap cache 外面 —— 播放页那支糊底暖不出可复用的条目，
  // 卡封面的 onLoad 也说明不了糊底解没解完。解完前拍到的是底上那块空 #111114。
  // 没有 uri 时它压根没有 source，永远不会 onLoad ⇒ 那一支当场算落定，不然门永远闭着。
  // 落定结果和"它属于哪一张封面"绑在同一个 state 里、换源时在渲染那一刻复位（同 CoverImage:28-36 的思路），
  // JSX 那边再配 key={uri} 重挂：RN 的原生事件只认当前挂着的视图，没有 key 的话上一张晚到的 onLoad
  // 会打到这一张的回调上，下面 s.uri === uri 两边都是新的、判据形同虚设。
  const [backdrop, setBackdrop] = useState<{ uri: string | null, settled: boolean }>({ uri, settled: uri === null })
  if (backdrop.uri !== uri) setBackdrop({ uri, settled: uri === null })

  useEffect(() => {
    let cancelled = false
    setAverageArgb(null)
    // 歌词卡的配色写死在 LYRIC_CARD_THEME，这个平均色取到也不用 —— 别为一趟没人读的取色去敲原生。
    // 短路这一支必须自己把门落定：既然不敲门，就没人来应门。
    if (!musicInfo.pic || mode === 'lyric') {
      setPaletteSettled(true)
      return
    }
    // averageArgb 还是 null 时 pickMusicCardTheme 给的是深卡（cardTheme.ts:36 对非数字一律判暗），
    // 所以配色没落定就放行 = 白封面拍成黑卡。这一路是 HttpURLConnection 自己下的，
    // 和卡封面那趟（多数是 Fresco 内存命中）没有任何同步点，冷像素缓存时能差几百毫秒到几秒。
    setPaletteSettled(false)
    const run = async() => {
      try {
        const value = await getCoverAverageArgb(musicInfo.pic)
        if (!cancelled) setAverageArgb(value)
      } catch (e) {
        // 取色失败照样落定：回落到深卡是既有行为（spec §3），失败也说得出口；
        // 真正不能接受的是门被一趟不会回来的回调永久钉住，以及一条没人接的 rejection。
        console.error('[share_card] palette_failed', e)
      } finally {
        if (!cancelled) setPaletteSettled(true)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [musicInfo.pic, mode])

  const ready = coverReady && backdrop.settled && paletteSettled
  // 聚合结果只在这个布尔翻转时往外报一次。onReadyChange 走 ref 不进依赖数组（父组件每次都传新箭头），
  // 判据同 CoverImage:44-45。
  const reportReadyRef = useRef(onReadyChange)
  reportReadyRef.current = onReadyChange
  useEffect(() => { reportReadyRef.current?.(ready) }, [ready])

  const theme: CardTheme = mode === 'lyric' ? LYRIC_CARD_THEME : pickMusicCardTheme(averageArgb)
  const cardWidth = width * CARD_WIDTH_RATIO
  const cardMaxHeight = height * CARD_MAX_HEIGHT_RATIO
  // 封面同时受两条边管：只按宽算，长歌名在矮窗口上会把标题/落款顶到卡底外面（RN 默认不缩不裁）。
  const coverSize = Math.max(0, Math.min(
    cardWidth - CARD_PADDING * 2,
    cardMaxHeight - CARD_PADDING * 2 - MUSIC_CARD_TEXT_RESERVE,
  ))
  const lyricMaxHeight = Math.max(0, cardMaxHeight - CARD_PADDING * 2 - LYRIC_FOOTER_RESERVE)
  // 文字那一列的宽度只受卡宽管（padding 是卡自己的），封面才受两条边管。
  const cardTextWidth = Math.max(0, cardWidth - CARD_PADDING * 2)

  return (
    <View ref={ref} collapsable={false} style={{ width, height }}>
      <ImageBackground
        key={uri ?? 'none'}
        blurRadius={BLUR_RADIUS}
        source={uri ? { uri, headers: defaultHeaders } : undefined}
        onLoad={() => { setBackdrop(s => s.uri === uri ? { ...s, settled: true } : s) }}
        onError={() => { setBackdrop(s => s.uri === uri ? { ...s, settled: true } : s) }}
        style={[styles.fill, { backgroundColor: '#111114' }]}
      >
        <View style={[styles.fill, { backgroundColor: theme.scrimColor }]} />
      </ImageBackground>
      <View style={styles.center}>
        <View style={{ width: cardWidth, maxHeight: cardMaxHeight, backgroundColor: theme.cardBackground, borderRadius: 20, padding: CARD_PADDING }}>
          {
            mode === 'music'
              ? <MusicCard {...musicInfo} coverSize={coverSize} textWidth={cardTextWidth} theme={theme} onCoverReady={setCoverReady} />
              : <LyricCard lines={lyricLines ?? []} {...musicInfo} lyricMaxHeight={lyricMaxHeight} theme={theme} onCoverReady={setCoverReady} />
          }
        </View>
      </View>
    </View>
  )
})

// Step 0：两张卡内的数字都是原始 dp（fitLyricBlock 的高度预算、LYRIC_FOOTER_RESERVE 也是），
// 这一层若走 createStyle 就变成两套坐标系，用户开大字号时歌词块会压过 maxHeight。
// StyleSheet.absoluteFillObject 不是数字换算，照用。
const styles: { fill: ViewStyle, center: ViewStyle } = {
  fill: StyleSheet.absoluteFillObject,
  center: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
}

export default ShareCard
