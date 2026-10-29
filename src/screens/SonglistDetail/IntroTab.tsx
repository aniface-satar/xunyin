import { ScrollView } from 'react-native'

import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'

// 专辑「介绍」标签页（对齐 ArtistDetail/IntroTab，简介随详情接口一起返回，无需单独的加载/重试态）
export default ({ desc }: {
  desc: string
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.desc} size={13} color={desc ? theme['c-font'] : theme['c-font-label']}>{desc || t('album_desc_empty')}</Text>
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
