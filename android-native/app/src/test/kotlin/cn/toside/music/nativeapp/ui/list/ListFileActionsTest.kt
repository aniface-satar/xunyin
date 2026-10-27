package cn.toside.music.nativeapp.ui.list

import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.list.ListStore
import cn.toside.music.core.list.MusicSortId
import cn.toside.music.core.storage.StorageKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * W5-9 菜单统一的等值用例：共享表/纯函数与重构前两份内联实现逐条对齐。
 *
 * 重构前 `ListMenuActions.kt` 与 `ListDetailPage.kt` 各有一份九档排序表、
 * 一份「本地列表 id → 展示名」与一套导入分流；这里把三者的语义钉死，
 * 防止今后任一侧单独漂移。
 */
class ListFileActionsTest {
    @Test
    fun `sort options keep rn order and labels`() {
        assertEquals(
            listOf(
                "name",
                "album",
                "duration_up",
                "duration_down",
                "add_time_up",
                "add_time_down",
                "singer",
                "year",
                "play_count",
            ),
            LIST_SORT_OPTIONS.map { it.first },
        )
        assertEquals(
            listOf(
                "标题",
                "专辑（音轨）",
                "时长（短→长）",
                "时长（长→短）",
                "添加时间",
                "添加时间降序",
                "歌手",
                "年份",
                "播放次数",
            ),
            LIST_SORT_OPTIONS.map { it.second },
        )
    }

    @Test
    fun `sort options cover every rule exactly once`() {
        assertEquals(
            MusicSortId.entries.map { it.key }.toSet(),
            LIST_SORT_OPTIONS.map { it.first }.toSet(),
        )
        assertEquals(MusicSortId.entries.size, LIST_SORT_OPTIONS.size)
    }

    @Test
    fun `local list name resolves builtin and user lists`() {
        val userLists =
            listOf(
                ListStore.UserListInfo(id = "userlist_1", name = "我的歌单"),
                ListStore.UserListInfo(id = "userlist_2", name = "通勤"),
            )

        assertEquals("试听列表", localListNameOf(StorageKeys.ListIds.DEFAULT, userLists))
        assertEquals("我的收藏", localListNameOf(StorageKeys.ListIds.LOVE, userLists))
        assertEquals("我的歌单", localListNameOf("userlist_1", userLists))
        assertNull(localListNameOf("userlist_missing", userLists))
    }

    @Test
    fun `import decision mirrors the pre-refactor branching`() {
        val pending = PendingImportFile(bytes = ByteArray(0), plainJson = true)

        assertTrue(importDecision(null, pending) { null } is ImportDecision.ParseError)

        val part = BackupManager.BackupPreview(type = "playListPart", partId = "l1", partName = "导入名")
        val conflict = importDecision(part, pending) { local -> if (local == "l1") "本地名" else null }
        assertTrue(conflict is ImportDecision.Conflict)
        conflict as ImportDecision.Conflict
        assertEquals("导入名", conflict.info.importName)
        assertEquals("本地名", conflict.info.localName)

        val ready = importDecision(part, pending) { null }
        assertTrue(ready is ImportDecision.Ready)
        assertEquals(BackupManager.PartConflictMode.RENAME_COPY, (ready as ImportDecision.Ready).mode)

        // v2 单列表文件与 v1 同一条分流
        val partV2 = BackupManager.BackupPreview(type = "playListPart_v2", partId = "l2")
        assertTrue(importDecision(partV2, pending) { null } is ImportDecision.Ready)

        // 单列表文件缺 id 视为解析失败（RN 也无法落库）
        val noId = BackupManager.BackupPreview(type = "playListPart", partId = null)
        assertTrue(importDecision(noId, pending) { null } is ImportDecision.ParseError)

        // 非单列表类型一律走整表备份确认
        val full = BackupManager.BackupPreview(type = "playList_v2")
        assertTrue(importDecision(full, pending) { null } is ImportDecision.FullBackup)
    }
}
