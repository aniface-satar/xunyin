import { useMemo } from 'react'

import { useTheme } from '@/store/theme/hook'
import { LYRIC_COMPONENT_OPACITY } from '@/utils/monet/onCoverTheme'

/** `lyricOpacity` 是"非当前行还要不要淡这么多"的那一档，只有动态背景 ② 那一档会传别值进来
 *  （白@0.98/0.92 的墨色与这一档是**乘在一起**核的，见 onCoverTheme.BLUR_LYRIC_COMPONENT_OPACITY）。
 *  默认值直接从那份常量取（它就是为了这条乘法存在的镜像）：普通主题与 ① 一个像素都不该因为这里动过。 */
export const useGlassColors = (lyricOpacity = LYRIC_COMPONENT_OPACITY) => {
  const theme = useTheme()

  return useMemo(() => {
    return {
      text: theme['c-font'],
      muted: theme['c-font-label'],
      accent: theme['c-button-font'],
      activeBackground: theme['c-primary-background-active'],
      lyricActive: theme['c-primary'],
      lyricActiveTranslation: theme['c-primary-alpha-200'],
      lyric: theme['c-350'],
      lyricTranslation: theme['c-300'],
      lyricOpacity,
      lyricTranslationOpacity: lyricOpacity,
    }
  }, [theme, lyricOpacity])
}
