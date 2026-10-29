import { Fragment, forwardRef, useImperativeHandle, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  ScrollView,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native'

import GlassBackdrop from '@/components/common/GlassBackdrop'
import Image from '@/components/common/Image'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { findArtistByName } from '@/core/artistResolve'
import { BorderWidths } from '@/theme'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useSheetSlideAnimation } from '@/utils/hooks/useSheetSlideAnimation'
import { createStyle } from '@/utils/tools'
import type { ArtistSearchItem, ArtistSource } from '@/utils/musicSdk/artistNormalizers'

type ArtistEntryStatus = 'loading' | 'ok' | 'missing'

interface ArtistEntry {
  name: string
  status: ArtistEntryStatus
  item: ArtistSearchItem | null
}

export interface ArtistPickerShowOptions {
  source: ArtistSource
  names: string[]
  onPick: (item: ArtistSearchItem) => void
}

export interface ArtistPickerSheetType {
  show: (options: ArtistPickerShowOptions) => void
}

const ArtistPickerSheet = forwardRef<ArtistPickerSheetType>((_, ref) => {
  const theme = useTheme()
  const t = useI18n()
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const [entries, setEntries] = useState<ArtistEntry[]>([])
  const sourceRef = useRef<ArtistSource>('tx')
  const onPickRef = useRef<ArtistPickerShowOptions['onPick'] | null>(null)
  const requestRef = useRef(0)
  const slide = useSheetSlideAnimation()

  useImperativeHandle(ref, () => ({
    show({ source, names, onPick }) {
      const requestId = ++requestRef.current
      sourceRef.current = source
      onPickRef.current = onPick
      setEntries(names.map(name => ({ name, status: 'loading', item: null })))
      setMounted(true)
      slide.show()
      requestAnimationFrame(() => {
        setVisible(true)
      })
      names.forEach(name => {
        void findArtistByName(source, name).then(item => {
          if (requestRef.current != requestId) return
          setEntries(prev => prev.map(entry => entry.name == name
            ? { ...entry, status: item ? 'ok' : 'missing', item }
            : entry))
        })
      })
    },
  }))

  const hide = (after?: () => void) => {
    slide.hide(() => {
      setVisible(false)
      after?.()
    })
  }

  const handlePick = (entry: ArtistEntry) => {
    if (entry.status == 'missing') return
    if (entry.item) {
      const item = entry.item
      hide(() => {
        onPickRef.current?.(item)
      })
      return
    }
    void findArtistByName(sourceRef.current, entry.name).then(item => {
      if (!item) {
        setEntries(prev => prev.map(current => current.name == entry.name
          ? { ...current, status: 'missing' }
          : current))
        return
      }
      hide(() => {
        onPickRef.current?.(item)
      })
    })
  }

  if (!mounted) return null

  return (
    <Modal
      animationType="none"
      transparent
      hardwareAccelerated
      statusBarTranslucent
      visible={visible}
      onRequestClose={() => {
        hide()
      }}
      onDismiss={() => {
        if (!visible) setMounted(false)
      }}
    >
      <TouchableWithoutFeedback onPress={() => {
        hide()
      }}>
        <Animated.View style={[styles.mask, { opacity: slide.maskOpacity }]}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: theme['c-content-background'] },
              { transform: [{ translateY: slide.sheetY }] },
            ]}
            onLayout={slide.onSheetLayout}
            onStartShouldSetResponder={() => true}
          >
            <GlassBackdrop
              overlayOpacity={0.62}
              restOffset={slide.sheetLayout}
              style={{ backgroundColor: theme['c-content-background'] }}
            />
            <View style={styles.content}>
              <Text style={styles.title} size={13} color={theme['c-font']}>
                {t('artist_picker_title')}
              </Text>
              <ScrollView
                style={styles.options}
                showsVerticalScrollIndicator={false}
              >
                {
                  entries.map((entry, index) => (
                    <Fragment key={entry.name}>
                      <TouchableOpacity
                        style={[
                          styles.option,
                          entry.status == 'missing' ? styles.optionDisabled : null,
                        ]}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel={entry.name}
                        disabled={entry.status == 'missing'}
                        onPress={() => {
                          handlePick(entry)
                        }}
                      >
                        {
                          entry.item?.img
                            ? <Image url={entry.item.img} style={styles.avatar} />
                            : <View style={[styles.avatar, { backgroundColor: theme['c-primary-background'] }]} />
                        }
                        <Text style={styles.artistName} numberOfLines={1} size={15} color={theme['c-font']}>{entry.name}</Text>
                        {
                          entry.status == 'missing'
                            ? <Text size={12} color={theme['c-font-label']}>{t('artist_picker_missing')}</Text>
                            : entry.status == 'loading'
                              ? <ActivityIndicator size="small" color={theme['c-font-label']} />
                              : <Icon name="chevron-right" size={14} color={theme['c-font-label']} />
                        }
                      </TouchableOpacity>
                      {
                        index < entries.length - 1 && (
                          <View style={[styles.separator, { borderBottomColor: theme['c-border-background'] }]} />
                        )
                      }
                    </Fragment>
                  ))
                }
              </ScrollView>
            </View>
          </Animated.View>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  )
})

export default ArtistPickerSheet

const styles = createStyle({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
  },
  content: {
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  options: {
    maxHeight: 300,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingHorizontal: 16,
  },
  // 与全屏播控页更多菜单同一条分隔线：borderBottom + BorderWidths.normal，不走 createStyle 的尺寸换算
  separator: {
    borderBottomWidth: BorderWidths.normal,
  },
  optionDisabled: {
    opacity: 0.45,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginRight: 12,
  },
  artistName: {
    flex: 1,
  },
})
