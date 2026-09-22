import { memo, useCallback, useRef, useState } from 'react'
import { ImageBackground, StyleSheet, View, type ImageSourcePropType, type ViewProps } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import useWindowSize from '@/utils/hooks/useWindowSize'

interface GlassBackdropProps {
  blurRadius?: number
  overlayOpacity?: number
  style?: ViewProps['style']
}

const GlassBackdrop = ({ blurRadius = 18, overlayOpacity = 0.62, style }: GlassBackdropProps) => {
  const theme = useTheme()
  const windowSize = useWindowSize()
  const viewRef = useRef<View>(null)
  const [windowOffset, setWindowOffset] = useState({ x: 0, y: 0 })

  const handleLayout = useCallback(() => {
    viewRef.current?.measureInWindow((x, y) => {
      setWindowOffset((offset) => {
        return offset.x == x && offset.y == y ? offset : { x, y }
      })
    })
  }, [])

  const source: ImageSourcePropType | undefined = theme['bg-image']
  const hasSource = source != null

  return (
    <View
      ref={viewRef}
      onLayout={handleLayout}
      pointerEvents="none"
      style={[styles.backdrop, style]}
    >
      {hasSource && (
        <ImageBackground
          style={{
            position: 'absolute',
            left: -windowOffset.x,
            top: -windowOffset.y,
            width: windowSize.width,
            height: windowSize.height,
          }}
          source={source}
          resizeMode="cover"
          blurRadius={blurRadius}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme['c-content-background'],
            opacity: hasSource ? overlayOpacity : overlayOpacity + 0.06,
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
})

export default memo(GlassBackdrop)
