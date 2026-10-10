import { TouchableOpacity, View } from 'react-native'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import type { RecognizedSong } from '@/core/musicRecognition/types'
import { createStyle } from '@/utils/tools'

interface Props {
  song: RecognizedSong
  onAgain: () => void
}

export default ({ song, onAgain }: Props) => {
  const t = useI18n()
  const theme = useTheme()
  const subtitle = [song.singer, song.albumName].filter(text => text).join(' · ')

  return (
    <View style={styles.container}>
      <Text size={12} color={theme['c-font-label']} style={styles.eyebrow}>{t('music_recognition_found')}</Text>
      <Text size={18} color={theme['c-font']} style={styles.name} numberOfLines={2}>{song.name}</Text>
      {
        subtitle
          ? <Text size={13} color={theme['c-font-label']} style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
          : null
      }
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: theme['c-primary-background'] }]}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('music_recognition_again')}
          onPress={onAgain}
        >
          <Text size={14} color={theme['c-primary-font']}>{t('music_recognition_again')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    width: '100%',
    marginTop: 20,
  },
  eyebrow: {
    marginBottom: 6,
  },
  name: {
    marginBottom: 4,
  },
  subtitle: {
    lineHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    marginTop: 16,
  },
  button: {
    flex: 1,
    height: 38,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
