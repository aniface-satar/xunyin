import { forwardRef, useEffect, useRef, useState } from 'react'
import { ImageBackground, StyleSheet, View, type ViewStyle } from 'react-native'

import { defaultHeaders } from '@/components/common/Image'
import LyricCard from './LyricCard'
import MusicCard from './MusicCard'
import { normalizeCoverUri } from './CoverImage'
import { pickCardTheme, type CardTheme, type CardTone } from './cardTheme'
import { CARD_MAX_HEIGHT_RATIO, CARD_WIDTH_RATIO, cardScale } from './cardScale'
import { type LyricBlockLine } from './fitLyricBlock'

export const CARD_PADDING = 20
// 20dp 是分享卡自己的一档，不是抄播放页：播放页那两个半径是 src/components/player/CoverBackdrop/index.tsx:14
// 的 WASH_BLUR_RADIUS=90（① 莫奈档，糊到只剩大块起伏）与 :18 的 COVER_BLUR_RADIUS=9（②「封面模糊」，要隐隐看出是封面）。
// 卡底落在两者之间、离 ② 更近：卡上压着 scrimColor 蒙版和不透明卡底，糊底只是氛围，别让封面图案抢字。
// 已知代价：Fresco 的框糊会在边缘读到图外面，留一圈发暗的边 —— 播放页用 OVERSCAN=1.25 的 GPU 变换躲开，
// 这一支整屏铺满、那条边正好落在导出图的屏幕上沿（半径变小只是让边更窄，没有消失）。真机清单要看这一条。
export const BLUR_RADIUS = 20

// 歌词卡底部那一坨，最坏情况：省略号一行 22×1.5=33 + 分隔线（14+1+14=29）+ 小封面行（文字列：歌名两行 2×~19 + 歌手 2+~17 ≈ 57，封面 56）
// + 落款（16+20=36）≈ 155。
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
  /**
   * 卡底的黑白档：**由预览页底部那排「白底 / 黑底」给**，默认白底（2026-10-29 用户指定）。
   * 卡片这一层不读应用主题 —— 分享图是产物，不是界面（spec §3），深色模式的用户想发白卡不该去切主题。
   */
  tone: CardTone
  lyricLines?: readonly LyricBlockLine[]
  /**
   * 歌词卡正文字号(dp)。给了（歌词页用户选的字号 ÷10）就以它为**起始**档：
   * 装不下时逐 dp 往下缩到"卡内歌手名"那一档（fitLyricBlock.LYRIC_MIN_FONT_SIZE），
   * 好让最大卡片空间里装进更多句；缩到地板仍装不下的整句才丢掉。不给退回五档自适应。
   */
  lyricFontSize?: number
  /** 被拍画布（= 导出图）的尺寸，dp */
  width: number
  height: number
  /**
   * "基准整体"那块屏幕的尺寸，dp：卡盒与卡内每一度量都从它推，也就是全屏档那一版的数值。
   * 与 width/height 分开是因为画布会随比例变短变宽，而卡片是同一个整体只做等比缩放
   * （用户 2026-10-17 指定："卡内的内容大小比例不动"）。
   */
  masterWidth: number
  masterHeight: number
  /** false = 这一层那两路异步信号还没到齐，拍摄按钮该禁用（Task 1 探针 2 的结论落在这里）。
   *  就绪只有这一个出口：卡封面、整屏糊底两路各自的状态都在**这一层**合起来再报出去，
   *  别的层（ShareCardModal）只吃这一个布尔值、不另存自己的 ready —— 各存一份就会有人漏掉某一路。
   *  没有封面（本地歌）时两路都会当场落定，导出不会永远卡住。
   *  （原来的第三路"封面取色定卡色"已随卡色改由用户选一起退役，见 pickCardTheme。） */
  onReadyChange?: (ready: boolean) => void
}

const ShareCard = forwardRef<View, ShareCardProps>(({ mode, tone, musicInfo, lyricLines, lyricFontSize, width, height, masterWidth, masterHeight, onReadyChange }, ref) => {
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

  const ready = coverReady && backdrop.settled
  // 聚合结果只在这个布尔翻转时往外报一次。onReadyChange 走 ref 不进依赖数组（父组件每次都传新箭头），
  // 判据同 CoverImage:44-45。
  const reportReadyRef = useRef(onReadyChange)
  reportReadyRef.current = onReadyChange
  useEffect(() => { reportReadyRef.current?.(ready) }, [ready])

  // 卡色由预览页那枚开关给（cardTheme.ts 顶部注释）：白底 / 黑底，默认白底，音乐卡与歌词卡同一套。
  // 两张卡共用一个选择器 —— 分卡就是旧 spec §3 那对过时的取舍（歌词卡固定深色 / 音乐卡看封面脸色）。
  const theme: CardTheme = pickCardTheme(tone)
  // 卡盒按基准整体算（= 全屏那一档的画面），画布只管"这张卡放在多大的糊底上、等比缩到多大"。
  // 之前这里是 width/height，于是切比例时卡盒跟着画布两个轴各自变形、封面与文字的相对大小一起重排。
  const cardWidth = masterWidth * CARD_WIDTH_RATIO
  const cardMaxHeight = masterHeight * CARD_MAX_HEIGHT_RATIO
  const scale = cardScale({ rectWidth: width, rectHeight: height, masterWidth, masterHeight })
  // 封面同时受两条边管：只按宽算，长歌名在矮窗口上会把标题/落款顶到卡底外面（RN 默认不缩不裁）。
  const coverSize = Math.max(0, Math.min(
    cardWidth - CARD_PADDING * 2,
    cardMaxHeight - CARD_PADDING * 2 - MUSIC_CARD_TEXT_RESERVE,
  ))
  const lyricMaxHeight = Math.max(0, cardMaxHeight - CARD_PADDING * 2 - LYRIC_FOOTER_RESERVE)
  // 文字那一列的宽度只受卡宽管（padding 是卡自己的），封面才受两条边管。
  const cardTextWidth = Math.max(0, cardWidth - CARD_PADDING * 2)
  // 歌词卡字号：从用户字号（dp，歌词页设置值 ÷10）起步，装不下就逐 dp 下探到歌手名那一档，
  // 在同样的卡片空间里尽量多装句子 —— 下探与地板都在 fitLyricBlock 里（lyricFontSize + minFontSize）。
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
        {/* overflow hidden：预算再保守也是估宽，万一真实渲染比模型多折一行，多出的部分在这里被圆角边界
            裁住，压不住的那一小截不能再把落款挤出卡外（图一那个症状的最后一道保险） */}
        <View style={{ width: cardWidth, maxHeight: cardMaxHeight, transform: [{ scale }], backgroundColor: theme.cardBackground, borderRadius: 20, padding: CARD_PADDING, overflow: 'hidden' }}>
          {
            mode === 'music'
              ? <MusicCard {...musicInfo} coverSize={coverSize} textWidth={cardTextWidth} theme={theme} onCoverReady={setCoverReady} />
              : <LyricCard lines={lyricLines ?? []} {...musicInfo} lyricMaxHeight={lyricMaxHeight} textWidth={cardTextWidth} lyricFontSize={lyricFontSize} theme={theme} onCoverReady={setCoverReady} />
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
