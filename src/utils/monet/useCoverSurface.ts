import { useEffect, useState } from 'react'
import { useWindowDimensions } from 'react-native'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverSurface, getCoverTexture, textureWidthFor, type CoverSurface } from '@/utils/monet'
import { resolveCoverBackdrop, type CoverBackdropState } from '@/utils/monet/backdropGate'

export const useCoverSurface = (): CoverBackdropState => {
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const { width, height } = useWindowDimensions()
  const fontColor = theme['c-font']

  const [surface, setSurface] = useState<CoverSurface | null>(null)
  // 打上归属 picUrl：切歌时旧纹理必须立刻在这一帧就不作数，
  // 否则"新歌还没纹理"的那几十毫秒里会拿上一张歌的纹路当背景（纹理是形状，比色偏显眼得多）。
  const [texture, setTexture] = useState<{ picUrl: string, uri: string } | null>(null)

  // 决策表本体在 backdropGate.ts，那张表能用 node --test 直接跑；这里只留订阅与取色副作用
  const outWidth = textureWidthFor(width, height)
  const textureUri = texture != null && texture.picUrl === pic ? texture.uri : null
  const { enabled, picUrl, surface: coverSurface, texture: gatedTexture } = resolveCoverBackdrop(
    dynamicBg, !!theme['bg-image'], pic, surface, textureUri)

  useEffect(() => {
    if (!enabled || !pic) {
      setSurface(null)
      return
    }
    let cancelled = false
    void getCoverSurface(pic, fontColor).then(next => {
      if (!cancelled) setSurface(next)
    })
    return () => { cancelled = true }
  }, [enabled, pic, fontColor])

  // 底色先到、纹理后到：纹理要在拿到 band 之后才摆得出来，所以这个 effect 依赖 coverSurface
  useEffect(() => {
    if (!enabled || !pic || coverSurface == null) return
    let cancelled = false
    void getCoverTexture(pic, fontColor, outWidth).then(uri => {
      if (!cancelled && uri != null) setTexture({ picUrl: pic, uri })
    })
    return () => { cancelled = true }
  }, [enabled, pic, fontColor, coverSurface, outWidth])

  return { enabled, picUrl, surface: coverSurface, texture: gatedTexture }
}
