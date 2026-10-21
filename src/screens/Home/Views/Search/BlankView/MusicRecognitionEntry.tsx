import { Keyboard, TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { FeatureIcon, Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import homeDetailActions from '@/store/homeDetail/action'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

export default () => {
  const t = useI18n()
  const theme = useTheme()

  const handlePress = () => {
    // 详情栈是同屏替换内容，不像原生 push 那样有新页面盖上来把键盘带走，
    // 所以这里必须自己收：不收键盘就压在识曲页上，下面的圆盘和结果区会被挡住半截。
    Keyboard.dismiss()
    homeDetailActions.push({ type: 'musicRecognition' })
  }

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme['c-button-background'] }]}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={t('music_recognition')}
      onPress={handlePress}
    >
      <FeatureIcon name="ear-hearing" size={22} color={theme['c-primary-font']} style={styles.icon} />
      <View style={styles.content}>
        <Text size={15} style={styles.title}>{t('music_recognition')}</Text>
        <Text size={12} color={theme['c-font-label']} numberOfLines={1}>{t('music_recognition_desc')}</Text>
      </View>
      <Icon name="chevron-right" size={14} color={theme['c-font-label']} />
    </TouchableOpacity>
  )
}

const styles = createStyle({
  container: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 11,
    paddingBottom: 11,
  },
  icon: {
    width: 34,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  title: {
    marginBottom: 3,
  },
})
