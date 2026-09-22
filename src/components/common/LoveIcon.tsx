import { memo } from 'react'

import { Icon } from './Icon'

interface LoveIconProps {
  filled: boolean
  size?: number
  color: string
}

export const LoveIcon = memo(({ filled, size = 15, color }: LoveIconProps) => {
  return <Icon name={filled ? 'love-filled' : 'love'} size={size} color={color} />
})
