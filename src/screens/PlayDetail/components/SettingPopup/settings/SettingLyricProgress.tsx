import { View } from 'react-native'
// import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import CheckBox from '@/components/common/CheckBox'
import styles from './style'


export default ({ compact = false }: { compact?: boolean }) => {
  const t = useI18n()
  const isShowLyricProgressSetting = useSettingValue('playDetail.isShowLyricProgressSetting')
  const setShowLyricProgressSetting = (showLyricProgressSetting: boolean) => {
    updateSetting({ 'playDetail.isShowLyricProgressSetting': showLyricProgressSetting })
  }

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.content}>
        <View style={styles.content}>
          <CheckBox
            marginBottom={compact ? 0 : 3}
            size={compact ? 0.8 : 1}
            check={isShowLyricProgressSetting}
            label={t('play_detail_setting_show_lyric_progress_setting')}
            onChange={setShowLyricProgressSetting}
          />
        </View>
      </View>
    </View>

  )
}
