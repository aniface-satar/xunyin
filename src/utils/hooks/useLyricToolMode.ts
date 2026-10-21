import { useEffect, useState } from 'react'

import { getLyricToolMode, subscribeLyricToolMode } from '@/core/lyricCopy'

export const useLyricToolMode = () => {
  const [mode, setMode] = useState(getLyricToolMode())

  useEffect(() => subscribeLyricToolMode(() => {
    setMode(getLyricToolMode())
  }), [])

  return mode
}
