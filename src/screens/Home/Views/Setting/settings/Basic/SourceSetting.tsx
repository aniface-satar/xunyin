import { memo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { useSettingValue } from '@/store/setting/hook'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const t = useI18n()
  const allowShowUpdateAlert = useSettingValue('common.userApiAllowShowUpdateAlert')
  const autoUpdate = useSettingValue('common.userApiAutoUpdate')

  return (
    <SubTitle title={t('setting_basic_source_setting')}>
      <View style={styles.list}>
        <CheckBox
          check={allowShowUpdateAlert}
          label={t('user_api_allow_show_update_alert')}
          onChange={(check) => { updateSetting({ 'common.userApiAllowShowUpdateAlert': check }) }}
          marginBottom={3}
          helpTitle={t('user_api_allow_show_update_alert')}
          helpDesc={t('setting_basic_source_update_alert_tip')}
        />
        <CheckBox
          check={autoUpdate}
          label={t('user_api_auto_update')}
          onChange={(check) => { updateSetting({ 'common.userApiAutoUpdate': check }) }}
          marginBottom={3}
          helpTitle={t('user_api_auto_update')}
          helpDesc={t('setting_basic_source_auto_update_tip')}
        />
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
})
