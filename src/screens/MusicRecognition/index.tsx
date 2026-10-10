import { useState } from 'react'
import { TouchableOpacity, View } from 'react-native'

import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { DEFAULT_ENGINE_ID, ENGINES, getEngine, type EngineId } from '@/core/musicRecognition/engines'
import { useI18n } from '@/lang'
import { pop } from '@/navigation'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { BorderWidths } from '@/theme'
import { createStyle } from '@/utils/tools'
import RecognizePanel from './RecognizePanel'

export default ({ componentId }: { componentId: string }) => {
  const t = useI18n()
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const [engineId, setEngineId] = useState<EngineId>(DEFAULT_ENGINE_ID)
  const engine = getEngine(engineId)

  return (
    <PageContent>
      <StatusBar />
      <View style={{ ...styles.header, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            onPress={() => { void pop(componentId) }}
          >
            <Icon name="chevron-left" size={20} color={theme['c-font']} />
          </TouchableOpacity>
          <View style={styles.titleContent}>
            <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>{t('music_recognition')}</Text>
          </View>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.tabs}>
          {
            ENGINES.map((item, index) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.tab,
                  index < ENGINES.length - 1 ? styles.tabGap : null,
                  {
                    backgroundColor: item.id == engineId ? theme['c-primary-background'] : theme['c-button-background'],
                  },
                ]}
                activeOpacity={0.8}
                accessibilityRole="tab"
                accessibilityState={{ selected: item.id == engineId }}
                onPress={() => { setEngineId(item.id) }}
              >
                <Text size={13} color={item.id == engineId ? theme['c-primary-font'] : theme['c-font-label']}>
                  {t(item.nameKey)}
                </Text>
              </TouchableOpacity>
            ))
          }
        </View>
      </View>
      <RecognizePanel key={engine.id} engine={engine} />
    </PageContent>
  )
}

const styles = createStyle({
  header: {
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
  headerRight: {
    width: 44,
  },
  titleContent: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  tabs: {
    flexDirection: 'row',
    paddingLeft: 20,
    paddingRight: 20,
    paddingBottom: 10,
  },
  tab: {
    flex: 1,
    height: 34,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabGap: {
    marginRight: 8,
  },
})
