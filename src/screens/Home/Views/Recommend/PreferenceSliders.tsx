import { View } from 'react-native'

import Text from '@/components/common/Text'
import Slider from '@/components/common/Slider'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { ONBOARDING_OPTIONS, type OnboardingOptionId } from '@/core/recommend/onboarding'
import { createStyle } from '@/utils/tools'

const PreferenceRow = ({ id, percent, onChange }: {
  id: OnboardingOptionId
  percent: number
  onChange: (id: OnboardingOptionId, value: number) => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  return (
    <View style={styles.row}>
      <Text size={13} numberOfLines={1} color={theme['c-font']} style={styles.optionName}>
        {t(`recommend_onboarding_opt_${id}`)}
      </Text>
      <View style={styles.sliderWrap}>
        <Slider
          minimumValue={0}
          maximumValue={100}
          step={10}
          value={percent}
          onValueChange={value => { onChange(id, Math.round(value / 10) * 10) }}
        />
      </View>
      <Text size={12} color={theme['c-font-label']} style={styles.percent}>{percent}%</Text>
    </View>
  )
}

/** 语言 + 风格两节滑条，供首次问卷与设置页共用；本身不含滚动容器与提交按钮。 */
const PreferenceSections = ({ weights, onChange }: {
  weights: Record<string, number>
  onChange: (id: OnboardingOptionId, percent: number) => void
}) => {
  const theme = useTheme()
  const t = useI18n()
  const renderQuestion = (question: 'language' | 'genre') => (
    <View style={styles.section}>
      <Text size={15} color={theme['c-font']} style={styles.questionTitle}>
        {t(question == 'language' ? 'recommend_onboarding_q_language' : 'recommend_onboarding_q_genre')}
      </Text>
      {ONBOARDING_OPTIONS.filter(option => option.question == question).map(option => (
        <PreferenceRow
          key={option.id}
          id={option.id}
          percent={weights[option.id] ?? 0}
          onChange={onChange}
        />
      ))}
    </View>
  )
  return (
    <>
      {renderQuestion('language')}
      {renderQuestion('genre')}
    </>
  )
}

const styles = createStyle({
  section: { marginBottom: 24 },
  questionTitle: { marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  optionName: { width: 96 },
  sliderWrap: { flex: 1, marginHorizontal: 8 },
  percent: { width: 44, textAlign: 'right' },
})

export default PreferenceSections
