import { useEffect, useMemo, useRef, useState } from 'react'
import { SectionList, TouchableOpacity, View } from 'react-native'

import StatusBar from '@/components/common/StatusBar'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import SongRow from '@/components/musicRecognition/SongRow'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import { BorderWidths } from '@/theme'
import { createResolver, type Resolver } from '@/core/musicRecognition/resolve'
import { resolveDeps } from '@/core/musicRecognition/resolveDeps'
import { groupBySession, type HistoryItem } from '@/core/musicRecognition/history'
import { recognitionHistory } from '@/core/musicRecognition/historyStore'
import { handlePlay } from '@/components/OnlineList/listAction'
import { confirmDialog, createStyle, getRowInfo } from '@/utils/tools'
import { dateFormat } from '@/utils/common'

// 历史识曲页：从识曲页右上角进来，按「哪一次听到的」分节，一行一首。
//
// 这一页不许自己派请求。行已经在盘上，多数还带着查好的歌条，直接能播；
// 剩下那些没查到的挂成 waiting，用户点一下才去查（见 resolver.request 的 autoStart）。
// 一页 200 行同时开查就是几百笔请求，这是硬约束（没有自建后端）第一个崩的地方。

// SectionList 认 section.data 这一名。一节是一次识曲，标题要同时交代「哪天」和「几点」：
// dayKey 只在该天的第一节印出来，时分每节都印。
interface Section {
  dayKey: string
  showDay: boolean
  timeLabel: string
  data: HistoryItem[]
}

export default ({ onBack }: { onBack: () => void }) => {
  const t = useI18n()
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()
  const rowInfo = useRef(getRowInfo('medium')).current
  const [list, setList] = useState<HistoryItem[]>([])

  // 歌条解析器是这一页自己的：它只负责「这一行点下去有什么歌条」，
  // 与识曲面板那个互不相干 —— 两边的会话节奏不同，共用会让历史行挤掉刚听到的歌的名额。
  const resolverRef = useRef<Resolver | null>(null)
  if (!resolverRef.current) resolverRef.current = createResolver(resolveDeps)
  const resolver = resolverRef.current
  const [, setResolveTick] = useState(0)

  useEffect(() => {
    let mounted = true
    void recognitionHistory.list().then(history => {
      if (mounted) setList(history)
    }).catch(() => {})

    const handleChange = (history: HistoryItem[]) => {
      setList(history)
    }
    global.app_event.on('musicRecognitionHistoryUpdated', handleChange)
    return () => {
      mounted = false
      global.app_event.off('musicRecognitionHistoryUpdated', handleChange)
    }
  }, [])

  // 列表一变，把每一行登记进解析器：带着歌条的直接落成可播，没带的只是登记，不查。
  useEffect(() => {
    for (const item of list) {
      resolver.request(item.engineId, item.song, { autoStart: false, musicInfo: item.musicInfo })
    }
  }, [resolver, list])

  useEffect(() => resolver.subscribe(() => { setResolveTick(current => current + 1) }), [resolver])

  const sections = useMemo<Section[]>(() => {
    const sessions = groupBySession(list)
    return sessions.map((session, index) => ({
      dayKey: session.dayKey,
      // 节是先按天再按次排的，同一天的几节必然连着，所以跟上一节比就够了。
      showDay: index == 0 || sessions[index - 1].dayKey != session.dayKey,
      timeLabel: dateFormat(session.at, 'h:m'),
      data: session.items,
    }))
  }, [list])

  const handleClear = () => {
    if (!list.length) return
    void confirmDialog({
      title: t('music_recognition_history'),
      message: t('music_recognition_history_clear_confirm'),
    }).then(confirmed => {
      if (confirmed) void recognitionHistory.clear()
    })
  }

  const renderItem = ({ item, index }: { item: HistoryItem, index: number }) => (
    <SongRow
      song={item.song}
      entry={resolver.get(item.key)}
      rowInfo={rowInfo}
      index={index}
      timeLabel={dateFormat(item.recognizedAt, 'h:m')}
      onPlay={info => { handlePlay(info) }}
      onLookup={() => { resolver.tap(item.key) }}
    />
  )

  return (
    <View style={styles.container}>
      <StatusBar />
      <View style={{ ...styles.header, paddingTop: statusBarHeight, borderBottomColor: theme['c-border-background'] }}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            onPress={onBack}
          >
            <Icon name="chevron-left" size={20} color={theme['c-font']} />
          </TouchableOpacity>
          <View style={styles.titleContent}>
            <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>{t('music_recognition_history')}</Text>
          </View>
          <TouchableOpacity
            style={styles.clearBtn}
            activeOpacity={0.8}
            accessibilityRole="button"
            onPress={handleClear}
          >
            <Text size={13} color={theme['c-primary-font']}>{t('clear')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            {
              section.showDay
                ? <Text size={12} color={theme['c-font-label']} style={styles.dayTitle}>{section.dayKey}</Text>
                : null
            }
            <Text size={11} color={theme['c-font-label']}>{section.timeLabel}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text size={13} color={theme['c-font-label']} style={styles.empty}>{t('music_recognition_history_empty')}</Text>
        }
      />
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
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
  titleContent: {
    flex: 1,
    height: '100%',
    justifyContent: 'center',
  },
  title: {
    textAlign: 'center',
  },
  clearBtn: {
    height: '100%',
    paddingLeft: 12,
    paddingRight: 14,
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  sectionHeader: {
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  dayTitle: {
    marginBottom: 2,
  },
  empty: {
    textAlign: 'center',
    paddingTop: 24,
  },
})
