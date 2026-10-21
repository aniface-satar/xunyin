import { memo, useState } from 'react'
import { View } from 'react-native'
import Button from '@/components/common/Button'

import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useListInfo } from './state'
import { handleImportAsList } from './listAction'
// import { NAV_SHEAR_NATIVE_IDS } from '@/config/constant'

export interface ActionBarProps {
  name: string
}

export default memo(({ name }: ActionBarProps) => {
  const theme = useTheme()
  const t = useI18n()
  const info = useListInfo()
  const [isLoading, setIsLoading] = useState(false)

  const handleAddToList = () => {
    if (isLoading) return
    if (!name) {
      toast(t('songlist_add_to_mylist_failed'))
      return
    }
    setIsLoading(true)
    void handleImportAsList(info.source, info.id, name).catch(() => {
      toast(t('songlist_add_to_mylist_failed'))
    }).finally(() => {
      setIsLoading(false)
    })
  }

  return (
    <View style={styles.container}>
      <Button disabled={isLoading} onPress={handleAddToList} style={{ ...styles.controlBtn, backgroundColor: theme['c-button-background'] }}>
        <Text style={{ ...styles.controlBtnText, color: theme['c-button-font'] }}>{t(isLoading ? 'songlist_add_to_mylist_loading' : 'songlist_add_to_mylist')}</Text>
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
