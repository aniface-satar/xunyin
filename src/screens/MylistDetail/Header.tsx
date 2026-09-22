import { useEffect, useRef, useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import Input, { type InputType } from '@/components/common/Input'
import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { createStyle } from '@/utils/tools'
import { BorderWidths } from '@/theme'
import { notifyKeyboardWillShow } from '@/utils/hooks/useKeyboard'

interface HeaderSearchInputProps {
  placeholder: string
  onSearch: (keyword: string) => void
}

const HeaderSearchInput = ({ placeholder, onSearch }: HeaderSearchInputProps) => {
  const theme = useTheme()
  const inputRef = useRef<InputType>(null)
  const [keyword, setKeyword] = useState('')

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
    <View style={styles.searchContent}>
      <Icon name="search-2" size={16} color={theme['c-font-label']} />
      <Input
        ref={inputRef}
        value={keyword}
        placeholder={placeholder}
        clearBtn
        autoCorrect={false}
        returnKeyType="search"
        style={styles.searchInput}
        onChangeText={text => {
          setKeyword(text)
          onSearch(text.trim())
        }}
      />
    </View>
  )
}

export default ({
  componentId,
  name,
  onShowSearch,
  showSearch = true,
  onBack,
  searchMode = false,
  searchPlaceholder,
  onSearch,
  onExitSearch,
}: {
  componentId: string
  name: string
  onShowSearch: () => void
  showSearch?: boolean
  onBack?: () => void
  searchMode?: boolean
  searchPlaceholder?: string
  onSearch?: (keyword: string) => void
  onExitSearch?: () => void
}) => {
  const statusBarHeight = useStatusbarHeight()
  const theme = useTheme()

  return (
    <View style={{ ...styles.container, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.8}
          onPress={() => {
            if (searchMode) {
              onExitSearch?.()
              return
            }
            if (onBack) {
              onBack()
            } else {
              void pop(componentId)
            }
          }}
        >
          <Icon name="chevron-left" size={20} color={theme['c-font']} />
        </TouchableOpacity>
        {
          searchMode
            ? (
              <>
                <HeaderSearchInput
                  placeholder={searchPlaceholder ?? ''}
                  onSearch={keyword => { onSearch?.(keyword) }}
                />
              </>
              )
            : (
              <View style={styles.titleContent}>
                <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>
                  {name}
                </Text>
              </View>
              )
        }
        {
          showSearch && !searchMode
            ? (
              <TouchableOpacity style={styles.actionBtn} activeOpacity={0.8} onPress={() => { notifyKeyboardWillShow(); onShowSearch() }}>
                <Icon name="search-2" size={20} color={theme['c-font']} />
              </TouchableOpacity>
              )
            : <View style={styles.actionBtn} />
        }
      </View>
    </View>
  )
}

const styles = createStyle({
  container: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: BorderWidths.normal,
  },
  headerRow: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 44,
    height: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 10,
  },
  actionBtn: {
    width: 44,
    height: '100%',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 10,
  },
  searchContent: {
    flex: 1,
    height: 32,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.14)',
  },
  searchInput: {
    flex: 1,
    height: 32,
    paddingLeft: 4,
    paddingRight: 0,
  },
  titleContent: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
})

