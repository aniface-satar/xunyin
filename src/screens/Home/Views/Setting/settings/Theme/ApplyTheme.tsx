import { memo, useCallback } from 'react'

import CheckBoxItem from '../../components/CheckBoxItem'
import SubTitle from '../../components/SubTitle'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { refreshTheme } from '@/core/theme'
import { setCustomBgEnabled } from '@/core/customBg'
import { setPlayerBgMode } from '@/core/playerBg'
import ThemeColor from './Theme'
import IsAutoTheme from './IsAutoTheme'
import CustomBg from './CustomBg'

/**
 * 「应用主题」这一级：铺底的是纯色还是自己的图片，二选一。
 *
 * 两个勾选项互斥（`need` 让已选中的那一个按下去没反应），因为一个界面只有一层底 ——
 * 同时开着时壁纸只是盖在主题色上面，用户看着像"纯色没生效"。所以这里直接把
 * `theme.customBg.enabled` 当成开关本身：勾上就是壁纸模式，勾回纯色就是主题色模式。
 */
export default memo(() => {
  const t = useI18n()
  const customBgEnabled = useSettingValue('theme.customBg.enabled')
  const dynamicBg = useSettingValue('theme.dynamicBg')
  const applyToPlayer = useSettingValue('theme.customBg.applyToPlayer')

  const chooseSolid = useCallback(() => {
    if (!customBgEnabled) return
    setCustomBgEnabled(false)
    // 播控页原本跟着这套图走：图撤了，那一档就没有落点，退回纯色档（两支都关）
    if (!dynamicBg && applyToPlayer) setPlayerBgMode('white')
    void refreshTheme()
  }, [customBgEnabled, dynamicBg, applyToPlayer])

  const chooseCustom = useCallback(() => {
    if (customBgEnabled) return
    setCustomBgEnabled(true)
    // 壁纸模式下播控页那档"纯白"不可选（白字压白底），所以切进壁纸时顺手把播控页挪到"跟随"
    if (!dynamicBg && !applyToPlayer) setPlayerBgMode('custom')
    void refreshTheme()
  }, [customBgEnabled, dynamicBg, applyToPlayer])

  return (
    <SubTitle title={t('setting_appearance_apply_theme')}>
      <CheckBoxItem
        need
        check={!customBgEnabled}
        label={t('setting_appearance_solid_bg')}
        onChange={chooseSolid}
      />
      {
        customBgEnabled
          ? null
          : (
              <>
                <ThemeColor />
                <IsAutoTheme />
              </>
            )
      }

      <CheckBoxItem
        need
        check={customBgEnabled}
        label={t('setting_basic_theme_custom_bg')}
        onChange={chooseCustom}
      />
      {customBgEnabled ? <CustomBg /> : null}
    </SubTitle>
  )
})
