package cn.toside.music.nativeapp.ui.list

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ListBatchTest {
    private fun song(id: String): JsonObject = buildJsonObject { put("id", JsonPrimitive(id)) }

    @Test
    fun `collect keeps order and adds every distinct track`() {
        val plan = ListBatch.planCollect(existing = emptyList(), items = listOf(song("a"), song("b"), song("c")))
        assertEquals(listOf("a", "b", "c"), plan.toAdd.map { (it["id"] as JsonPrimitive).content })
        assertEquals(0, plan.skipped)
    }

    @Test
    fun `collect skips tracks already in target and duplicates inside batch`() {
        val plan =
            ListBatch.planCollect(
                existing = listOf(song("a")),
                items = listOf(song("b"), song("a"), song("b"), song("c")),
            )
        assertEquals(listOf("b", "c"), plan.toAdd.map { (it["id"] as JsonPrimitive).content })
        assertEquals(2, plan.skipped)
    }

    @Test
    fun `collect counts missing or empty ids as skipped`() {
        val noId = buildJsonObject { put("name", JsonPrimitive("无名")) }
        val blankId = buildJsonObject { put("id", JsonPrimitive("")) }
        val plan = ListBatch.planCollect(existing = emptyList(), items = listOf(noId, blankId, song("a")))
        assertEquals(1, plan.toAdd.size)
        assertEquals(2, plan.skipped)
    }

    @Test
    fun `collect with empty source writes nothing`() {
        val plan = ListBatch.planCollect(existing = listOf(song("a")), items = emptyList())
        assertTrue(plan.toAdd.isEmpty())
        assertEquals(0, plan.skipped)
    }

    @Test
    fun `collect where everything already exists produces an empty write set`() {
        val plan = ListBatch.planCollect(existing = listOf(song("a"), song("b")), items = listOf(song("a"), song("b")))
        assertTrue(plan.toAdd.isEmpty())
        assertEquals(2, plan.skipped)
    }
}
