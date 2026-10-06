import { Image } from 'react-native'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'
import { createStyle } from '@/utils/tools'
import { scaleSizeH } from '@/utils/pixelRatio'

const locateIconSource = require('@/resources/images/locate.png')

const BTN_SIZE = scaleSizeH(38)

export default ({ onPress }: { onPress: () => void }) => {
  const theme = useTheme()
  return (
    <Button
      style={{ ...styles.btn, backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }}
      onPress={onPress}
    >
      <Image source={locateIconSource} style={{ ...styles.icon, tintColor: theme['c-button-font'] }} />
    </Button>
  )
}

const styles = createStyle({
  btn: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    borderWidth: BorderWidths.normal,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 10,
  },
  icon: {
    width: scaleSizeH(22),
    height: scaleSizeH(22),
  },
})
