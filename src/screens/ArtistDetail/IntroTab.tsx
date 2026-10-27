import { ScrollView } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'

export type IntroStatus = 'loading' | 'done' | 'error'

export default ({ desc, status, onRetry }: {
  desc: string
  status: IntroStatus
  onRetry: () => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  let content
  switch (status) {
    case 'loading':
      content = <Text size={13} color={theme['c-font-label']}>{t('list_loading')}</Text>
      break
    case 'error':
      content = <Text size={13} color={theme['c-primary']} onPress={onRetry}>{t('list_error')}</Text>
      break
    default:
      content = <Text style={styles.desc} size={13} color={desc ? theme['c-font'] : theme['c-font-label']}>{desc || t('artist_desc_empty')}</Text>
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {content}
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    padding: 15,
  },
  desc: {
    lineHeight: 22,
  },
})
