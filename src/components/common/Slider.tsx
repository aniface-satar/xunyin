import { memo } from 'react'

import Slider, { type SliderProps as _SliderProps } from '@react-native-community/slider'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'

export type SliderProps = Pick<_SliderProps,
'value'
| 'minimumValue'
| 'maximumValue'
| 'onSlidingStart'
| 'onSlidingComplete'
| 'onValueChange'
| 'step'
> & Partial<Pick<_SliderProps, 'thumbTintColor' | 'minimumTrackTintColor' | 'maximumTrackTintColor'>>

export default memo(({ value, minimumValue, maximumValue, onSlidingStart, onSlidingComplete, onValueChange, step, thumbTintColor, minimumTrackTintColor, maximumTrackTintColor }: SliderProps) => {
  const theme = useTheme()

  const handleValueChange = (value: number) => {
    // 修复当value小于等于minimumValue时，首次调用会传入0的问题
    if (onValueChange && minimumValue != null) onValueChange(Math.max(value, minimumValue))
  }

  return (
    <Slider
      value={value}
      style={styles.slider}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      // 默认跟主题走（c-primary 系）；特殊页面（如壁纸编辑页）可传入固定色盖掉 ——
      // 那边的主题色正是正在编辑的变量，滑杆若跟主题走会随选色变化
      minimumTrackTintColor={minimumTrackTintColor ?? theme['c-primary-alpha-500']}
      maximumTrackTintColor={maximumTrackTintColor ?? theme['c-primary-alpha-500']}
      thumbTintColor={thumbTintColor ?? theme['c-primary']}
      onSlidingStart={onSlidingStart}
      onSlidingComplete={onSlidingComplete}
      onValueChange={handleValueChange}
      step={step}
    />
  )
})


const styles = createStyle({
  slider: {
    flexShrink: 0,
    flexGrow: 1,
    // width: '100%',
    // maxWidth: 300,
    height: 40,
    // backgroundColor: '#eee',
  },
})
