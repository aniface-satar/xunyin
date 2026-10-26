package cn.toside.music.nativeapp.ui.list

import cn.toside.music.core.local.LocalImportProgress
import cn.toside.music.nativeapp.data.LocalMusicRuntime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 本地导入弹层文案：对照 RN `zh-cn.json#list_select_local_file_*` 四条。
 *
 * 文案本身是 UI 层的常量，但它是「用户唯一能看到的导入结果」，改错了没人会发现，
 * 所以按纯函数锁住。
 */
class LocalFileImportDialogTextTest {
    private fun outcome(
        total: Int,
        added: Int,
        failed: Int,
        cancelled: Boolean = false,
    ) = LocalMusicRuntime.Outcome(total = total, added = added, failed = failed, cancelled = cancelled)

    @Test
    fun `empty directory uses rn empty tip`() {
        assertEquals("没有在当前文件夹中发现歌曲", localImportResultText(outcome(0, 0, 0)))
    }

    @Test
    fun `all success uses rn result tip`() {
        assertEquals("共发现 12 首歌曲，已全部添加！", localImportResultText(outcome(12, 12, 0)))
    }

    @Test
    fun `partial failure reports both counts`() {
        val text = localImportResultText(outcome(12, 9, 3))
        assertTrue(text.contains("共发现 12 首歌曲"))
        assertTrue(text.contains("成功添加 9 首"))
        assertTrue(text.contains("失败 3 首"))
    }

    @Test
    fun `cancelled import reports progress made`() {
        val text = localImportResultText(outcome(12, 4, 0, cancelled = true))
        assertTrue(text.contains("已取消"))
        assertTrue(text.contains("已添加 4 首"))
    }

    @Test
    fun `scanning state has no counts yet`() {
        assertEquals("正在扫描所选目录…", localImportProgressText(null))
        assertEquals("正在扫描所选目录…", localImportProgressText(LocalImportProgress()))
    }

    @Test
    fun `reading progress shows processed over total and failures`() {
        val text = localImportProgressText(LocalImportProgress(total = 20, added = 20, processed = 10, failed = 2))
        assertTrue(text.contains("共找到 20 个符合要求的文件"))
        assertTrue(text.contains("10/20"))
        assertTrue(text.contains("失败 2"))
    }

    @Test
    fun `reading progress without failures hides failure segment`() {
        val text = localImportProgressText(LocalImportProgress(total = 20, added = 20, processed = 10))
        assertTrue(!text.contains("失败"))
    }

    // ---------- 重定位（Wave6 Lane C） ----------

    private fun relinkOutcome(
        stale: Int,
        matched: Int,
        unmatched: Int = 0,
        ambiguous: Int = 0,
        noPermission: Boolean = false,
    ) = LocalMusicRuntime.RelinkOutcome(
        stale = stale,
        matched = matched,
        unmatched = unmatched,
        ambiguous = ambiguous,
        noPermission = noPermission,
    )

    @Test
    fun `relink button shows stale count`() {
        assertEquals("重新定位失效曲目（7）", relinkButtonText(7))
    }

    @Test
    fun `relink result reports restored and kept counts`() {
        val text = relinkResultText(relinkOutcome(stale = 5, matched = 3, unmatched = 1, ambiguous = 1))
        assertTrue(text.contains("共 5 首失效"))
        assertTrue(text.contains("恢复 3 首"))
        assertTrue(text.contains("未找到 1 首"))
        assertTrue(text.contains("歧义 1 首"))
        assertTrue(text.contains("未被删除"))
    }

    @Test
    fun `relink result without misses only reports restored`() {
        val text = relinkResultText(relinkOutcome(stale = 2, matched = 2))
        assertTrue(!text.contains("未找到"))
        assertTrue(!text.contains("歧义"))
    }

    @Test
    fun `relink without permission tells user to reimport`() {
        val text = relinkResultText(relinkOutcome(stale = 3, matched = 0, noPermission = true))
        assertTrue(text.contains("没有可用的文件夹授权"))
    }

    @Test
    fun `relink with no stale tracks is a no-op message`() {
        assertEquals("列表里没有失效曲目", relinkResultText(relinkOutcome(stale = 0, matched = 0)))
    }
}
