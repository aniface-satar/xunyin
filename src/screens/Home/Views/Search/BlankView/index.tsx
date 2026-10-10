import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import HistorySearch, { type HistorySearchType } from './HistorySearch'
import HotSearch, { type HotSearchType } from './HotSearch'
import MusicRecognitionEntry from './MusicRecognitionEntry'

interface BlankViewProps {
  onSearch: (keyword: string) => void
}
type Source = LX.OnlineSource | 'all'

export interface BlankViewType {
  show: (source: Source) => void
}

export default forwardRef<BlankViewType, BlankViewProps>(({ onSearch }, ref) => {
  // const [listType, setListType] = useState<SearchState['searchType']>('music')
  const [visible, setVisible] = useState(false)
  const hotSearchRef = useRef<HotSearchType>(null)
  const historySearchRef = useRef<HistorySearchType>(null)
  const isShowHotSearch = useSettingValue('search.isShowHotSearch')
  const isShowHistorySearch = useSettingValue('search.isShowHistorySearch')
  const t = useI18n()
  const theme = useTheme()

  const handleShow = (source: Source) => {
    hotSearchRef.current?.show(source)
    historySearchRef.current?.show()
  }

  useImperativeHandle(ref, () => ({
    show(source) {
      if (visible) handleShow(source)
      else {
        setVisible(true)
        requestAnimationFrame(() => {
          handleShow(source)
        })
      }
    },
  }), [visible])

  return (
    visible
      ? (
          <ScrollView>
            <View style={styles.content}>
              <MusicRecognitionEntry />
              { isShowHotSearch ? <HotSearch ref={hotSearchRef} onSearch={onSearch} /> : null }
              { isShowHistorySearch ? <HistorySearch ref={historySearchRef} onSearch={onSearch} /> : null }
              {
                !isShowHotSearch && !isShowHistorySearch
                  ? <Text style={styles.welcomeText} size={16} color={theme['c-font-label']}>{t('search__welcome')}</Text>
                  : null
              }
            </View>
          </ScrollView>
        )
      : null

  )
})


const styles = createStyle({
  content: {
    // paddingTop: 15,
    paddingBottom: 15,
    paddingLeft: 15,
    paddingRight: 15,
  },
  welcomeText: {
    marginTop: 30,
    textAlign: 'center',
  },
})
