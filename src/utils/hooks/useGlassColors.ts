import { useMemo } from 'react'

import { useTheme } from '@/store/theme/hook'

export const useGlassColors = () => {
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
      lyricOpacity: 0.6,
      lyricTranslationOpacity: 0.6,
    }
  }, [theme])
}
