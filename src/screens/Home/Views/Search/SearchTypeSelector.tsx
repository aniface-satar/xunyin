import { useMemo } from 'react'
import { type StyleProp, ScrollView, TouchableOpacity, type ViewStyle } from 'react-native'

import { createStyle } from '@/utils/tools'
import { type SearchType } from '@/store/search/state'
import { useI18n } from '@/lang'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { BorderWidths } from '@/theme'
import { SEARCH_TYPES } from './searchTypes'

interface SearchTypeSelectorProps {
  style?: StyleProp<ViewStyle>
  type: SearchType
  onTypeChange: (type: SearchType) => void
}

export default ({ style, type, onTypeChange }: SearchTypeSelectorProps) => {
  const t = useI18n()
  const theme = useTheme()

  const list = useMemo(() => {
    return SEARCH_TYPES.map(type => ({ label: t(`search_type_${type}`), id: type }))
  }, [t])

  return (
    <ScrollView style={[styles.container, style]} keyboardShouldPersistTaps={'always'} horizontal={true}>
      {
        list.map(t => (
          <TouchableOpacity style={styles.button} onPress={() => { onTypeChange(t.id) }} key={t.id}>
            <Text style={{ ...styles.buttonText, borderBottomColor: type == t.id ? theme['c-primary-background-active'] : 'transparent' }} color={type == t.id ? theme['c-primary-font-active'] : theme['c-font']}>{t.label}</Text>
          </TouchableOpacity>
        ))
      }
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    height: '100%',
    flexGrow: 0,
    flexShrink: 1,
  },
  button: {
    justifyContent: 'center',
    paddingLeft: 8,
    paddingRight: 8,
  },
  buttonText: {
    textAlign: 'center',
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 3,
    paddingBottom: 3,
    borderBottomWidth: BorderWidths.normal3,
  },
})
