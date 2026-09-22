import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Input, { type InputType } from '@/components/common/Input'
import { useTheme } from '@/store/theme/hook'
import { useNavActiveId } from '@/store/common/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { notifyKeyboardWillShow } from '@/utils/hooks/useKeyboard'

interface MylistSearchState {
  isSearchMode: boolean
  keyword: string
  enterSearch: () => void
  exitSearch: () => void
  setKeyword: (keyword: string) => void
}

const defaultState: MylistSearchState = {
  isSearchMode: false,
  keyword: '',
  enterSearch: () => {},
  exitSearch: () => {},
  setKeyword: () => {},
}

const MylistSearchContext = createContext<MylistSearchState>(defaultState)

export const MylistSearchProvider = ({ children }: { children: React.ReactNode }) => {
  const navActiveId = useNavActiveId()
  const [isSearchMode, setIsSearchMode] = useState(false)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    setIsSearchMode(false)
    setKeyword('')
  }, [navActiveId])

  const enterSearch = useCallback(() => {
    setIsSearchMode(true)
  }, [])

  const exitSearch = useCallback(() => {
    setIsSearchMode(false)
    setKeyword('')
  }, [])

  const value = useMemo(() => ({
    isSearchMode,
    keyword,
    enterSearch,
    exitSearch,
    setKeyword,
  }), [enterSearch, exitSearch, isSearchMode, keyword])

  return <MylistSearchContext.Provider value={value}>{children}</MylistSearchContext.Provider>
}

export const useMylistSearch = () => {
  return useContext(MylistSearchContext)
}

export const MylistSearchButton = () => {
  const theme = useTheme()
  const { enterSearch } = useMylistSearch()

  return (
    <TouchableOpacity style={styles.btn} onPress={() => { notifyKeyboardWillShow(); enterSearch() }} activeOpacity={0.8}>
      <Icon color={theme['c-font']} name="search-2" size={18} />
    </TouchableOpacity>
  )
}

export const MylistSearchBar = () => {
  const inputRef = useRef<InputType>(null)
  const theme = useTheme()
  const t = useI18n()
  const { exitSearch, keyword, setKeyword } = useMylistSearch()

  useEffect(() => {
    const task = requestAnimationFrame(() => {
      notifyKeyboardWillShow()
      inputRef.current?.focus()
    })
    return () => {
      cancelAnimationFrame(task)
    }
  }, [])

  return (
    <View style={styles.bar}>
      <TouchableOpacity style={styles.btn} onPress={exitSearch} activeOpacity={0.8}>
        <Icon color={theme['c-font']} name="chevron-left" size={20} />
      </TouchableOpacity>
      <View style={styles.inputWrap}>
        <Input
          ref={inputRef}
          value={keyword}
          onChangeText={setKeyword}
          onClearText={() => {
            setKeyword('')
          }}
          placeholder={t('mylist_search_playlists')}
          clearBtn
          style={styles.input}
        />
      </View>
    </View>
  )
}

const styles = createStyle({
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: '100%',
    paddingRight: 10,
  },
  btn: {
    width: 38,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: {
    flex: 1,
    height: 34,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.14)',
    paddingLeft: 8,
    paddingRight: 8,
    justifyContent: 'center',
  },
  input: {
    height: 34,
  },
})

