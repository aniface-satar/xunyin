import { StyleSheet, View, type ImageStyle, type ViewStyle } from 'react-native'

import Text from '@/components/common/Text'
import { BrandLine } from './BrandLine'
import CoverImage from './CoverImage'
import { type CardTheme } from './cardTheme'
import { type LyricBlockLine, fitLyricBlock } from './fitLyricBlock'

interface Props {
  lines: readonly LyricBlockLine[]
  name: string
  singer: string
  pic: string | null | undefined
  lyricMaxHeight: number
  theme: CardTheme
  onCoverReady?: (ready: boolean) => void
}

export default ({ lines, name, singer, pic, lyricMaxHeight, theme, onCoverReady }: Props) => {
  const fit = fitLyricBlock(lines, { maxHeight: lyricMaxHeight })
  const shown = lines.slice(0, fit.visibleCount)
  return (
    <>
      <View>
        {
          shown.map((line, index) => (
            <View key={`${index}-${line.text}`}>
              { line.text?.trim() ? <Text style={{ fontSize: fit.fontSize, lineHeight: fit.fontSize * 1.5, color: theme.lyricColor }}>{line.text}</Text> : null }
              {
                (line.extendedLyrics ?? []).map((text, i) => text?.trim()
                  ? <Text key={i} style={{ fontSize: fit.extendedFontSize, lineHeight: fit.extendedFontSize * 1.5, color: theme.subtitleColor }}>{text}</Text>
                  : null)
              }
            </View>
          ))
        }
        { fit.truncated ? <Text style={{ fontSize: fit.extendedFontSize, color: theme.subtitleColor }}>…</Text> : null }
      </View>
      <View style={[styles.separator, { backgroundColor: theme.subtitleColor }]} />
      <View style={styles.footer}>
        <CoverImage url={pic} onReady={onCoverReady} style={styles.miniCover} />
        <View style={styles.footerText}>
          <Text numberOfLines={2} style={{ fontSize: 16, color: theme.titleColor }}>{name}</Text>
          <Text numberOfLines={1} style={{ fontSize: 14, color: theme.subtitleColor, marginTop: 2 }}>{singer}</Text>
          <BrandLine color={theme.subtitleColor} />
        </View>
      </View>
    </>
  )
}

// Step 0：这一层的数字是原始 dp，与 fitLyricBlock 的高度预算、index.tsx 的 LYRIC_FOOTER_RESERVE 同一坐标系，
// 所以不走 createStyle（用户的字号设置会把卡撑出 maxHeight，截出来的就是被裁掉的卡）。
// StyleSheet.hairlineWidth 不是数字换算，照用。
const styles: { separator: ViewStyle, footer: ViewStyle, miniCover: ImageStyle, footerText: ViewStyle } = {
  separator: { height: StyleSheet.hairlineWidth, opacity: 0.35, marginVertical: 14 },
  footer: { flexDirection: 'row', alignItems: 'center' },
  miniCover: { width: 56, height: 56, borderRadius: 8, marginRight: 12 },
  footerText: { flex: 1 },
}
