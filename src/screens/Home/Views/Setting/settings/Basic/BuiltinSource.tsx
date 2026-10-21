import { memo, useRef } from 'react'

import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import UserApiEditModal, { type UserApiEditModalType } from './UserApiEditModal'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const modalRef = useRef<UserApiEditModalType>(null)

  return (
    <SubTitle title={t('setting_basic_builtin_source')}>
      <View style={styles.btn}>
        <Button onPress={() => { modalRef.current?.show() }}>{t('setting_basic_builtin_source_btn')}</Button>
      </View>
      <UserApiEditModal ref={modalRef} scope="builtin" />
    </SubTitle>
  )
})

const styles = createStyle({
  btn: {
    flexDirection: 'row',
  },
})
