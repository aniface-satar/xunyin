package cn.toside.music.core.storage

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ShardedKvStore 测试：对照 RN src/plugins/storage.ts 行为
 * （含分片写入/读取/删除/兼容旧分片格式）。
 */
class ShardedKvStoreTest {
    private fun store(): ShardedKvStore = ShardedKvStore(InMemoryKvStore())

    @Test
    fun savesAndReadsPlainValue() =
        runBlocking {
            val kv = store()
            kv.saveString("k", "v")
            assertEquals("v", kv.getString("k"))
        }

    @Test
    fun savesAndReadsJsonObject() =
        runBlocking {
            val kv = store()
            val obj = buildJsonObject { put("theme.id", "cyan") }
            kv.saveData("setting", obj)
            assertEquals(obj, kv.getData<JsonObject>("setting"))
        }

    @Test
    fun largeValueTransparentlySharded() =
        runBlocking {
            val kv = store()
            // 构造超 500k 的 JSON 数组
            val bigArray =
                buildJsonArray {
                    repeat(100_000) { add(JsonPrimitive("item$it")) }
                }
            kv.saveData("big", bigArray)
            // 单键读回完整值（透明拼接）
            val read = kv.getData<JsonArray>("big")
            assertEquals(bigArray, read)
        }

    @Test
    fun removeDeletesParts() =
        runBlocking {
            val kv = store()
            val bigArray = buildJsonArray { repeat(100_000) { add(JsonPrimitive("x")) } }
            kv.saveData("big", bigArray)
            kv.removeData("big")
            assertNull(kv.getData("big"))
        }

    @Test
    fun overwriteRemovesOldParts() =
        runBlocking {
            val backend = InMemoryKvStore()
            val kv = ShardedKvStore(backend)
            // 每项 ~200 字符 × 5000 项 = 1M 字符 > 500k 限制 → 分片
            val bigArray = buildJsonArray { repeat(5000) { add(JsonPrimitive("x".repeat(200))) } }
            kv.saveData("big", bigArray)
            assertTrue(backend.snapshot().size >= 3) // 根键 + 至少 2 个分片
            kv.saveData("big", JsonPrimitive("small"))
            assertEquals(1, backend.snapshot().size) // 旧分片全部清掉
            assertEquals("small", kv.getString("big"))
        }

    @Test
    fun readsLegacyPartArrayFormat() =
        runBlocking {
            val backend = InMemoryKvStore()
            // RN v1.4.0+ 格式：根键 → @___PART_A___["分片键",...]
            backend.setString("big", """@___PART_A___["@___PART_A___big0"]""")
            backend.setString("@___PART_A___big0", """["legacy","joined"]""")
            val kv = ShardedKvStore(backend)
            val read = kv.getData<JsonArray>("big")
            assertEquals("legacy", (read!!.jsonArray[0] as JsonPrimitive).content)
            assertEquals("joined", (read.jsonArray[1] as JsonPrimitive).content)
        }

    @Test
    fun readsLegacyV1CommaFormat() =
        runBlocking {
            val backend = InMemoryKvStore()
            // RN v1.4.0 前格式：根键 → @___PART___key1,key2（分片是裸 JSON 片段拼接）
            backend.setString("old", "@___PART___old1,old2")
            backend.setString("old1", """["a",""")
            backend.setString("old2", """"b"]""")
            val kv = ShardedKvStore(backend)
            val read = kv.getData<JsonArray>("old")
            assertEquals("a", (read!!.jsonArray[0] as JsonPrimitive).content)
            assertEquals("b", (read.jsonArray[1] as JsonPrimitive).content)
        }

    @Test
    fun saveOverDataMultipleThenRead() =
        runBlocking {
            val kv = store()
            kv.saveString("a", "1")
            kv.saveString("b", "2")
            kv.removeDataMultiple(listOf("a", "b"))
            assertNull(kv.getString("a"))
            assertNull(kv.getString("b"))
        }
}
