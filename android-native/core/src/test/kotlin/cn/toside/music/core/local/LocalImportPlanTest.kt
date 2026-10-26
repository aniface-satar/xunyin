package cn.toside.music.core.local

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 导入分批与进度算术：对照 RN `listAction.ts` 的 10 条/批、批内并发 5、1 秒节流。
 */
class LocalImportPlanTest {
    @Test
    fun `batches are ten at a time and keep order`() {
        val paths = (1..25).map { "p$it" }
        val batches = LocalImportPlan.batches(paths)
        assertEquals(3, batches.size)
        assertEquals(10, batches[0].size)
        assertEquals("p1", batches[0].first())
        assertEquals("p10", batches[0].last())
        assertEquals(5, batches[2].size)
        assertEquals("p21", batches[2].first())
        assertEquals("p25", batches[2].last())
        assertEquals(paths, batches.flatten())
    }

    @Test
    fun `empty input yields no batches`() {
        assertTrue(LocalImportPlan.batches(emptyList()).isEmpty())
    }

    @Test
    fun `exact multiple does not append an empty batch`() {
        val batches = LocalImportPlan.batches((1..20).map { "p$it" })
        assertEquals(2, batches.size)
        assertEquals(10, batches[1].size)
    }

    @Test
    fun `chunk size must be positive`() {
        runCatching { LocalImportPlan.chunks(listOf("a"), 0) }
            .also { assertTrue(it.isFailure) }
    }

    @Test
    fun `progress ratio and running flag`() {
        val progress = LocalImportProgress(total = 10, added = 10)
        assertEquals(0f, progress.ratio, 0.0001f)
        assertTrue(progress.running)
        val halfway = progress.advance(count = 5, failedCount = 1)
        assertEquals(0.5f, halfway.ratio, 0.0001f)
        assertEquals(4, halfway.success)
        val done = halfway.advance(count = 5, failedCount = 0)
        assertFalse(done.running)
        assertEquals(1f, done.ratio, 0.0001f)
        assertEquals(9, done.success)
    }

    @Test
    fun `progress never exceeds total`() {
        val progress = LocalImportProgress(total = 3).advance(count = 10, failedCount = 2)
        assertEquals(3, progress.processed)
        assertEquals(1f, progress.ratio, 0.0001f)
        assertEquals(1, progress.success)
    }

    @Test
    fun `zero total does not divide by zero`() {
        assertEquals(0f, LocalImportProgress().ratio, 0.0001f)
        assertFalse(LocalImportProgress().running)
    }
}
