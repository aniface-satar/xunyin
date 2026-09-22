import { memo, useCallback, useEffect } from 'react'
import { ScrollView, TouchableOpacity, View } from 'react-native'

import Main, { SETTING_SCREENS, type SettingScreenIds } from '../Main'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { scaleSizeW } from '@/utils/pixelRatio'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { BorderRadius, BorderWidths } from '@/theme'
import { setSettingDetailId, useSettingDetailId } from '../detailId'


const SETTING_ITEMS: Array<{ id: SettingScreenIds, icon: string }> = [
  { id: 'basic', icon: 'setting' },
  { id: 'player', icon: 'play' },
  { id: 'lyric_desktop', icon: 'lyric-on' },
  { id: 'search', icon: 'search-2' },
  { id: 'list', icon: 'list-order' },
  { id: 'sync', icon: 'home' },
  { id: 'backup', icon: 'download-2' },
  { id: 'other', icon: 'dots-vertical' },
  { id: 'version', icon: 'available_updates' },
  { id: 'about', icon: 'logo' },
]

const DOTS_VERTICAL_ALIGNMENT_OFFSET = scaleSizeW(17) * 384 / 1024

const ParentItem = memo(({ id, icon, onPress }: {
  id: SettingScreenIds
  icon: string
  onPress: (id: SettingScreenIds) => void
}) => {
  const theme = useTheme()
  const t = useI18n()

  return (
    <TouchableOpacity
      style={{ ...styles.item, borderBottomColor: theme['c-border-background'] }}
      activeOpacity={0.8}
      onPress={() => { onPress(id) }}
    >
      <View style={{ ...styles.itemIcon, backgroundColor: theme['c-primary-background-active'] }}>
        <Icon
          name={icon}
          size={17}
          color={theme['c-primary-font-active']}
          style={icon === 'dots-vertical' ? styles.dotsIcon : undefined}
        />
      </View>
      <Text style={styles.itemText} size={16} numberOfLines={1}>{t(`setting_${id}`)}</Text>
      <Icon name="chevron-right" size={14} color={theme['c-font-label']} />
    </TouchableOpacity>
  )
})

const ParentList = ({ onPress }: {
  onPress: (id: SettingScreenIds) => void
}) => {
  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps={'always'}>
      {
        SETTING_SCREENS.map(id => {
          const item = SETTING_ITEMS.find(setting => setting.id == id)
          if (!item) return null
          return <ParentItem key={id} id={id} icon={item.icon} onPress={onPress} />
        })
      }
    </ScrollView>
  )
}

const Detail = ({ id }: {
  id: SettingScreenIds
}) => {
  return (
    <ScrollView style={styles.detailContent} keyboardShouldPersistTaps={'always'}>
      <Main activeId={id} />
    </ScrollView>
  )
}

export default () => {
  const activeId = useSettingDetailId()

  useEffect(() => {
    setSettingDetailId(null)
    return () => {
      setSettingDetailId(null)
    }
  }, [])

  const handleSelect = useCallback((id: SettingScreenIds) => {
    setSettingDetailId(id)
  }, [])

  const handleBack = useCallback(() => {
    setSettingDetailId(null)
  }, [])

  useBackHandler(useCallback(() => {
    if (activeId == null) return false
    handleBack()
    return true
  }, [activeId, handleBack]))

  if (activeId == null) return <ParentList onPress={handleSelect} />

  return <Detail id={activeId} />
}

const styles = createStyle({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  item: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 12,
    borderBottomWidth: BorderWidths.normal,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.normal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    flex: 1,
    marginLeft: 10,
  },
  dotsIcon: {
    transform: [{ translateX: DOTS_VERTICAL_ALIGNMENT_OFFSET }],
  },
  detailContent: {
    flex: 1,
    paddingBottom: 20,
  },
})
