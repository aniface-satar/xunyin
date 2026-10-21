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
 * 卡色跟着**应用主题**走：深色模式黑卡、浅色模式白卡（用户指定，2026-10-17）。
 * 不再按封面平均色的 HCT tone 自适应 —— 旧的 isLightCover/pickMusicCardTheme 与
 * share 卡那趟 getCoverAverageArgb 取色一起退役，就绪门也由三路并成两路（卡封面、整屏糊底）。
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

export const pickCardTheme = (isDark: boolean): CardTheme =>
  isDark ? DARK_CARD_THEME : LIGHT_CARD_THEME
