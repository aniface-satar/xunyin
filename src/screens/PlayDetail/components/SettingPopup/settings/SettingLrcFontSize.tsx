import { useState } from 'react'

import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'


const LrcFontSize = ({ compact = false, direction }: {
  compact?: boolean
  direction: 'horizontal' | 'vertical'
}) => {
  const theme = useTheme()
  const settingKey = direction == 'horizontal' ? 'playDetail.horizontal.style.lrcFontSize' : 'playDetail.vertical.style.lrcFontSize'
  const lrcFontSize = useSettingValue(settingKey)
  const [sliderSize, setSliderSize] = useState(lrcFontSize)
  const [isSliding, setSliding] = useState(false)
  const t = useI18n()

  const handleSlidingStart: SliderProps['onSlidingStart'] = value => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    setSliderSize(value)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    if (lrcFontSize == value) return
    updateSetting({ [settingKey]: value })
  }

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {
        compact
          ? (
            <View style={[styles.content, styles.compactRow]}>
              <Text style={styles.compactTitle}>{t('play_detail_setting_lrc_font_size')}</Text>
              <Text style={styles.label} color={theme['c-font-label']}>{isSliding ? sliderSize : lrcFontSize}</Text>
              <Slider
                minimumValue={100}
                maximumValue={300}
                onSlidingComplete={handleSlidingComplete}
                onValueChange={handleValueChange}
                onSlidingStart={handleSlidingStart}
                step={2}
                value={lrcFontSize}
              />
            </View>
            )
          : (
            <>
              <Text>{t('play_detail_setting_lrc_font_size')}</Text>
              <View style={styles.content}>
                <Text style={styles.label} color={theme['c-font-label']}>{isSliding ? sliderSize : lrcFontSize}</Text>
                <Slider
                  minimumValue={100}
                  maximumValue={300}
                  onSlidingComplete={handleSlidingComplete}
                  onValueChange={handleValueChange}
                  onSlidingStart={handleSlidingStart}
                  step={2}
                  value={lrcFontSize}
                />
              </View>
            </>
            )
      }
    </View>
  )
}

export default LrcFontSize
