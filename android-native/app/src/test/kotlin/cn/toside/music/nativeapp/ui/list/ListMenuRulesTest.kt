package cn.toside.music.nativeapp.ui.list

import cn.toside.music.core.storage.StorageKeys
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 首页长按菜单的可用性规则（对照 RN `MyList/ListMenu.tsx#handleSetMenu`）。
 *
 * RN 原文：`rename/remove` 只在非 default/love 时可用；`sync` 还要 `userList.source`
 * 且有 `songList` 能力；`local_file` 与 `sync` 都受 `fetchingListStatus` 影响。
 */
class ListMenuRulesTest {
    private fun entries(state: ListMenuState): Map<ListMenuAction, Boolean> =
        ListMenuRules.entries(state).associate { it.action to it.enabled }

    @Test
    fun `menu keeps rn order with nine entries`() {
        val actions = ListMenuRules.entries(ListMenuState(StorageKeys.ListIds.DEFAULT, isUserList = false)).map { it.action }
        assertEquals(
            listOf(
                ListMenuAction.CREATE,
                ListMenuAction.RENAME,
                ListMenuAction.SORT,
                ListMenuAction.DUPLICATE,
                ListMenuAction.LOCAL_FILE,
                ListMenuAction.SYNC,
                ListMenuAction.IMPORT,
                ListMenuAction.EXPORT,
                ListMenuAction.REMOVE,
            ),
            actions,
        )
    }

    @Test
    fun `default and love lists cannot be renamed or removed`() {
        listOf(StorageKeys.ListIds.DEFAULT, StorageKeys.ListIds.LOVE).forEach { id ->
            val enabled = entries(ListMenuState(id, isUserList = false, localFileReady = true))
            assertFalse(enabled.getValue(ListMenuAction.RENAME))
            assertFalse(enabled.getValue(ListMenuAction.REMOVE))
            // 其余动作不受列表身份影响
            assertTrue(enabled.getValue(ListMenuAction.SORT))
            assertTrue(enabled.getValue(ListMenuAction.DUPLICATE))
            assertTrue(enabled.getValue(ListMenuAction.LOCAL_FILE))
            assertTrue(enabled.getValue(ListMenuAction.IMPORT))
            assertTrue(enabled.getValue(ListMenuAction.EXPORT))
        }
    }

    @Test
    fun `user list can rename and remove`() {
        val enabled = entries(ListMenuState("userlist_1", isUserList = true, source = "kw"))
        assertTrue(enabled.getValue(ListMenuAction.RENAME))
        assertTrue(enabled.getValue(ListMenuAction.REMOVE))
    }

    @Test
    fun `local file item stays disabled until lane b is wired`() {
        val enabled = entries(ListMenuState("userlist_1", isUserList = true, localFileReady = false))
        assertFalse(enabled.getValue(ListMenuAction.LOCAL_FILE))
        val wired = entries(ListMenuState("userlist_1", isUserList = true, localFileReady = true))
        assertTrue(wired.getValue(ListMenuAction.LOCAL_FILE))
    }

    @Test
    fun `importing disables local file and sync`() {
        val enabled =
            entries(
                ListMenuState(
                    "userlist_1",
                    isUserList = true,
                    source = "kw",
                    importing = true,
                    localFileReady = true,
                    syncSupported = true,
                ),
            )
        assertFalse(enabled.getValue(ListMenuAction.LOCAL_FILE))
        assertFalse(enabled.getValue(ListMenuAction.SYNC))
        // 导入本身不禁用（RN 也只禁这两项）
        assertTrue(enabled.getValue(ListMenuAction.IMPORT))
    }

    @Test
    fun `sync needs user list source and implementation`() {
        assertFalse(entries(ListMenuState(StorageKeys.ListIds.DEFAULT, isUserList = false)).getValue(ListMenuAction.SYNC))
        assertFalse(
            entries(ListMenuState("userlist_1", isUserList = true, source = "kw"))
                .getValue(ListMenuAction.SYNC),
        )
        assertFalse(
            entries(
                ListMenuState(
                    "userlist_1",
                    isUserList = true,
                    source = null,
                    syncSupported = true,
                ),
            ).getValue(ListMenuAction.SYNC),
        )
        assertTrue(
            entries(
                ListMenuState(
                    "userlist_1",
                    isUserList = true,
                    source = "kw",
                    syncSupported = true,
                ),
            ).getValue(ListMenuAction.SYNC),
        )
    }

    @Test
    fun `syncable source follows rn user list source check`() {
        assertTrue(ListMenuRules.hasSyncableSource(isUserList = true, source = "kw"))
        assertFalse(ListMenuRules.hasSyncableSource(isUserList = false, source = "kw"))
        assertFalse(ListMenuRules.hasSyncableSource(isUserList = true, source = null))
        assertFalse(ListMenuRules.hasSyncableSource(isUserList = true, source = ""))
    }
}
