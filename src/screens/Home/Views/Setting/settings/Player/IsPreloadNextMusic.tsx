import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBoxItem from '../../components/CheckBoxItem'

export default memo(() => {
  const t = useI18n()
  const isPreloadNextMusic = useSettingValue('player.preloadNextMusic')
  const setPreloadNextMusic = (isPreloadNextMusic: boolean) => {
    updateSetting({ 'player.preloadNextMusic': isPreloadNextMusic })
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isPreloadNextMusic}
        onChange={setPreloadNextMusic}
        helpDesc={t('setting_play_preload_next_tip')}
        label={t('setting_play_preload_next')}
      />
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
