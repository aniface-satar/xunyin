import { useMemo, useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'

import Text from '@/components/common/Text'
import Button from '@/components/common/Button'
import Dialog, { type DialogType } from '@/components/common/Dialog'
import { useTheme } from '@/store/theme/hook'
import { BorderRadius } from '@/theme'
import { useI18n } from '@/lang'
import { recommendationEngine } from '@/core/recommend'
import type { OnboardingOptionId } from '@/core/recommend/onboarding'
import { createStyle } from '@/utils/tools'
import PreferenceSections from './PreferenceSliders'

interface Props {
  initialWeights: Record<string, number>
  onCompleted: () => void
}

/** 首次进入推荐 tab 的问卷：带"开始推荐"与"先跳过"，提交后弹一次提示再交给上层切回信息流。 */
const Onboarding = ({ initialWeights, onCompleted }: Props) => {
  const theme = useTheme()
  const t = useI18n()
  const [weights, setWeights] = useState<Record<string, number>>(initialWeights)
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<DialogType>(null)
  const hasSelection = useMemo(() => Object.values(weights).some(percent => percent > 0), [weights])

  const handleChange = (id: OnboardingOptionId, percent: number) => {
    setWeights(current => {
      const next = { ...current }
      if (percent > 0) next[id] = percent
      else delete next[id]
      return next
    })
  }

  const submit = async(target: Record<string, number>) => {
    if (submitting) return
    setSubmitting(true)
    // 提交失败要能重试：submitting 必须无条件复位，否则提交与跳过按钮一起卡死
    try {
      const ok = await recommendationEngine.submitOnboarding(target)
      if (ok) dialogRef.current?.setVisible(true)
    } catch (err) {
      console.log(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleKnow = () => {
    dialogRef.current?.setVisible(false)
    onCompleted()
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text size={13} color={theme['c-font-label']} style={styles.greeting}>
          {t('recommend_onboarding_greeting')}
        </Text>
        <PreferenceSections weights={weights} onChange={handleChange} />
        <Button
          style={[styles.submit, { backgroundColor: theme['c-button-background'] }]}
          disabled={!hasSelection || submitting}
          onPress={() => { void submit(weights) }}
        >
          <Text size={14} color={theme['c-button-font']}>{t('recommend_onboarding_submit')}</Text>
        </Button>
        <Button style={styles.skip} onPress={() => { void submit({}) }}>
          <Text size={13} color={theme['c-font-label']}>{t('recommend_onboarding_skip')}</Text>
        </Button>
      </ScrollView>
      <Dialog ref={dialogRef} title={t('recommend_onboarding_tip_title')} closeBtn={false} bgHide={false} keyHide={false}>
        <View style={styles.tipBody}>
          <Text size={14} color={theme['c-font']} style={styles.tipText}>{t('recommend_onboarding_tip_text')}</Text>
          <Button style={{ ...styles.tipBtn, backgroundColor: theme['c-button-background'] }} onPress={handleKnow}>
            <Text size={14} color={theme['c-button-font']}>{t('recommend_onboarding_tip_ok')}</Text>
          </Button>
        </View>
      </Dialog>
    </>
  )
}

const styles = createStyle({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 40, alignItems: 'stretch' },
  greeting: { marginBottom: 18 },
  submit: { borderRadius: BorderRadius.normal, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  skip: { alignSelf: 'center', marginTop: 12, paddingVertical: 6 },
  tipBody: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 18 },
  tipText: { lineHeight: 22 },
  tipBtn: { marginTop: 18, borderRadius: 4, paddingVertical: 10, alignItems: 'center' },
})

export default Onboarding
