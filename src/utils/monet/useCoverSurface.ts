import { useEffect, useState } from 'react'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverSurface, type CoverSurface } from '@/utils/monet'

export interface CoverBackdropState {
  enabled: boolean
  picUrl: string | null
  surface: CoverSurface | null
}

export const useCoverSurface = (): CoverBackdropState => {
  const theme = useTheme()
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const { pic } = usePlayerMusicInfo()
  const fontColor = theme['c-font']
  // 真值判断而不是 != null：这就是 PageContent 拿去画背景图的同一个值，主题自带背景图时封面取色整条让路
  const enabled = dynamicBg && !theme['bg-image']

  const [surface, setSurface] = useState<CoverSurface | null>(null)

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

  // enabled 一翻 false 就当场交回空值：state 里上一张 surface 要等 effect 才清，那一帧会把封面色糊在主题背景图/关掉的开关上
  return { enabled, picUrl: enabled ? pic ?? null : null, surface: enabled ? surface : null }
}
