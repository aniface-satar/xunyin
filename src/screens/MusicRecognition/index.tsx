import { TouchableOpacity, View } from 'react-native'

import StatusBar from '@/components/common/StatusBar'
import Text from '@/components/common/Text'
import { Icon } from '@/components/common/Icon'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { useStatusbarHeight } from '@/store/common/hook'
import homeDetailActions from '@/store/homeDetail/action'
import { BorderWidths } from '@/theme'
import { createStyle } from '@/utils/tools'
import RecognizePanel from './RecognizePanel'

// 这一页没有引擎标签可切了：一次按下由两个引擎一起听，分别落在结果区各自的分区里。
// 运营要单独关掉某个引擎，用的是远端配置的开关（见 remoteConfig 的 isEngineEnabled），
// 而不是这里的界面 —— 所以配置里那条 engines 数组是全 App 唯一的杠杆。
// 这一页渲染在 Home 的详情栈里（见 DetailStack）：背景色由栈那一层铺，所以这里既不包
// PageContent 也不写 backgroundColor —— 那正是"底色先满屏、内容再出来"这套过渡的机制。
export default ({ onBack }: { onBack: () => void }) => {
  const t = useI18n()
  const theme = useTheme()
  const statusBarHeight = useStatusbarHeight()

  return (
    <View style={styles.container}>
      {/* 有详情路由时 Home 的 Header 整个被换掉，状态栏样式没人管了，所以这一页自己带着它 */}
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
            <Text style={styles.title} size={16} color={theme['c-font']} numberOfLines={1}>{t('music_recognition')}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.historyBtn}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('music_recognition_history')}
              onPress={() => { homeDetailActions.push({ type: 'musicRecognitionHistory' }) }}
            >
              <Icon name="music_time" size={19} color={theme['c-font']} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <RecognizePanel />
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
  headerRight: {
    width: 44,
  },
  historyBtn: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
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
