package cn.toside.music.core.backup

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.list.ListStore
import cn.toside.music.core.storage.GzipCodec
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * BackupManager 测试：对照 RN Backup/actions.ts 的导入导出语义。
 * 这也是评估文档 §七 B1 验收标准——「数据导入（lxmc 备份文件）在原生壳里跑通」。
 */
class BackupManagerTest {
    private val json = Json

    private fun newSystem(): Triple<BackupManager, ListStore, InMemoryKvStore> {
        val backend = InMemoryKvStore()
        val repo = DataRepository(ShardedKvStore(backend))
        val listStore = ListStore(repo)
        return Triple(BackupManager(listStore), listStore, backend)
    }

    private fun music(
        id: String,
        name: String = id,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", "s")
            put("source", "kw")
            put("interval", "03:00")
            put(
                "meta",
                buildJsonObject {
                    put("songId", id)
                    put("albumName", "")
                },
            )
        }

    @Test
    fun exportImportRoundTrip() =
        runBlocking {
            val (bm1, ls1, _) = newSystem()
            ls1.userListCreate(ListStore.UserListInfo(id = "u1", name = "我的歌单", locationUpdateTime = 5L), -1)
            ls1.listMusicAdd("default", listOf(music("d1")), "bottom")
            ls1.listMusicAdd("love", listOf(music("l1")), "bottom")
            ls1.listMusicAdd("u1", listOf(music("n1"), music("n2")), "bottom")

            val bytes = bm1.exportAllLists()

            // 新实例导入
            val (bm2, ls2, _) = newSystem()
            val result = bm2.import(bytes)
            assertEquals(BackupManager.ImportResult.FullImported, result)
            assertEquals(listOf("d1"), ls2.getListMusics("default").map { it["id"]!!.primStr() })
            assertEquals(listOf("l1"), ls2.getListMusics("love").map { it["id"]!!.primStr() })
            assertEquals(1, ls2.state.value.userLists.size)
            assertEquals(listOf("n1", "n2"), ls2.getListMusics("u1").map { it["id"]!!.primStr() })
            assertEquals(
                "我的歌单",
                ls2.state.value.userLists[0]
                    .name,
            )
        }

