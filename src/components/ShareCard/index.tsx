import { forwardRef, useEffect, useState } from 'react'
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
  /** false = 封面还没解出来，拍摄按钮该禁用（Task 1 探针 2 的结论落在这里）。
   *  不在这层存 state：就绪与否只有卡里那个 CoverImage 知道，直接把它透下去。
   *  没有封面（本地歌）时 CoverImage 也会报 true，导出不会永远卡住。 */
  onReadyChange?: (ready: boolean) => void
}

const ShareCard = forwardRef<View, ShareCardProps>(({ mode, musicInfo, lyricLines, width, height, onReadyChange }, ref) => {
  const [averageArgb, setAverageArgb] = useState<number | null>(null)
  const uri = normalizeCoverUri(musicInfo.pic)

  useEffect(() => {
    let cancelled = false
    setAverageArgb(null)
    // 歌词卡的配色写死在 LYRIC_CARD_THEME，这个平均色取到也不用 —— 别为一趟没人读的取色去敲原生
    if (!musicInfo.pic || mode === 'lyric') return
    void getCoverAverageArgb(musicInfo.pic).then(value => {
      if (!cancelled) setAverageArgb(value)
    })
    return () => { cancelled = true }
  }, [musicInfo.pic, mode])

  const theme: CardTheme = mode === 'lyric' ? LYRIC_CARD_THEME : pickMusicCardTheme(averageArgb)
  const cardWidth = width * CARD_WIDTH_RATIO
  const cardMaxHeight = height * CARD_MAX_HEIGHT_RATIO
  // 封面同时受两条边管：只按宽算，长歌名在矮窗口上会把标题/落款顶到卡底外面（RN 默认不缩不裁）。
  const coverSize = Math.max(0, Math.min(
    cardWidth - CARD_PADDING * 2,
    cardMaxHeight - CARD_PADDING * 2 - MUSIC_CARD_TEXT_RESERVE,
  ))
  const lyricMaxHeight = Math.max(0, cardMaxHeight - CARD_PADDING * 2 - LYRIC_FOOTER_RESERVE)

  return (
    <View ref={ref} collapsable={false} style={{ width, height }}>
      <ImageBackground
        blurRadius={BLUR_RADIUS}
        source={uri ? { uri, headers: defaultHeaders } : undefined}
        style={[styles.fill, { backgroundColor: '#111114' }]}
      >
        <View style={[styles.fill, { backgroundColor: theme.scrimColor }]} />
      </ImageBackground>
      <View style={styles.center}>
        <View style={{ width: cardWidth, maxHeight: cardMaxHeight, backgroundColor: theme.cardBackground, borderRadius: 28, padding: CARD_PADDING }}>
          {
            mode === 'music'
              ? <MusicCard {...musicInfo} coverSize={coverSize} theme={theme} onCoverReady={onReadyChange} />
              : <LyricCard lines={lyricLines ?? []} {...musicInfo} lyricMaxHeight={lyricMaxHeight} theme={theme} onCoverReady={onReadyChange} />
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
