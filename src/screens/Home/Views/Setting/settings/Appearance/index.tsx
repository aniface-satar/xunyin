import { memo } from 'react'

import Section from '../../components/Section'
import SubTitle from '../../components/SubTitle'
import ApplyTheme from '../Theme/ApplyTheme'
import PlayerBg from '../Theme/PlayerBg'
import IsHideBgDark from '../Theme/IsHideBgDark'
import IsFontShadow from '../Theme/IsFontShadow'
import Language from '../Basic/Language'
import FontSize from '../Basic/FontSize'
import SourceName from '../Basic/SourceName'
import { useI18n } from '@/lang/i18n'

/**
 * 外观设置的层级：
 *
 *   应用主题 ──┬─ 纯色背景（勾上才展开：主题颜色 / 跟随系统亮暗）
 *              └─ 自定义图片背景（勾上才展开：图片列表 / 柔光 / 模糊）
 *   播控页背景 ─┬─ 纯白色
 *              ├─ 动态背景（勾上才展开：莫奈取色 / 封面模糊）
 *              └─ 跟随自定义背景
 *   其它 ─────── 隐藏黑色主题背景 / 字体阴影 / 语言 / 字体大小 / 歌曲来源名称
 *
 * 两级分组之间刻意拉开缩进与字号（SubTitle 的 level），否则"某个选项下面的子项"
 * 和"另一个平级分组"在长列表里分不出来。
 */
export default memo(() => {
  const t = useI18n()

  return (
    <Section title={t('setting_appearance')}>
      <ApplyTheme />
      <PlayerBg />

      <SubTitle title={t('setting_appearance_other')}>
        <IsHideBgDark />
        <IsFontShadow />
        <Language />
        <FontSize />
        <SourceName />
      </SubTitle>
    </Section>
  )
})