    @Test
    fun importV2PlayList() =
        runBlocking {
            val (bm, ls, _) = newSystem()
            val backupJson =
                buildJsonObject {
                    put("type", "playList_v2")
                    put(
                        "data",
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("id", "default")
                                    put("name", "试听列表")
                                    put("list", buildJsonArray { add(music("a1")) })
                                },
                            )
                            add(
                                buildJsonObject {
                                    put("id", "love")
                                    put("name", "我的收藏")
                                    put("list", buildJsonArray { add(music("b1")) })
                                },
                            )
                            add(
                                buildJsonObject {
                                    put("id", "imported_list")
                                    put("name", "导入列表")
                                    put("list", buildJsonArray { add(music("c1")) })
                                },
                            )
                        },
                    )
                }
            val bytes =
                cn.toside.music.core.storage.GzipCodec
                    .gzip(backupJson.toString().toByteArray())
            val result = bm.import(bytes)
            assertEquals(BackupManager.ImportResult.FullImported, result)
            assertEquals(1, ls.state.value.userLists.size)
            assertEquals(
                "导入列表",
                ls.state.value.userLists[0]
                    .name,
            )
        }

    @Test
    fun importLegacyV1PlayListConverts() =
        runBlocking {
            val (bm, ls, _) = newSystem()
            // v1 旧格式：songmid/name/singer/source + kg hash
            val oldMusic =
                buildJsonObject {
                    put("songmid", "789")
                    put("name", "老歌")
                    put("singer", "老歌手")
                    put("source", "kg")
                    put("hash", "HASH123")
                    put("types", buildJsonArray { })
                    put("_types", buildJsonObject { })
                }
            val backupJson =
                buildJsonObject {
                    put("type", "playList")
                    put(
                        "data",
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("id", "default")
                                    put("name", "试听列表")
                                    put("list", buildJsonArray { add(oldMusic) })
                                },
                            )
                        },
                    )
                }
            val bytes =
                cn.toside.music.core.storage.GzipCodec
                    .gzip(backupJson.toString().toByteArray())
            val result = bm.import(bytes)
            assertEquals(BackupManager.ImportResult.FullImported, result)
            val musics = ls.getListMusics("default")
            assertEquals(1, musics.size)
            // toNewMusicInfo：kg 源 id = songmid_hash
            assertEquals("789_HASH123", musics[0]["id"]!!.primStr())
            assertEquals("老歌", musics[0]["name"]!!.primStr())
        }

    @Test
    fun importPartAppendsWithRenamedIdOnConflict() =
        runBlocking {
            val (bm, ls, _) = newSystem()
            ls.userListCreate(ListStore.UserListInfo(id = "dup", name = "已存在", locationUpdateTime = null), -1)

            val partJson =
                buildJsonObject {
                    put("type", "playListPart_v2")
                    put(
                        "data",
                        buildJsonObject {
                            put("id", "dup")
                            put("name", "同名新列表")
                            put("list", buildJsonArray { add(music("p1")) })
                        },
                    )
                }
            val result = bm.importJson(partJson.toString())
            assertTrue(result is BackupManager.ImportResult.PartImported)
            val part = result as BackupManager.ImportResult.PartImported
            // 冲突 id 被追加时间戳（RN 行为：listData.id += `__${Date.now()}`）
            assertTrue(part.listInfo.id.startsWith("dup__"))
            assertEquals(2, ls.state.value.userLists.size)
            assertEquals(listOf("p1"), ls.getListMusics(part.listInfo.id).map { it["id"]!!.primStr() })
        }

    @Test
    fun unsupportedTypeReported() =
        runBlocking {
            val (bm, _, _) = newSystem()
            val result = bm.importJson("""{"type":"something_new","data":[]}""")
            assertEquals(BackupManager.ImportResult.Unsupported("something_new"), result)
        }

    @Test
    fun corruptGzipIsParseError() =
        runBlocking {
            val (bm, _, _) = newSystem()
            val result = bm.import("这不是gzip数据".toByteArray())
            assertEquals(BackupManager.ImportResult.ParseError, result)
        }

    @Test
    fun flac32bitQualityFixedOnImport() =
        runBlocking {
            val (bm, ls, _) = newSystem()
            val flac32Music =
                buildJsonObject {
                    put("id", "wy_1")
                    put("name", "hi-res")
                    put("singer", "s")
                    put("source", "wy")
                    put("interval", "03:00")
                    put(
                        "meta",
                        buildJsonObject {
                            put("songId", "1")
                            put("albumName", "")
                            put(
                                "qualitys",
                                buildJsonArray {
                                    add(
                                        buildJsonObject {
                                            put("type", "flac32bit")
                                            put("size", "40M")
                                        },
                                    )
                                },
                            )
                            put("_qualitys", buildJsonObject { put("flac32bit", buildJsonObject { put("size", "40M") }) })
                        },
                    )
                }
            val backupJson =
                buildJsonObject {
                    put("type", "playListPart_v2")
                    put(
                        "data",
                        buildJsonObject {
                            put("id", "plist")
                            put("name", "音质修复")
                            put("list", buildJsonArray { add(flac32Music) })
                        },
                    )
                }
            val result = bm.importJson(backupJson.toString())
            assertTrue(result is BackupManager.ImportResult.PartImported)
            val musics = ls.getListMusics("plist")
            val meta = musics[0]["meta"]!!.jsonObject
            assertTrue(meta["_qualitys"]!!.jsonObject.containsKey("flac24bit"))
            assertTrue(!meta["_qualitys"]!!.jsonObject.containsKey("flac32bit"))
        }

    @Test
    fun exportSingleListRoundTrip() =
        runBlocking {
            val (bm1, ls1, _) = newSystem()
            ls1.userListCreate(
                ListStore.UserListInfo(
                    id = "u1",
                    name = "导出单",
                    source = "kw",
                    sourceListId = "2858093057",
                    locationUpdateTime = 5L,
                ),
                -1,
            )
            ls1.listMusicAdd("u1", listOf(music("m1"), music("m2")), "bottom")

            val bytes = bm1.exportSingleList("u1", "导出单")
            val preview = bm1.preview(bytes)!!
            assertEquals("playListPart_v2", preview.type)
            assertEquals("u1", preview.partId)
            assertEquals("导出单", preview.partName)

            val (bm2, ls2, _) = newSystem()
            val result = bm2.import(bytes)
            assertTrue(result is BackupManager.ImportResult.PartImported)
            val part = result as BackupManager.ImportResult.PartImported
            assertEquals("u1", part.listInfo.id)
            assertEquals("导出单", part.listInfo.name)
            assertEquals("kw", part.listInfo.source)
            assertEquals("2858093057", part.listInfo.sourceListId)
            assertEquals(listOf("m1", "m2"), ls2.getListMusics("u1").map { it["id"]!!.primStr() })
        }

    @Test
    fun partOverwriteModeKeepsLocalNameAndReplacesSongs() =
        runBlocking {
            val partBytes =
                gzipJson(
                    buildJsonObject {
                        put("type", "playListPart_v2")
                        put(
                            "data",
                            buildJsonObject {
                                put("id", "u1")
                                put("name", "文件里的名字")
                                put("source", "kg")
                                put("sourceListId", "abc")
                                put(
                                    "list",
                                    buildJsonArray {
                                        add(music("n1"))
                                        add(music("n2"))
                                    },
                                )
                            },
                        )
                    },
                )

            val (bm, ls, _) = newSystem()
            ls.userListCreate(ListStore.UserListInfo(id = "u1", name = "本地名"), -1)
            ls.listMusicAdd("u1", listOf(music("old")), "bottom")

            val result = bm.import(partBytes, BackupManager.PartConflictMode.OVERWRITE)
            assertTrue(result is BackupManager.ImportResult.PartImported)
            // RN handleImportListPart 覆盖分支：listData.name = targetList.name 后 overwriteList
            val state = ls.state.value
            val localInfo = state.userLists.single()
            assertEquals("本地名", localInfo.name)
            assertEquals("kg", localInfo.source)
            assertEquals("abc", localInfo.sourceListId)
            assertEquals(listOf("n1", "n2"), ls.getListMusics("u1").map { it["id"]!!.primStr() })
        }

    @Test
    fun partOverwriteModeReplacesBuiltinList() =
        runBlocking {
            val partBytes =
                gzipJson(
                    buildJsonObject {
                        put("type", "playListPart_v2")
                        put(
                            "data",
                            buildJsonObject {
                                put("id", "default")
                                put("name", "试听列表")
                                put("list", buildJsonArray { add(music("a1")) })
                            },
                        )
                    },
                )

            val (bm, ls, _) = newSystem()
            ls.listMusicAdd("default", listOf(music("d1"), music("d2")), "bottom")
            val result = bm.import(partBytes, BackupManager.PartConflictMode.OVERWRITE)
            assertTrue(result is BackupManager.ImportResult.PartImported)
            assertEquals(listOf("a1"), ls.getListMusics("default").map { it["id"]!!.primStr() })
            assertEquals(0, ls.state.value.userLists.size)
        }

    @Test
    fun partRenameCopyOfBuiltinCreatesUserList() =
        runBlocking {
            // RN：冲突时取消覆盖 → id 追加时间戳后 createList，内置列表本身不动
            val partBytes =
                gzipJson(
                    buildJsonObject {
                        put("type", "playListPart_v2")
                        put(
                            "data",
                            buildJsonObject {
                                put("id", "default")
                                put("name", "试听列表")
                                put("list", buildJsonArray { add(music("copy1")) })
                            },
                        )
                    },
                )

            val (bm, ls, _) = newSystem()
            ls.listMusicAdd("default", listOf(music("keep")), "bottom")
            val result = bm.import(partBytes)
            assertTrue(result is BackupManager.ImportResult.PartImported)
            val state = ls.state.value
            val listInfo = state.userLists.single()
            assertTrue(listInfo.id.startsWith("default__"))
            assertEquals("试听列表", listInfo.name)
            assertEquals(listOf("copy1"), ls.getListMusics(listInfo.id).map { it["id"]!!.primStr() })
            assertEquals(listOf("keep"), ls.getListMusics("default").map { it["id"]!!.primStr() })
        }

    @Test
    fun previewReportsFullBackupWithoutPartFields() =
        runBlocking {
            val (bm, _, _) = newSystem()
            val bytes =
                gzipJson(
                    buildJsonObject {
                        put("type", "playList_v2")
                        put("data", buildJsonArray { })
                    },
                )
            val preview = bm.preview(bytes)!!
            assertEquals("playList_v2", preview.type)
            assertEquals(null, preview.partId)
            assertEquals(null, preview.partName)
        }

    private fun gzipJson(root: JsonObject): ByteArray = GzipCodec.gzip(root.toString().toByteArray())

    private fun kotlinx.serialization.json.JsonElement.primStr(): String = (this as kotlinx.serialization.json.JsonPrimitive).content
}
