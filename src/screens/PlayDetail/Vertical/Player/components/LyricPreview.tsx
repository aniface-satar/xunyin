import { View, type LayoutChangeEvent } from 'react-native'

import Text from '@/components/common/Text'
import { type Line, useLrcPlay, useLrcSet } from '@/plugins/lyric'
import { useGlassColors } from '@/utils/hooks/useGlassColors'
import { createStyle } from '@/utils/tools'

const PreviewLine = ({ line, color, style }: {
  line?: Line
  color: string
  style?: object
}) => {
  return (
    <Text numberOfLines={1} size={14} color={color} style={style}>{line?.text ?? ''}</Text>
  )
}

export default ({ onLayout, topGap = true, lineCount = 2 }: {
  onLayout?: (event: LayoutChangeEvent) => void
  topGap?: boolean
  lineCount?: 1 | 2
} = {}) => {
  const glassColors = useGlassColors()
  const lyricLines = useLrcSet()
  const { line } = useLrcPlay()

  return (
    <View onLayout={onLayout} style={[styles.container, topGap ? null : styles.noTopGap]}>
      <PreviewLine
        line={line >= 0 ? lyricLines[line] : undefined}
        color={glassColors.lyricActive}
        style={styles.current}
      />
      {lineCount == 2 && (
        <PreviewLine
          line={lyricLines[line + 1]}
          color={glassColors.muted}
          style={styles.next}
        />
      )}
    </View>
  )
}

const styles = createStyle({
  container: {
    marginTop: 12,
    width: '100%',
  },
  noTopGap: {
    marginTop: 0,
  },
  current: {
    lineHeight: 20,
  },
  next: {
    lineHeight: 20,
    marginTop: 3,
  },
})

