import { useRef, useImperativeHandle, forwardRef, useState } from 'react'
import ConfirmAlert, { type ConfirmAlertType } from '@/components/common/ConfirmAlert'
import Text from '@/components/common/Text'
import { InteractionManager, View } from 'react-native'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import CheckBox from '@/components/common/CheckBox'
import { getListMusics, setFetchingListStatus, updateListMusicPosition } from '@/core/list'
import { getMusicAddTimes, getMusicPlayCounts } from '@/utils/data'
import { sortListMusicInfo, type ListSortId } from './utils'

const Title = ({ title }: {
  title: string
}) => {
  return (
    <Text style={styles.title} size={16}>
      {title}
    </Text>
  )
}

const sortOptions = [
  { id: 'name', label: 'list_sort_option_title' },
  { id: 'album', label: 'list_sort_option_album' },
  { id: 'duration_up', label: 'list_sort_option_duration_up' },
  { id: 'duration_down', label: 'list_sort_option_duration_down' },
  { id: 'add_time_up', label: 'list_sort_option_add_time_up' },
  { id: 'add_time_down', label: 'list_sort_option_add_time_down' },
  { id: 'singer', label: 'list_sort_option_singer' },
  { id: 'year', label: 'list_sort_option_year' },
  { id: 'play_count', label: 'list_sort_option_play_count' },
] as const

export interface ListMusicSortType {
  show: (listInfo: LX.List.MyListInfo) => void
}
export interface ListMusicSortProps {
  onCustomSort?: () => void
}
type ListSortSelection = ListSortId | 'custom'
const initSelectInfo = {}

// 记住上次使用的排序方式，下次打开时默认选中
let lastSelectedSortId: ListSortId | undefined

export default forwardRef<ListMusicSortType, ListMusicSortProps>(({ onCustomSort }, ref) => {
  const t = useI18n()
  const alertRef = useRef<ConfirmAlertType>(null)
  const [title, setTitle] = useState('')
  const selectedListInfo = useRef<LX.List.MyListInfo>(initSelectInfo as LX.List.MyListInfo)
  const [sortId, setSortId] = useState<ListSortSelection | undefined>(lastSelectedSortId)
  const [visible, setVisible] = useState(false)

  const handleShow = () => {
    alertRef.current?.setVisible(true)
  }
  useImperativeHandle(ref, () => ({
    show(listInfo) {
      setTitle(listInfo.name)
      selectedListInfo.current = listInfo
      setSortId(lastSelectedSortId)
      if (visible) handleShow()
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow()
        })
      }
    },
  }))

  const handleSort = async() => {
    if (!sortId) return
    if (sortId == 'custom') {
      if (!onCustomSort) return
      alertRef.current?.setVisible(false)
      onCustomSort()
      return
    }
    lastSelectedSortId = sortId
    const id = selectedListInfo.current.id
    let list = [...(await getListMusics(id))]
    setFetchingListStatus(id, true)
    requestAnimationFrame(() => {
      void InteractionManager.runAfterInteractions(async() => {
        const [addTimes, playCounts] = await Promise.all([getMusicAddTimes(), getMusicPlayCounts()])
        const addTimePrefix = `${id}/`
        list = sortListMusicInfo(list, sortId, global.i18n.locale, {
          getAddTime: musicId => addTimes[addTimePrefix + musicId] ?? 0,
          getPlayCount: musicId => playCounts[musicId] ?? 0,
        })
        await updateListMusicPosition(id, 0, list.map(m => m.id))
        setFetchingListStatus(id, false)
      })
    })

    alertRef.current?.setVisible(false)
  }

  return (
    visible
      ? <ConfirmAlert
          ref={alertRef}
          onConfirm={handleSort}
        >
          <View style={styles.renameContent}>
            <Title title={title} />
            <View style={styles.optionList}>
              {
                sortOptions.map(option => (
                  <CheckBox
                    key={option.id}
                    marginBottom={8}
                    check={sortId == option.id}
                    label={t(option.label)}
                    onChange={() => { setSortId(option.id) }}
                  />
                ))
              }
              {
                onCustomSort
                  ? <CheckBox
                      marginBottom={8}
                      check={sortId == 'custom'}
                      label={t('list_sort_option_custom')}
                      onChange={() => { setSortId('custom') }}
                    />
                  : null
              }
            </View>
          </View>
        </ConfirmAlert>
      : null
  )
})


const styles = createStyle({
  renameContent: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: 'column',
  },
  title: {
    textAlign: 'center',
    // paddingTop: 15,
    paddingBottom: 15,
  },
  optionList: {
    flexDirection: 'column',
  },
})
