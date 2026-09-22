import { TouchableOpacity, View } from 'react-native'

import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useStatusbarHeight } from '@/store/common/hook'
import { useLeaderboardInfo } from './state'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

export default ({ componentId, onBack }: { componentId: string, onBack?: () => void }) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()
  const { board } = useLeaderboardInfo()

  return (
    <View style={{ ...styles.container, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.8}
          onPress={() => {
            if (onBack) {
              onBack()
            } else {
              void pop(componentId)
            }
          }}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.titleContent}>
          <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>
            {board.name}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: BorderWidths.normal,
  },
  headerRow: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    height: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 10,
  },
  titleContent: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
})
