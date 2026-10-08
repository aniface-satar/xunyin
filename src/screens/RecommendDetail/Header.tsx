import { TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useStatusbarHeight } from '@/store/common/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'

/** 推荐 tab「更多」页的顶栏：只用应用内详情栈，因此返回回调必传。 */
export default ({ title, onBack }: { title: string, onBack: () => void }) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()

  return (
    <View style={{ ...styles.container, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.8} onPress={onBack} accessibilityRole="button" accessibilityLabel={global.i18n.t('back')}>
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        <View style={styles.titleContent}>
          <Text size={16} numberOfLines={1} color={theme['c-font']}>{title}</Text>
        </View>
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
})
