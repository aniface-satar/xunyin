package cn.toside.music.nativeapp.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 旧版（RN）歌单自动迁移的解析语义。
 *
 * 这几条锁的是「覆盖升级后用户歌单必须原样出现」：键名取自 RN 的
 * `storageDataPrefix`（`@user_list` / `@list__<id>`），值可能因超 500 KB 被分片。
 */
class RnStorageMigrationTest {
    private fun parse(json: String): JsonArray = Json.parseToJsonElement(json).jsonObject["data"]!!.jsonArray

    private fun JsonArray.byId(id: String): JsonObject = first { it.jsonObject["id"]!!.jsonPrimitive.content == id }.jsonObject

    @Test
    fun buildsAllThreeListKinds() {
        val snapshot =
            mapOf(
                "@user_list" to """[{"id":"u1","name":"我的歌单"}]""",
                "@list__default" to """[{"name":"A"},{"name":"B"}]""",
                "@list__love" to """[{"name":"C"}]""",
                "@list__u1" to """[{"name":"D"},{"name":"E"},{"name":"F"}]""",
            )

        val lists = parse(RnStorageMigration.buildPlayListJson(snapshot)!!)

        assertEquals(3, lists.size)
        assertEquals(2, lists.byId("default")["list"]!!.jsonArray.size)
        assertEquals(1, lists.byId("love")["list"]!!.jsonArray.size)
        assertEquals(3, lists.byId("u1")["list"]!!.jsonArray.size)
        assertEquals("我的歌单", lists.byId("u1")["name"]!!.jsonPrimitive.content)
    }

    @Test
    fun keepsUserListSourceMeta() {
        val snapshot =
            mapOf(
                "@user_list" to
                    """[{"id":"u9","name":"收藏的专辑","source":"wy","sourceListId":"123","locationUpdateTime":1700}]""",
                "@list__u9" to """[{"name":"X"}]""",
            )

        val entry = parse(RnStorageMigration.buildPlayListJson(snapshot)!!).byId("u9")

        assertEquals("wy", entry["source"]!!.jsonPrimitive.content)
        assertEquals("123", entry["sourceListId"]!!.jsonPrimitive.content)
        assertEquals(1700L, entry["locationUpdateTime"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun resolvesChunkedValueInNewFormat() {
        val head = RnStorageMigration.PART_ARRAY_PREFIX + """["p0","p1"]"""
        val all = mapOf("k" to head, "p0" to """[{"name":"A"},""", "p1" to """{"name":"B"}]""")

        assertEquals("""[{"name":"A"},{"name":"B"}]""", RnStorageMigration.resolveValue(head, all))
    }

    @Test
    fun resolvesChunkedValueInLegacyFormat() {
        val head = RnStorageMigration.PART_OLD_PREFIX + "p0,p1"
        val all = mapOf("p0" to "[", "p1" to "]")

        assertEquals("[]", RnStorageMigration.resolveValue(head, all))
    }

    @Test
    fun chunkedMusicsStillProduceFullList() {
        // 千首歌单会走分片：迁移后曲目数必须一条不少
        val head = RnStorageMigration.PART_ARRAY_PREFIX + """["q0","q1"]"""
        val snapshot =
            mapOf(
                "@user_list" to "[]",
                "@list__default" to head,
                "q0" to """[{"name":"A"},{"name":"B"},""",
                "q1" to """{"name":"C"}]""",
            )

        val lists = parse(RnStorageMigration.buildPlayListJson(snapshot)!!)

        assertEquals(3, lists.byId("default")["list"]!!.jsonArray.size)
    }

    @Test
    fun missingUserListYieldsNull() {
        assertNull(RnStorageMigration.buildPlayListJson(mapOf("@list__default" to "[]")))
    }

    @Test
    fun missingMusicsBecomeEmptyList() {
        val lists = parse(RnStorageMigration.buildPlayListJson(mapOf("@user_list" to "[]"))!!)

        assertEquals(2, lists.size)
        assertEquals(0, lists.byId("default")["list"]!!.jsonArray.size)
        assertEquals(0, lists.byId("love")["list"]!!.jsonArray.size)
    }

    @Test
    fun blankValueIsTreatedAsEmpty() {
        val lists =
            parse(
                RnStorageMigration.buildPlayListJson(
                    mapOf("@user_list" to "[]", "@list__default" to ""),
                )!!,
            )

        assertEquals(0, lists.byId("default")["list"]!!.jsonArray.size)
    }
}
