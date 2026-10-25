package cn.toside.music.nativeapp.ui.songlist

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 多选批量加入的纯规则测试（S12）：目标列表已有 + 本批次内重复都跳过，
 * 保留选中顺序，缺 id 的条目计入跳过。
 */
class AddToMylistTest {
    private fun music(id: String?): JsonObject =
        buildJsonObject {
            if (id != null) put("id", id)
            put("name", id ?: "no-id")
        }

    @Test
    fun `skips songs already in the target list and intra batch duplicates`() {
        val plan =
            AddToMylist.plan(
                existing = listOf(music("1"), music("2")),
                selected = listOf(music("2"), music("3"), music("3"), music("4")),
            )
        assertEquals(listOf("3", "4"), plan.toAdd.map { it["id"]!!.toString().trim('"') })
        assertEquals(2, plan.skipped)
    }

    @Test
    fun `all duplicates produces empty add list`() {
        val plan =
            AddToMylist.plan(
                existing = listOf(music("1")),
                selected = listOf(music("1")),
            )
        assertTrue(plan.toAdd.isEmpty())
        assertEquals(1, plan.skipped)
    }

    @Test
    fun `empty selection is a no-op`() {
        val plan = AddToMylist.plan(existing = listOf(music("1")), selected = emptyList())
        assertTrue(plan.toAdd.isEmpty())
        assertEquals(0, plan.skipped)
    }

    @Test
    fun `items without id count as skipped`() {
        val plan =
            AddToMylist.plan(
                existing = emptyList(),
                selected = listOf(music(null), music("9")),
            )
        assertEquals(listOf("9"), plan.toAdd.map { it["id"]!!.toString().trim('"') })
        assertEquals(1, plan.skipped)
    }
}
