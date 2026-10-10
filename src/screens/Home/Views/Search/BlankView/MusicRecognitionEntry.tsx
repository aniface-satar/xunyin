import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import Waveform from '@/components/musicRecognition/Waveform'
import { useI18n } from '@/lang'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'

export default () => {
  const t = useI18n()
  const theme = useTheme()

  const handlePress = () => {
    const componentId = commonState.componentIds.home
    if (!componentId) return
    navigations.pushMusicRecognitionScreen(componentId)
  }

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: theme['c-button-background'], borderColor: theme['c-border-background'] }]}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={t('music_recognition')}
      onPress={handlePress}
    >
      <View style={styles.content}>
        <Text size={16} style={styles.title}>{t('music_recognition')}</Text>
        <Text size={12} color={theme['c-font-label']} numberOfLines={1}>{t('music_recognition_desc')}</Text>
        <Text size={12} color={theme['c-font-label']} style={styles.engines}>{t('music_recognition_engines_hint')}</Text>
      </View>
      <View style={styles.side}>
        <Waveform bars={7} height={26} color={theme['c-primary']} />
        <Icon name="chevron-right" size={14} color={theme['c-300']} />
      </View>
    </TouchableOpacity>
  )
}

const styles = createStyle({
  container: {
    marginTop: 15,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingLeft: 14,
    paddingRight: 10,
    paddingTop: 12,
    paddingBottom: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    marginBottom: 4,
  },
  engines: {
    marginTop: 6,
  },
  side: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
})
