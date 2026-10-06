import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native'

import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'
import { useTempPlayList } from '@/store/player/hook'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { getRadioMode, getRadioQueueSummary, getRadioStatus, isRadioActive, startRadio } from '@/core/recommend/radio'
import { createStyle } from '@/utils/tools'
import type { RadioMode } from '@/core/recommend/types'

type CardStatus = 'idle' | 'loading' | 'playing' | 'error'

const COPY = {
  radio: {
    title: 'recommend_radio_title',
    desc: 'recommend_radio_desc',
    loading: 'recommend_radio_loading',
    playing: 'recommend_radio_playing',
  },
  explore: {
    title: 'recommend_explore_title',
    desc: 'recommend_explore_desc',
    loading: 'recommend_explore_loading',
    playing: 'recommend_explore_playing',
  },
} as const

const BIAS_OPTIONS = ['familiar', 'balanced', 'explore'] as const

const BiasColumn = () => {
  const theme = useTheme()
  const t = useI18n()
  const bias = useSettingValue('recommend.exploreBias')
  const labels: Record<typeof BIAS_OPTIONS[number], string> = {
    familiar: t('recommend_bias_familiar'),
    balanced: t('recommend_bias_balanced'),
    explore: t('recommend_bias_explore'),
  }
  return (
    <View style={styles.biasColumn}>
      {
        BIAS_OPTIONS.map(option => {
          const active = bias == option
          return (
            <TouchableOpacity
              key={option}
              style={{
                ...styles.biasOption,
                backgroundColor: active ? theme['c-primary-background-hover'] : 'transparent',
              }}
              activeOpacity={0.7}
              onPress={() => {
                updateSetting({ 'recommend.exploreBias': option })
              }}
            >
              <Text size={12} color={active ? theme['c-primary-font-active'] : theme['c-font-label']}>
                {labels[option]}
              </Text>
            </TouchableOpacity>
          )
        })
      }
    </View>
  )
}

const useRadioCard = (mode: RadioMode) => {
  const tempPlayList = useTempPlayList()
  const [status, setStatus] = useState<CardStatus>(() => isRadioActive() && getRadioMode() == mode ? 'playing' : 'idle')
  const [upcoming, setUpcoming] = useState<string[]>([])

  // 电台与探索共用同一个引擎队列，任一模式在播时另一张卡片要回到待命态
  useEffect(() => {
    const active = isRadioActive() && getRadioMode() == mode
    setStatus(current => active ? 'playing' : current == 'playing' ? 'idle' : current)
    setUpcoming(active ? getRadioQueueSummary(3) : [])
  }, [mode, tempPlayList])

  const handlePress = useCallback(async() => {
    setStatus('loading')
    try {
      await startRadio(mode)
      setUpcoming(getRadioQueueSummary(3))
      setStatus('playing')
    } catch (error) {
      const status = getRadioStatus()
      console.error('[recommend] start_failed', mode, error, JSON.stringify({
        poolSize: status.poolSize,
        queueSize: status.queueSize,
        channels: status.channels,
        reasons: status.reasons,
      }))
      setStatus('error')
    }
  }, [mode])

  return { status, handlePress, upcoming }
}

const CardBody = ({ mode, status, upcoming }: { mode: RadioMode, status: CardStatus, upcoming: string[] }) => {
  const theme = useTheme()
  const t = useI18n()
  const copy = COPY[mode]
  const playingText = upcoming.length
    ? t('recommend_queue_next', { names: upcoming.join('、') })
    : t(copy.playing)
  return (
    <>
      <Text size={22} color={theme['c-font']}>{t(copy.title)}</Text>
      <Text size={13} color={theme['c-font-label']} style={styles.cardDesc}>
        {status == 'playing' ? playingText : t(copy.desc)}
      </Text>
      {
        status == 'loading' || status == 'error'
          ? <Text size={12} color={theme['c-font-label']} style={styles.cardStatus}>
              {status == 'loading' ? t(copy.loading) : t('recommend_error')}
            </Text>
          : null
      }
    </>
  )
}

const Recommend = () => {
  const theme = useTheme()
  const radio = useRadioCard('radio')
  const explore = useRadioCard('explore')

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity
        style={{ ...styles.card, backgroundColor: theme['c-primary-background-active'] }}
        activeOpacity={0.85}
        onPress={() => {
          void radio.handlePress()
        }}
      >
        <View style={styles.cardInner}>
          <View style={styles.cardMain}>
            <CardBody mode="radio" status={radio.status} upcoming={radio.upcoming} />
            {radio.status == 'loading' ? <ActivityIndicator color={theme['c-primary-font-active']} style={styles.spinner} /> : null}
          </View>
          <BiasColumn />
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={{ ...styles.card, backgroundColor: theme['c-primary-background-active'] }}
        activeOpacity={0.85}
        onPress={() => {
          void explore.handlePress()
        }}
      >
        <CardBody mode="explore" status={explore.status} upcoming={explore.upcoming} />
        {explore.status == 'loading' ? <ActivityIndicator color={theme['c-primary-font-active']} style={styles.spinner} /> : null}
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: 15,
    paddingHorizontal: 15,
    paddingBottom: 30,
  },
  card: {
    borderRadius: 14,
    padding: 24,
    marginBottom: 15,
    minHeight: 150,
    justifyContent: 'center',
  },
  cardDesc: {
    marginTop: 10,
  },
  cardStatus: {
    marginTop: 6,
  },
  spinner: {
    position: 'absolute',
    right: 20,
    top: 20,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardMain: {
    flex: 1,
  },
  biasColumn: {
    marginLeft: 10,
    gap: 4,
  },
  biasOption: {
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: 72,
  },
})

export default Recommend
