import { memo, useMemo } from 'react'

import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Text from '@/components/common/Text'
import CheckBox from '@/components/common/CheckBox'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useUserApiList } from '@/store/userApi'
import { updateSetting } from '@/core/common'
import { type UserApiUpdateCheckMode } from '@/core/userApiUpdate/schedule'

const setCheckMode = (mode: UserApiUpdateCheckMode) => {
  updateSetting({ 'common.userApiUpdateCheck': mode })
}

const Item = memo(({ mode, name }: {
  mode: UserApiUpdateCheckMode
  name: string
}) => {
  const checked = useSettingValue('common.userApiUpdateCheck') == mode
  return <CheckBox marginBottom={3} check={checked} label={name} onChange={() => { setCheckMode(mode) }} need />
})

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const userApiList = useUserApiList()
  const list = useMemo(() => {
    return [
      {
        mode: 'off',
        name: t('setting_basic_user_api_update_check_off'),
      },
      {
        mode: 'startup',
        name: t('setting_basic_user_api_update_check_startup'),
      },
      {
        mode: 'daily',
        name: t('setting_basic_user_api_update_check_daily'),
      },
      {
        mode: 'weekly',
        name: t('setting_basic_user_api_update_check_weekly'),
      },
    ] as const
  }, [t])

  if (!userApiList.length) return null

  return (
    <SubTitle title={t('setting_basic_user_api_update_check')}>
      <View style={styles.list}>
        {
          list.map(({ mode, name }) => <Item name={name} mode={mode} key={mode} />)
        }
      </View>
      <Text style={styles.tip} size={12} color={theme['c-font-label']}>{t('setting_basic_user_api_update_check_tip')}</Text>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tip: {
    marginTop: 6,
    lineHeight: 18,
  },
})
