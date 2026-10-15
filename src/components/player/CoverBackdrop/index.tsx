import { memo, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'

import ImageBackground from '@/components/common/ImageBackground'
import { defaultHeaders } from '@/components/common/Image'
import { useCoverSurface } from '@/utils/monet/useCoverSurface'

const BLUR_RADIUS = 90

export default memo(() => {
  const { picUrl, surface } = useCoverSurface()
  const active = surface != null

  const source = useMemo(() => (active && picUrl
    ? {
        uri: picUrl.startsWith('/') ? 'file://' + picUrl : picUrl,
        headers: defaultHeaders,
        cache: 'force-cache' as const,
      }
    : null), [active, picUrl])

  // 没上色就整层不存在。早先计划版本在这里铺一层不透明的 theme['c-content-background'] 当底色，
  // 控制方实测那会盖掉 5 个内置主题（black / mid_autumn / naruto / china_ink / happy_new_year）的主题背景图 ——
  // 它们的 `c-main-background` 是 0.95/0.9/0.8 半透明，PageContent 特意让背景图从下面透出来；
  // 结果是"功能没打开就改了观感"，直接违反验收第 ① 条。另外 12 个主题 c-main-background 是全不透明白，本来就没有透出，不受影响。
  // 顺带：surface 与 picUrl 出自 resolveCoverBackdrop 同一张决策表，active 为真就一定有 picUrl，
  // 下面那个三元只是把类型收窄；表里那两条判据（开关/主题背景图、以及有没有封面）都在纯函数里，能用 node --test 跑。
  if (!active) return null

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.base }]} pointerEvents="none">
      {source != null ? <ImageBackground style={StyleSheet.absoluteFill} source={source} resizeMode="cover" blurRadius={BLUR_RADIUS} /> : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: surface.base, opacity: surface.scrimAlpha }]} />
    </View>
  )
})
