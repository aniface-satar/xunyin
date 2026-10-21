import { useEffect, useSyncExternalStore } from 'react'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverBackdropState, subscribeCoverBackdrop, updateCoverBackdrop } from '@/utils/monet/coverBackdropStore'
import { normalizeCoverAlgo } from '@/utils/monet/coverPalette'
import type { CoverBackdropState } from '@/utils/monet/backdropGate'

/**
 * 状态本体在 coverBackdropStore（背景层与前景色阶必须读同一份，见那个文件的头注释）。
 * 这里只做订阅与输入投递：字色不再从这里取 —— 动态背景生效时播放页的墨色恒为白，
 * 所以取色永远对着 ON_COVER_FONT_CSS 算（见 surface.ts），主题换字色不会让底色重算一次。
 * 档位（① 莫奈 / ② 动态取色）在这里归一后再交给 store：脏值折成 'monet' 这件事只做一次，
 * 决策表与配色层拿到的永远是那两个值之一。
 */
export const useCoverSurface = (): CoverBackdropState => {
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const algorithm = useSettingValue('theme.dynamicBgAlgorithm')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const hasThemeBgImage = !!theme['bg-image']
  const state = useSyncExternalStore(subscribeCoverBackdrop, getCoverBackdropState)
  const algo = normalizeCoverAlgo(algorithm)

  useEffect(() => {
    updateCoverBackdrop(dynamicBg, hasThemeBgImage, pic, algo)
  }, [dynamicBg, hasThemeBgImage, pic, algo])

  return state
}
