import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'
import { useTheme } from '@/store/theme/hook'

const BLUR_RADIUS = 90

export default memo(({ enabled = true }: { enabled?: boolean }) => {
  const theme = useTheme()
  const { picUrl, surface } = useCoverSurface()
  const active = enabled && surface != null

  const source = useMemo(() => (active && picUrl
    ? {
        uri: picUrl.startsWith('/') ? 'file://' + picUrl : picUrl,
        headers: defaultHeaders,
        cache: 'force-cache' as const,
      }
    : null), [active, picUrl])

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: active ? surface.base : theme['c-content-background'] }]}>
      {
        source ? (
          <>
            <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} />
            {/* 这一处必须留 `!`：`source` 不是 `active` 的别名，TS 的 aliased narrowing 只认得出上面那行的三元。
                删掉它 tsc 报 TS18047，加上它 lint 报 no-unnecessary-type-assertion —— 两处写法不同是被这两条闸门夹出来的。 */}
            <View style={[StyleSheet.absoluteFill, { backgroundColor: surface!.base, opacity: surface!.scrimAlpha }]} />
          </>
        ) : null
      }
    </View>
  )
})
