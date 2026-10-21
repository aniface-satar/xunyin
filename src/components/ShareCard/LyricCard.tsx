import { StyleSheet, View, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native'

import Text from '@/components/common/Text'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'
import {
  estimateRowCount,
  fitLyricBlock,
  LYRIC_FOOTER_SINGER_FONT_SIZE,
  LYRIC_FOOTER_TITLE_FONT_SIZE,
  LYRIC_LINE_HEIGHT_RATIO,
  LYRIC_MIN_FONT_SIZE,
  type LyricBlockLine,
} from './fitLyricBlock'

interface Props {
  lines: readonly LyricBlockLine[]
  name: string
  singer: string
  pic: string | null | undefined
  lyricMaxHeight: number
  /** 卡内文字列宽度(dp)：给了就走换行感知的高度模型（一句该折几行算几行） */
  textWidth?: number
  /** 正文起始字号(dp) = 歌词页里用户选的那一档；不给退回旧的五档自适应 */
  lyricFontSize?: number
  theme: CardTheme
  onCoverReady?: (ready: boolean) => void
}

// 与 MusicCard 同一对补丁：allowFontScaling={false} 挡住**系统**字号（fitLyricBlock 那套 fontSize×1.5
// 的行模型只有在不乘字号时才对得上真实行高，否则歌词块顶穿 lyricMaxHeight、落款溢出圆角卡），
// noShadow 挡住 common/Text 从 theme.fontShadow 铺上来的文字阴影（Text.tsx:35-46）—— 导出的是产物图，
// 不该跟着 App 的界面设置走（spec §3）。两处都只在卡自己的文件里解决，共享组件不动。
const noShadow: TextStyle = {
  textShadowColor: 'transparent',
  textShadowRadius: 0,
  textShadowOffset: { width: 0, height: 0 },
}

export default ({ lines, name, singer, pic, lyricMaxHeight, textWidth, lyricFontSize, theme, onCoverReady }: Props) => {
  // 字号：从歌词页那一档逐 dp 下探到"卡内歌手名"那一档（LYRIC_MIN_FONT_SIZE），
  // 每档取装得最多的一句数；全装得下的最大档就是答案。缩到地板还装不下才截断补 …。
  const fit = fitLyricBlock(lines, {
    maxHeight: lyricMaxHeight,
    textWidth,
    fontSize: lyricFontSize,
    minFontSize: LYRIC_MIN_FONT_SIZE,
    extendedRatio: 0.8,
  })
  const shown = lines.slice(0, fit.visibleCount)
  return (
    <>
      <View>
        {
          shown.map((line, index) => (
            <View key={`${index}-${line.text}`}>
              {/* 换行跟歌词页对齐：歌词页上那一行没折行（noWrap）且这一档字号仍放得下一行时，
                  卡里也钉成一行；歌词页上折了行的，卡里照常按卡宽自动换行。 */}
              { line.text?.trim() ? <Text allowFontScaling={false} numberOfLines={line.noWrap && estimateRowCount(line.text, fit.fontSize, textWidth ?? 0) <= 1 ? 1 : undefined} style={{ ...noShadow, fontSize: fit.fontSize, lineHeight: fit.fontSize * LYRIC_LINE_HEIGHT_RATIO, color: theme.lyricColor, fontWeight: 'bold' }}>{line.text}</Text> : null }
              {
                (line.extendedLyrics ?? []).map((text, i) => text?.trim()
                  ? <Text key={i} allowFontScaling={false} style={{ ...noShadow, fontSize: fit.extendedFontSize, lineHeight: fit.extendedFontSize * LYRIC_LINE_HEIGHT_RATIO, color: theme.subtitleColor }}>{text}</Text>
                  : null)
              }
            </View>
          ))
        }
        { fit.truncated ? <Text allowFontScaling={false} style={{ ...noShadow, fontSize: fit.extendedFontSize, lineHeight: fit.extendedFontSize * LYRIC_LINE_HEIGHT_RATIO, color: theme.subtitleColor }}>…</Text> : null }
      </View>
      <View style={[styles.separator, { backgroundColor: theme.subtitleColor }]} />
      {/* 上界对齐：封面与歌名同一行顶（flex-start），歌手跟在歌名下面 */}
      <View style={styles.footer}>
        {/* 封面边界线：同 MusicCard —— 黑卡白线 / 白卡黑线，把小封面从同色卡底上分出来 */}
      <CoverImage url={pic} onReady={onCoverReady} style={[styles.miniCover, { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.coverBorderColor }]} />
        <View style={styles.footerText}>
          {/* 这两档字号是卡内唯一不随歌词字号变动的数：歌手名那一档同时是歌词正文的下探地板 */}
          <Text numberOfLines={2} allowFontScaling={false} style={{ ...noShadow, fontSize: LYRIC_FOOTER_TITLE_FONT_SIZE, color: theme.titleColor }}>{name}</Text>
          <Text numberOfLines={1} allowFontScaling={false} style={{ ...noShadow, fontSize: LYRIC_FOOTER_SINGER_FONT_SIZE, color: theme.subtitleColor, marginTop: 2 }}>{singer}</Text>
        </View>
      </View>
      {/* 落款在最下方、左缘与封面左缘同一条线（都在卡 padding 边上） */}
      <BrandLine color={theme.subtitleColor} />
    </>
  )
}

// Step 0：这一层的数字是原始 dp，与 fitLyricBlock 的高度预算、index.tsx 的 LYRIC_FOOTER_RESERVE 同一坐标系，
// 所以不走 createStyle（用户的字号设置会把卡撑出 maxHeight，截出来的就是被裁掉的卡）。
// StyleSheet.hairlineWidth 不是数字换算，照用。
const styles: { separator: ViewStyle, footer: ViewStyle, miniCover: ImageStyle, footerText: ViewStyle } = {
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.35, marginVertical: 14 },
  // 上界对齐：行顶与封面顶同线，不用 center（那是旧布局，歌名会沉到封面中线以下）
  footer: { flexDirection: 'row', alignItems: 'flex-start' },
  miniCover: { width: 56, height: 56, borderRadius: 8, marginRight: 12 },
  footerText: { flex: 1 },
}
