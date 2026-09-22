import { forwardRef, useImperativeHandle, useRef } from 'react'

import Vertical, { type VerticalType } from './Vertical'
import Horizontal, { type HorizontalType } from './Horizontal'
import { useHorizontalMode } from '@/utils/hooks'
// import { AppColors } from '@/theme'

export interface LeaderboardType {
  setSource: (source: LX.OnlineSource) => void
}

export default forwardRef<LeaderboardType, {}>((props, ref) => {
  const isHorizontalMode = useHorizontalMode()
  const verticalRef = useRef<VerticalType>(null)
  const horizontalRef = useRef<HorizontalType>(null)

  useImperativeHandle(ref, () => ({
    setSource(source) {
      if (isHorizontalMode) horizontalRef.current?.setSource(source)
      else verticalRef.current?.setSource(source)
    },
  }), [isHorizontalMode])

  return isHorizontalMode
    ? <Horizontal ref={horizontalRef} />
    : <Vertical ref={verticalRef} />
})
