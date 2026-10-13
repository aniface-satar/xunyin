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
  const enabled = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const fontColor = theme['c-font']

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

  return { enabled, picUrl: enabled ? pic ?? null : null, surface }
}
