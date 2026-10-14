import { useEffect, useState } from 'react'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverSurface, type CoverSurface } from '@/utils/monet'
import { resolveCoverBackdrop, type CoverBackdropState } from '@/utils/monet/backdropGate'

export const useCoverSurface = (): CoverBackdropState => {
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const fontColor = theme['c-font']

  const [surface, setSurface] = useState<CoverSurface | null>(null)

  // 决策表本体在 backdropGate.ts，那张表能用 node --test 直接跑；这里只留订阅与取色副作用
  const { enabled, picUrl, surface: coverSurface } = resolveCoverBackdrop(dynamicBg, !!theme['bg-image'], pic, surface)

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

  return { enabled, picUrl, surface: coverSurface }
}
