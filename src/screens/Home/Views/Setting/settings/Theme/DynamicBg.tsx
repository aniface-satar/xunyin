import { memo } from 'react'
import { View } from 'react-native'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import CheckBox from '@/components/common/CheckBox'
import { createStyle } from '@/utils/tools'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { clearCoverPaletteCache } from '@/utils/monet'
import { normalizeCoverAlgo } from '@/utils/monet/coverPalette'
import { resetCoverBackdrop } from '@/utils/monet/coverBackdropStore'

type Algorithm = LX.AppSetting['theme.dynamicBgAlgorithm']

// 取色层（缓存 + "问过没有"的账）和已发布的那一份背景层是两套记忆，只清一套就会错位：
// 留下 store 那份，切完算法播放页还在铺旧色；留下缓存那份，切完算法根本不重新问原生。
const republishBackdrop = () => {
  clearCoverPaletteCache()
  resetCoverBackdrop()
}

export default memo(() => {
  const t = useI18n()
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const algorithm = normalizeCoverAlgo(useSettingValue('theme.dynamicBgAlgorithm'))
  const setDynamicBg = (dynamicBg: boolean) => {
    updateSetting({ 'theme.dynamicBg': dynamicBg })
    // 取色失败现在只压一个保质期（NEGATIVE_TTL_MS），过了会自己重新问原生；翻开关不是唯一的出口，
    // 而是"不等窗口、立刻重试"那条手动出口：关掉再打开会把像素层、配色层和"问过没有"的账一起清掉，
    // 慢网/瞬时失败的封面当场就能重取，而不是永远灰着。
    republishBackdrop()
  }
  const setAlgorithm = (algorithm: Algorithm) => {
    updateSetting({ 'theme.dynamicBgAlgorithm': algorithm })
    republishBackdrop()
  }

  return (
    <View style={styles.content}>
      <CheckBoxItem check={dynamicBg} label={t('setting_basic_theme_dynamic_bg')} onChange={setDynamicBg} />
      {
        dynamicBg
          ? (
              <SubTitle title={t('setting_basic_theme_dynamic_bg_algorithm')}>
                <View style={styles.list}>
                  <CheckBox marginBottom={3} check={algorithm == 'monet'} label={t('setting_basic_theme_dynamic_bg_algorithm_monet')} onChange={() => { setAlgorithm('monet') }} need />
                  <CheckBox marginBottom={3} check={algorithm == 'blur'} label={t('setting_basic_theme_dynamic_bg_algorithm_blur')} onChange={() => { setAlgorithm('blur') }} need />
                </View>
              </SubTitle>
            )
          : null
      }
    </View>
  )
})

const styles = createStyle({
  content: {
    marginTop: 5,
  },
  list: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
