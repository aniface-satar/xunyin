import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useGlassColors } from '@/utils/hooks/useGlassColors'

export const BTN_WIDTH = scaleSizeW(36)
export const BTN_ICON_SIZE = 24
// The dots-vertical glyph is drawn at the left edge of its font advance.
export const DOTS_VERTICAL_ALIGNMENT_OFFSET = scaleSizeW(BTN_ICON_SIZE) * 384 / 1024

export default ({ icon, color, onPress, onLongPress }: {
  icon: string
  color?: string
  onPress: () => void
  onLongPress?: () => void
}) => {
  const glassColors = useGlassColors()
  return (
    <TouchableOpacity style={{ ...styles.cotrolBtn, width: BTN_WIDTH, height: BTN_WIDTH }} activeOpacity={0.5} onPress={onPress} onLongPress={onLongPress}>
      <Icon name={icon} color={color ?? glassColors.muted} size={BTN_ICON_SIZE} />
    </TouchableOpacity>
  )
}

const styles = createStyle({
  cotrolBtn: {
    justifyContent: 'center',
    alignItems: 'center',

    // backgroundColor: '#ccc',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
})
