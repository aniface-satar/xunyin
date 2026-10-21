import { Image } from 'react-native'
import Button from '@/components/common/Button'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'
import { createStyle } from '@/utils/tools'

const locateIconSource = require('@/resources/images/locate.png')

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
    width: 38,
    height: 38,
    borderRadius: 9999,
    borderWidth: BorderWidths.normal,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 10,
  },
  icon: {
    width: 22,
    height: 22,
  },
})
