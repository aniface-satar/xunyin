import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { memo } from 'react'
import { View } from 'react-native'
import { useSettingValue } from '@/store/setting/hook'

import CheckBox from '@/components/common/CheckBox'
import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'

type Level = LX.AppSetting['player.volumeBalancerLevel']

const LEVELS: Level[] = ['low', 'mid', 'high']

export default memo(() => {
  const t = useI18n()
  const isEnable = useSettingValue('player.isEnableVolumeBalancer')
  const level = useSettingValue('player.volumeBalancerLevel')
  const levelLabels: Record<Level, string> = {
    low: t('setting_play_volume_balancer_level_low'),
    mid: t('setting_play_volume_balancer_level_mid'),
    high: t('setting_play_volume_balancer_level_high'),
  }

  const handleEnableChange = (value: boolean) => {
    updateSetting({ 'player.isEnableVolumeBalancer': value })
    toast(t('setting_play_volume_balancer_restart_tip'))
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem
        check={isEnable}
        onChange={handleEnableChange}
        helpDesc={t('setting_play_volume_balancer_tip')}
        label={t('setting_play_volume_balancer')}
      />
      {
        isEnable
          ? (
            <SubTitle title={t('setting_play_volume_balancer_level')}>
              <View style={styles.list}>
                {
                  LEVELS.map(l => (
                    <CheckBox
                      key={l}
                      marginRight={8}
                      check={l == level}
                      label={levelLabels[l]}
                      onChange={() => {
                        if (l == level) return
                        updateSetting({ 'player.volumeBalancerLevel': l })
                      }}
                      need
                    />
                  ))
                }
              </View>
            </SubTitle>
            )
          : null
      }
    </View>
  )
})


const styles = createStyle({
  content: {
    marginTop: 5,
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
