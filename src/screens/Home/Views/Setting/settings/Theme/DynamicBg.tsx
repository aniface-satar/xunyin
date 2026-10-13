import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { clearCoverPaletteCache } from '@/utils/monet'

export default memo(() => {
  const t = useI18n()
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const setDynamicBg = (dynamicBg: boolean) => {
    updateSetting({ 'theme.dynamicBg': dynamicBg })
    // Task 5 会把取色失败的封面按 url 缓存到会话结束（那是它第 4 条用例钉住的行为），
    // 而 clearCoverPaletteCache 在全计划里原本没有任何调用方 —— 翻开关就是用户唯一够得到的重试出口：
    // 关掉再打开，慢网/瞬时失败的封面会重新取色，而不是永远灰着。
    clearCoverPaletteCache()
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={dynamicBg} label={t('setting_basic_theme_dynamic_bg')} onChange={setDynamicBg} />
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
})
