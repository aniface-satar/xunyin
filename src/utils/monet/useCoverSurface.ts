import { useEffect, useSyncExternalStore } from 'react'

import { usePlayerMusicInfo } from '@/store/player/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { getCoverBackdropState, subscribeCoverBackdrop, updateCoverBackdrop } from '@/utils/monet/coverBackdropStore'
import type { CoverBackdropState } from '@/utils/monet/backdropGate'

/**
 * 状态本体在 coverBackdropStore（背景层与前景色阶必须读同一份，见那个文件的头注释）。
 * 这里只做订阅与输入投递：字色不再从这里取 —— 动态背景生效时播放页的墨色恒为白，
 * 所以取色永远对着 ON_COVER_FONT_CSS 算（见 surface.ts），主题换字色不会让底色重算一次。
 */
export const useCoverSurface = (): CoverBackdropState => {
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const theme = useTheme()
  const { pic } = usePlayerMusicInfo()
  const hasThemeBgImage = !!theme['bg-image']
  const state = useSyncExternalStore(subscribeCoverBackdrop, getCoverBackdropState)

  useEffect(() => {
    updateCoverBackdrop(dynamicBg, hasThemeBgImage, pic)
  }, [dynamicBg, hasThemeBgImage, pic])

  return state
}
