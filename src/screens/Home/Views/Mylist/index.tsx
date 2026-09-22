import { useCallback } from 'react'
import { View } from 'react-native'

import { setActiveList } from '@/core/list'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import homeDetailActions from '@/store/homeDetail/action'
import { createStyle } from '@/utils/tools'
import { LIST_IDS } from '@/config/constant'
import PlaylistOverview from './PlaylistOverview'

export default () => {
  const theme = useTheme()
  const t = useI18n()

  const openList = useCallback((listInfo: LX.List.MyListInfo) => {
    setActiveList(listInfo.id)
    homeDetailActions.push({
      type: 'mylist',
      info: {
        id: listInfo.id,
        name: listInfo.name,
      },
    })
  }, [])

  const openLove = useCallback(() => {
    setActiveList(LIST_IDS.LOVE)
    homeDetailActions.push({
      type: 'mylist',
      info: {
        id: LIST_IDS.LOVE,
        name: t('mylist_favorite'),
      },
    })
  }, [t])

  const openHistory = useCallback(() => {
    homeDetailActions.push({
      type: 'mylist',
      info: {
        id: 'history',
        name: t('mylist_history'),
        mode: 'history',
      },
    })
  }, [t])

  return (
    <View style={{ ...styles.container, backgroundColor: theme['c-content-background'] }}>
      <PlaylistOverview onOpenList={openList} onOpenLove={openLove} onOpenHistory={openHistory} />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
})
