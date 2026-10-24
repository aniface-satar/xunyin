package cn.toside.music.core.storage

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 存储分片编解码测试：对照 RN 侧 src/plugins/storage.ts 的行为。
 */
class PartStoreTest {
    @Test
    fun smallValueStoredUnderSingleKey() {
        val datas = PartStore.buildData("k", """{"a":1}""")
        assertEquals(1, datas.size)
        assertEquals("k" to """{"a":1}""", datas[0])
    }

    @Test
    fun largeValueSplitIntoParts() {
        val bigJson = buildString { repeat(600_000) { append('x') } } // 600k 字符 > 500k 限制
        val datas = PartStore.buildData("big", bigJson)
        // 1 个根键 + 2 个分片
        assertEquals(3, datas.size)
        val root = datas.first { it.first == "big" }
        assertTrue(root.second.startsWith(PartStore.PART_KEY_ARR_PREFIX))
        val partKeys = PartStore.partKeysOf(root.second)!!
        assertEquals(2, partKeys.size)
        assertEquals("@___PART_A___big0", partKeys[0])
        assertEquals("@___PART_A___big1", partKeys[1])

        val joined =
            PartStore.joinParts(
                listOf(
                    datas.first { it.first == partKeys[0] }.second,
                    datas.first { it.first == partKeys[1] }.second,
                ),
            )
        assertEquals(bigJson, joined)
    }

    @Test
    fun exactLimitNotSplit() {
        val exact = "x".repeat(500_000)
        val datas = PartStore.buildData("k", exact)
        assertEquals(1, datas.size)
    }

    @Test
    fun v2PartKeysParsed() {
        val value = """@___PART_A___["@___PART_A___@list__default0","@___PART_A___@list__default1"]"""
        val keys = PartStore.partKeysOf(value)
        assertEquals(listOf("@___PART_A___@list__default0", "@___PART_A___@list__default1"), keys)
    }

    @Test
    fun legacyV1KeysParsed() {
        val value = "@___PART___key1,key2,key3"
        val keys = PartStore.legacyPartKeysOf(value)
        assertEquals(listOf("key1", "key2", "key3"), keys)
    }

    @Test
    fun nonPartValueReturnsNull() {
        assertNull(PartStore.partKeysOf("""{"a":1}"""))
        assertNull(PartStore.legacyPartKeysOf("""{"a":1}"""))
    }
}

/**
 * gzip 编解码测试：lxmc 备份文件格式（gzip(JSON)）。
 */
class GzipCodecTest {
    @Test
    fun roundTripBytes() {
        val data = "寻音测试数据 hello world 中文 🎵".toByteArray(Charsets.UTF_8)
        val compressed = GzipCodec.gzip(data)
        // gzip 魔数 0x1f 0x8b
        assertEquals(0x1f, compressed[0].toInt() and 0xFF)
        assertEquals(0x8b, compressed[1].toInt() and 0xFF)
        assertArrayEquals(data, GzipCodec.gunzip(compressed))
    }

    @Test
    fun roundTripString() {
        val text = "{\"type\":\"playList_v2\",\"data\":[]}"
        val compressed = GzipCodec.gzipString(text)
        assertEquals(text, GzipCodec.gunzipString(compressed))
    }

    @Test
    fun largeJsonRoundTrip() {
        val text =
            buildString {
                append('[')
                append("\"").append("x".repeat(100)).append("\"")
                repeat(1000) { append(",\"item$it\"") }
                append(']')
            }
        assertEquals(text, GzipCodec.gunzipString(GzipCodec.gzipString(text)))
    }
}
