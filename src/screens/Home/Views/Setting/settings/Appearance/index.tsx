import { memo } from 'react'

import Section from '../../components/Section'
import Theme from '../Theme'
import Language from '../Basic/Language'
import FontSize from '../Basic/FontSize'
import SourceName from '../Basic/SourceName'
import { useI18n } from '@/lang/i18n'

export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_appearance')}>
      <Theme />
      <Language />
      <FontSize />
      <SourceName />
    </Section>
  )
})
