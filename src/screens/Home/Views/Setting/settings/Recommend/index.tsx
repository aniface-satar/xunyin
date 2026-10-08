import { useEffect, useState } from 'react'
import { View } from 'react-native'

import Text from '@/components/common/Text'
import Section from '../../components/Section'
import { useTheme } from '@/store/theme/hook'
import { useI18n } from '@/lang'
import { recommendationEngine } from '@/core/recommend'
import type { OnboardingOptionId } from '@/core/recommend/onboarding'
import { refreshRecommendFeed } from '@/screens/Home/Views/Recommend/feed'
import PreferenceSections from '@/screens/Home/Views/Recommend/PreferenceSliders'
import { createStyle } from '@/utils/tools'

/** 设置页的"推荐偏好"子页：无提交/跳过按钮，滑条改动防抖后自动落盘。 */
export default () => {
  const theme = useTheme()
  const t = useI18n()
  const [weights, setWeights] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    void recommendationEngine.getOnboardingView().then(view => {
      setWeights(view.weights)
    })
  }, [])

  const handleChange = (id: OnboardingOptionId, percent: number) => {
    setWeights(current => {
      const next = { ...current }
      if (percent > 0) next[id] = percent
      else delete next[id]
      return next
    })
  }

  useEffect(() => {
    if (weights == null) return
    const timer = setTimeout(() => {
      void recommendationEngine.submitOnboarding(weights).then(ok => {
        if (ok) void refreshRecommendFeed(true)
      })
    }, 400)
    return () => {
      clearTimeout(timer)
    }
  }, [weights])

  return (
    <Section title={t('setting_recommend')}>
      <View style={styles.body}>
        <Text size={13} color={theme['c-font-label']} style={styles.desc}>
          {t('setting_recommend_desc')}
        </Text>
        {
          weights ? <PreferenceSections weights={weights} onChange={handleChange} /> : null
        }
      </View>
    </Section>
  )
}

const styles = createStyle({
  body: { paddingHorizontal: 14, paddingTop: 16 },
  desc: { marginBottom: 16 },
})
