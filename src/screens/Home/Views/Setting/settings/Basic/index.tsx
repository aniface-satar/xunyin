import { memo } from 'react'

import Section from '../../components/Section'
import Source from './Source'
import ShareType from './ShareType'
import SourceSetting from './SourceSetting'
import BuiltinSource from './BuiltinSource'
import UserApiUpdateCheck from './UserApiUpdateCheck'
import IsStartupAutoPlay from './IsStartupAutoPlay'
import IsStartupPushPlayDetailScreen from './IsStartupPushPlayDetailScreen'
import IsUseSystemFileSelector from './IsUseSystemFileSelector'
import IsAlwaysKeepStatusbarHeight from './IsAlwaysKeepStatusbarHeight'
import { useI18n } from '@/lang/i18n'

export default memo(() => {
  const t = useI18n()


  return (
    <Section title={t('setting_basic')}>
      <IsStartupAutoPlay />
      <IsStartupPushPlayDetailScreen />
      <IsUseSystemFileSelector />
      <IsAlwaysKeepStatusbarHeight />
      <ShareType />
      <SourceSetting />
      <BuiltinSource />
      <Source />
      <UserApiUpdateCheck />
    </Section>
  )
})
