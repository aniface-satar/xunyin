export interface CardTheme {
  cardBackground: string
  titleColor: string
  subtitleColor: string
  lyricColor: string
  scrimColor: string
  /**
   * 封面图与卡底之间的那条细线（hairlineWidth）：黑卡画白线、白卡画黑线 ——
   * 封面深色时和黑底会糊成一块，用户要求用一条细线把封面的边界从卡底上分出来。
   */
  coverBorderColor: string
}

/**
 * 卡底的黑白档，由用户在预览页底部自己选（2026-10-29，用户指定）。
 * 它是一枚**产物参数**，不是界面配色：同一份布局、两套色，谁都不比谁高级。
 */
export type CardTone = 'light' | 'dark'

/**
 * 卡色由用户选（2026-10-29 用户指定：底部加「白底 / 黑底」，默认白底，**不再随应用深浅色变化**）。
 *
 * 三版判据，留在这里免得又被翻回去：
 * ① 初版按封面平均色的 HCT tone 自适应（白封面白卡 / 深封面黑卡）；
 * ② 2026-10-17 改成跟随应用深浅模式（深色模式黑卡、浅色模式白卡）—— 这一版把"卡色"绑在"界面肤色"上，
 *    于是深色模式的用户想发一张白卡只能去切主题；
 * ③ 现在：用户在预览页选，默认白底。分享图是产物、不是界面（spec §3 的同一条判据），
 *    所以它跟着用户的这一次选择走，既不读封面、也不读主题。
 *
 * 两套都是**不透明实底**：半透明的深卡（rgba(28,28,30,0.72)）在黑底上是看得见糊底的，实底黑卡才是"黑色"。
 * scrimColor 仍然只铺在糊底上（20% 黑），与卡色无关。
 * 纯常量、**零导入**：node --test 直接加载（tests/share-card-theme.mts 钉住这几条）。
 */
export const LIGHT_CARD_THEME: CardTheme = {
  cardBackground: '#FFFFFF',
  titleColor: '#1C1C1E',
  subtitleColor: '#8E8E93',
  lyricColor: '#1C1C1E',
  scrimColor: 'rgba(0,0,0,0.20)',
  coverBorderColor: '#000000',
}

export const DARK_CARD_THEME: CardTheme = {
  cardBackground: '#000000',
  titleColor: '#FFFFFF',
  subtitleColor: 'rgba(255,255,255,0.72)',
  lyricColor: '#FFFFFF',
  scrimColor: 'rgba(0,0,0,0.20)',
  coverBorderColor: '#FFFFFF',
}

export const pickCardTheme = (tone: CardTone): CardTheme =>
  tone === 'dark' ? DARK_CARD_THEME : LIGHT_CARD_THEME
