package cn.toside.music.core.music

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MusicInfoTools 测试：对照 RN 侧 src/utils/index.ts 的行为。
 */
class MusicInfoToolsTest {
    private val json = Json

    private fun obj(block: kotlinx.serialization.json.JsonObjectBuilder.() -> Unit): JsonObject = buildJsonObject(block)

    @Test
    fun sanitizeFillsMissingFields() {
        val raw =
            obj {
                put("id", "kw_123")
                put("name", "测试歌曲")
            }
        val s = MusicInfoTools.sanitizeMusicInfo(raw)
        assertEquals("kw_123", s["id"]!!.jsonPrim().content)
        assertEquals("", s["singer"]!!.jsonPrim().content)
        assertEquals("kw", s["source"]!!.jsonPrim().content)
        val meta = s["meta"] as JsonObject
        assertEquals("kw_123", meta["songId"]!!.jsonPrim().content)
        assertEquals("", meta["albumName"]!!.jsonPrim().content)
        // 非 local：qualitys/_qualitys 兜底
        assertTrue(meta["qualitys"] is JsonArray)
        assertTrue(meta["_qualitys"] is JsonObject)
    }

    @Test
    fun sanitizeLocalSourceWithFilePathFallback() {
        // 无 meta 的边缘场景：RN 行为是 filePath = songId = info.id（含 local_ 前缀）
        val raw =
            obj {
                put("id", "local_/storage/a.mp3")
                put("name", "本地歌")
                put("source", "local")
            }
        val s = MusicInfoTools.sanitizeMusicInfo(raw)
        val meta = s["meta"] as JsonObject
        assertEquals("local_/storage/a.mp3", meta["filePath"]!!.jsonPrim().content)
        // ext 从 filePath 尾缀提取：local_/storage/a.mp3 → mp3
        assertEquals("mp3", meta["ext"]!!.jsonPrim().content)
    }

    @Test
    fun sanitizeLocalSourceWithSongIdKeepsPath() {
        // 真实 local 数据：meta.songId 即文件路径
        val raw =
            obj {
                put("id", "local_/storage/a.mp3")
                put("name", "本地歌")
                put("source", "local")
                put(
                    "meta",
                    obj {
                        put("songId", "/storage/a.mp3")
                        put("filePath", "/storage/a.mp3")
                        put("ext", "mp3")
                    },
                )
            }
        val s = MusicInfoTools.sanitizeMusicInfo(raw)
        val meta = s["meta"] as JsonObject
        assertEquals("/storage/a.mp3", meta["filePath"]!!.jsonPrim().content)
        assertEquals("mp3", meta["ext"]!!.jsonPrim().content)
    }

    @Test
    fun sanitizeInfersLocalFromMetaFilePath() {
        val raw =
            obj {
                put("id", "x")
                put("name", "n")
                put("meta", obj { put("filePath", "/music/song.flac") })
            }
        val s = MusicInfoTools.sanitizeMusicInfo(raw)
        assertEquals("local", s["source"]!!.jsonPrim().content)
        val meta = s["meta"] as JsonObject
        assertEquals("flac", meta["ext"]!!.jsonPrim().content)
    }

    @Test
    fun fixQualityMigratesFlac32bitTo24bit() {
        val raw =
            obj {
                put("id", "wy_1")
                put("name", "n")
                put("singer", "s")
                put("source", "wy")
                put(
                    "meta",
                    obj {
                        put("songId", "1")
                        put(
                            "qualitys",
                            buildJsonArray {
                                add(
                                    obj {
                                        put("type", "flac32bit")
                                        put("size", "40M")
                                    },
                                )
                                add(
                                    obj {
                                        put("type", "128k")
                                        put("size", "3M")
                                    },
                                )
                            },
                        )
                        put("_qualitys", obj { put("flac32bit", obj { put("size", "40M") }) })
                    },
                )
            }
        val fixed = MusicInfoTools.fixNewMusicInfoQuality(raw)
        val meta = fixed["meta"] as JsonObject
        val qMap = meta["_qualitys"] as JsonObject
        assertNull(qMap["flac32bit"])
        assertNotNull(qMap["flac24bit"])
        val qualitys = meta["qualitys"] as JsonArray
        assertEquals("flac24bit", (qualitys[0] as JsonObject)["type"]!!.jsonPrim().content)
        assertEquals("128k", (qualitys[1] as JsonObject)["type"]!!.jsonPrim().content)
    }

