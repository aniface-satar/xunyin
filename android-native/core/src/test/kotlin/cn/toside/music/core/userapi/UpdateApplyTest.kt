package cn.toside.music.core.userapi

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 对照 RN `tests/user-api-update-apply.mts` 的存储侧用例。 */
class UpdateApplyTest {
    private val name = "落雪云更新音源(实测)"

    private fun header(
        headerName: String,
        version: String,
    ): String = "/**\n * @name $headerName\n * @version $version\n */\nuserApi.register.action(() => {})\n"

    private val old = header(name, "2026.10.18")
    private val new = header(name, "2026.10.20")

    private class MemoryStore(
        var script: String,
        var backup: String? = null,
    ) : UserApiScriptStore {
        val ops = mutableListOf<String>()

        override suspend fun readScript(id: String): String = script

        override suspend fun writeScript(
            id: String,
            script: String,
            header: ScriptHeaderInfo?,
        ) {
            ops.add("write:$script")
            this.script = script
        }

        override suspend fun writeBackup(
            id: String,
            script: String,
        ) {
            ops.add("backup:$script")
            backup = script
        }

        override suspend fun readBackup(id: String): String? = backup
    }

    private fun apply(
        store: MemoryStore,
        script: String,
        keepBackup: Boolean = false,
        allowDowngrade: Boolean = false,
    ): ApplyUpdateResult =
        runBlocking {
            UpdateExecutor.applyUpdateScript(
                store = store,
                id = "builtin_test",
                name = name,
                script = script,
                keepBackup = keepBackup,
                allowDowngrade = allowDowngrade,
            )
        }

    @Test
    fun normalUpdateBacksUpBeforeWriting() {
        val store = MemoryStore(old)
        val result = apply(store, new)
        assertTrue(result is ApplyUpdateResult.Updated)
        result as ApplyUpdateResult.Updated
        assertEquals("2026.10.18", result.fromVersion)
        assertEquals("2026.10.20", result.toVersion)
        assertEquals(listOf("backup:$old", "write:$new"), store.ops)
    }

    @Test
    fun identicalScriptWritesNothing() {
        val store = MemoryStore(new)
        assertEquals(ApplyUpdateResult.Unchanged, apply(store, new))
        assertEquals(emptyList<String>(), store.ops)
    }

    @Test
    fun olderVersionWritesNothing() {
        val store = MemoryStore(new)
        val result = apply(store, old)
        assertTrue(result is ApplyUpdateResult.Older)
        assertEquals(emptyList<String>(), store.ops)
    }

    @Test
    fun downgradeAfterUserConfirmationStillBacksUp() {
        val store = MemoryStore(new)
        val result = apply(store, old, allowDowngrade = true)
        assertTrue(result is ApplyUpdateResult.Updated)
        assertEquals(listOf("backup:$new", "write:$old"), store.ops)
    }

    @Test
    fun unverifiedScriptKeepsEarlierBackup() {
        val store = MemoryStore(old, backup = "earlier")
        apply(store, new, keepBackup = true)
        assertEquals(listOf("write:$new"), store.ops)
        assertEquals("earlier", store.backup)
    }

    @Test
    fun invalidScriptIsRejectedWithoutWriting() {
        val store = MemoryStore(old)
        val result = apply(store, "<html>404</html>")
        assertTrue(result is ApplyUpdateResult.Rejected)
        result as ApplyUpdateResult.Rejected
        assertEquals(UpdateRejectReason.INVALID_SCRIPT, result.reason)
        assertEquals(emptyList<String>(), store.ops)
    }

    @Test
    fun rollbackRestoresBackupEvenWithoutHeader() {
        val store = MemoryStore(new, backup = "// 没有头部的旧脚本")
        assertTrue(runBlocking { UpdateExecutor.rollbackScript(store, "builtin_test") })
        assertEquals(listOf("write:// 没有头部的旧脚本"), store.ops)
        assertEquals("// 没有头部的旧脚本", store.script)
        assertNull(ScriptResolver.parseScriptHeader(store.script))
    }

    @Test
    fun rollbackWithoutBackupFailsWithoutWriting() {
        val store = MemoryStore(new)
        assertFalse(runBlocking { UpdateExecutor.rollbackScript(store, "builtin_test") })
        assertEquals(emptyList<String>(), store.ops)
    }
}
