package cn.toside.music.core.share

import org.junit.Assert.assertEquals
import org.junit.Test

/** 黄金值对照 RN `tests/share-card-theme.mts`。 */
class CardThemeTest {
    @Test
    fun darkModeGivesTheBlackCard() {
        assertEquals(DARK_CARD_THEME, pickCardTheme(true))
        assertEquals(0xFF000000.toInt(), DARK_CARD_THEME.cardBackground)
        assertEquals(0xFFFFFFFF.toInt(), DARK_CARD_THEME.titleColor)
    }

    @Test
    fun lightModeGivesTheWhiteCard() {
        assertEquals(LIGHT_CARD_THEME, pickCardTheme(false))
        assertEquals(0xFFFFFFFF.toInt(), LIGHT_CARD_THEME.cardBackground)
        assertEquals(0xFF1C1C1E.toInt(), LIGHT_CARD_THEME.titleColor)
    }

    @Test
    fun bothCardsAreOpaqueSolids() {
        for (theme in listOf(DARK_CARD_THEME, LIGHT_CARD_THEME)) {
            assertEquals(0xFF, theme.cardBackground ushr 24)
        }
    }

    @Test
    fun coverBoundaryFollowsTheCardPolarity() {
        assertEquals(0xFFFFFFFF.toInt(), DARK_CARD_THEME.coverBorderColor)
        assertEquals(0xFF000000.toInt(), LIGHT_CARD_THEME.coverBorderColor)
    }

    @Test
    fun scrimIsTheSameTwentyPercentBlackOnBothCards() {
        assertEquals(0x33000000, DARK_CARD_THEME.scrimColor)
        assertEquals(0x33000000, LIGHT_CARD_THEME.scrimColor)
    }

    @Test
    fun darkSubtitleKeepsTheSeventyTwoPercentWhite() {
        // rgba(255,255,255,0.72) → alpha 184
        assertEquals(0xB8FFFFFF.toInt(), DARK_CARD_THEME.subtitleColor)
        assertEquals(0xFF8E8E93.toInt(), LIGHT_CARD_THEME.subtitleColor)
    }
}
