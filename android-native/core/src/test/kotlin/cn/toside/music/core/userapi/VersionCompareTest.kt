package cn.toside.music.core.userapi

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VersionCompareTest {
    @Test
    fun comparesDateLikeSegmentsNumerically() {
        assertEquals(-1, VersionCompare.compare("2026.10.18", "2026.10.20"))
        assertEquals(1, VersionCompare.compare("2026.10.20", "2026.10.18"))
        assertEquals(0, VersionCompare.compare("2026.10.20", "2026.10.20"))
    }

    @Test
    fun handlesVPrefixAndLeadingZeros() {
        assertEquals(-1, VersionCompare.compare("v1.0.3", "1.2.0"))
        assertEquals(0, VersionCompare.compare("v1.02", "1.2"))
        assertEquals(1, VersionCompare.compare("V2.0", "1.9.9"))
    }

    @Test
    fun acceptsHyphenAndUnderscoreSeparators() {
        assertEquals(1, VersionCompare.compare("2026-10-20", "2026.10.19"))
        assertEquals(0, VersionCompare.compare("2026_10_20", "2026-10-20"))
    }

    @Test
    fun padsMissingSegmentsWithZero() {
        assertEquals(0, VersionCompare.compare("1.2", "1.2.0"))
        assertEquals(-1, VersionCompare.compare("1.2", "1.2.1"))
        assertEquals(1, VersionCompare.compare("1.2.0.1", "1.2"))
    }

    @Test
    fun comparesPlainNumbers() {
        assertEquals(-1, VersionCompare.compare("20261019", "20261020"))
        assertEquals(-1, VersionCompare.compare("89", "90"))
    }

    @Test
    fun refusesToMixPlainAndSeparatedForms() {
        assertNull(VersionCompare.compare("20261020", "2026.10.21"))
        assertNull(VersionCompare.compare("1", "1.0"))
    }

    @Test
    fun returnsNullForUnrecognizedVersions() {
        assertNull(VersionCompare.compare("", "1.0.0"))
        assertNull(VersionCompare.compare("beta", "alpha"))
        assertNull(VersionCompare.compare("2026.10.20-beta", "2026.10.20"))
        assertNull(VersionCompare.compare("v1.0.0", "最新版"))
    }
}