    @Test
    fun fixQualityKeepsLocalUntouched() {
        val raw =
            obj {
                put("id", "local_a")
                put("name", "n")
                put("source", "local")
            }
        val fixed = MusicInfoTools.fixNewMusicInfoQuality(raw)
        val meta = fixed["meta"] as JsonObject
        assertNull(meta["qualitys"])
    }

    @Test
    fun filterMusicListDedupesAndDropsInvalid() {
        val list =
            listOf(
                obj {
                    put("id", "kw_1")
                    put("name", "a")
                    put("singer", "s")
                },
                obj {
                    put("id", "kw_1")
                    put("name", "a-dup")
                    put("singer", "s")
                }, // 重复 id
                obj { put("name", "no-id") }, // 缺 id
                obj {
                    put("id", "kw_2")
                    put("singer", "s")
                }, // 缺 name
                obj {
                    put("id", "kw_3")
                    put("name", "c")
                }, // 缺 singer → 兜底 ""
                kotlinx.serialization.json.JsonNull, // null 项
            )
        val filtered = MusicInfoTools.filterMusicList(list)
        assertEquals(2, filtered.size)
        assertEquals("kw_1", filtered[0]["id"]!!.jsonPrim().content)
        assertEquals("", filtered[1]["singer"]!!.jsonPrim().content)
    }

    @Test
    fun toNewMusicInfoBuildsV2FromV1Kw() {
        val old =
            obj {
                put("songmid", "12345")
                put("name", "歌名")
                put("singer", "歌手")
                put("source", "kw")
                put("interval", "03:55")
                put("albumName", "专辑")
                put("img", "http://pic")
                put(
                    "types",
                    buildJsonArray {
                        add(
                            obj {
                                put("type", "128k")
                                put("size", "3M")
                            },
                        )
                    },
                )
                put("_types", obj { })
                put("albumId", "A1")
            }
        val new = MusicInfoTools.toNewMusicInfo(old)!!
        assertEquals("kw_12345", new["id"]!!.jsonPrim().content)
        assertEquals("歌名", new["name"]!!.jsonPrim().content)
        assertEquals("kw", new["source"]!!.jsonPrim().content)
        val meta = new["meta"] as JsonObject
        assertEquals("12345", meta["songId"]!!.jsonPrim().content)
        assertEquals("专辑", meta["albumName"]!!.jsonPrim().content)
        assertEquals("http://pic", meta["picUrl"]!!.jsonPrim().content)
        assertEquals("A1", meta["albumId"]!!.jsonPrim().content)
        assertTrue(meta["qualitys"] is JsonArray)
    }

    @Test
    fun toNewMusicInfoKgIdIncludesHash() {
        val old =
            obj {
                put("songmid", "6789")
                put("name", "n")
                put("singer", "s")
                put("source", "kg")
                put("hash", "ABCDEF")
            }
        val new = MusicInfoTools.toNewMusicInfo(old)!!
        assertEquals("6789_ABCDEF", new["id"]!!.jsonPrim().content)
        val meta = new["meta"] as JsonObject
        assertEquals("ABCDEF", meta["hash"]!!.jsonPrim().content)
    }

    @Test
    fun toNewMusicInfoLocalKeepsFilePath() {
        val old =
            obj {
                put("songmid", "/sdcard/x.flac")
                put("name", "n")
                put("singer", "s")
                put("source", "local")
                put("filePath", "/sdcard/x.flac")
            }
        val new = MusicInfoTools.toNewMusicInfo(old)!!
        val meta = new["meta"] as JsonObject
        assertEquals("/sdcard/x.flac", meta["filePath"]!!.jsonPrim().content)
        assertEquals("flac", meta["ext"]!!.jsonPrim().content)
    }

    private fun kotlinx.serialization.json.JsonElement.jsonPrim() = this as kotlinx.serialization.json.JsonPrimitive
}
