import { memo } from 'react'
import { View } from 'react-native'
import Button from '@/components/common/Button'

import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { handlePlay } from './listAction'
import songlistState from '@/store/songlist/state'
import { useI18n } from '@/lang'
import { useListInfo } from './state'
// import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

export default memo(() => {
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()

  const handlePlayAll = () => {
    void handlePlay(info.id, info.source, songlistState.listDetailInfo.list, 0, {
      name: info.name,
      author: info.author,
      img: info.img,
    })
  }

  return (
    <View style={styles.container}>
      <Button onPress={handlePlayAll} style={{ ...styles.controlBtn, backgroundColor: theme['c-button-background'] }}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t('play_all')}</Text>
      </Button>
    </View>
  )
})

const styles = createStyle({
  container: {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    paddingLeft: 10,
    paddingRight: 10,
    paddingBottom: 10,
  },
  controlBtn: {
    flexGrow: 1,
    flexShrink: 1,
    width: '100%',
    borderRadius: 4,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 10,
    paddingRight: 10,
  },
  controlBtnText: {
    fontSize: 13,
    textAlign: 'center',
  },
})
