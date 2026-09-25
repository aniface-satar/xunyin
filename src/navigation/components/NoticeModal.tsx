import { View, ScrollView } from 'react-native'

import Button from '@/components/common/Button'
import Text from '@/components/common/Text'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import ModalContent from './ModalContent'
import { hideNoticeModal } from '@/core/version'

const NoticeModal = ({ componentId, text }: { componentId: string, text: string }) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <ModalContent>
      <View style={styles.main}>
        <Text style={styles.title}>{t('notice_title')}</Text>
        <ScrollView style={styles.content} keyboardShouldPersistTaps={'always'}>
          <Text selectable style={styles.desc}>{text}</Text>
        </ScrollView>
      </View>
      <View style={styles.btns}>
        <Button style={{ ...styles.btn, backgroundColor: theme['c-button-background'] }} onPress={() => { void hideNoticeModal(componentId) }}>
          <Text color={theme['c-button-font']}>{t('notice_btn_confirm')}</Text>
        </Button>
      </View>
    </ModalContent>
  )
}

const styles = createStyle({
  main: {
    flexShrink: 1,
    marginTop: 15,
    marginLeft: 15,
    marginRight: 15,
    marginBottom: 20,
    maxHeight: 300,
  },
  content: {
    flexGrow: 0,
  },
  title: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 15,
  },
  desc: {
    fontSize: 14,
    lineHeight: 20,
  },
  btns: {
    flexDirection: 'column',
    rowGap: 10,
    paddingBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
  },
  btn: {
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    alignItems: 'center',
    borderRadius: 4,
  },
})

export default NoticeModal
