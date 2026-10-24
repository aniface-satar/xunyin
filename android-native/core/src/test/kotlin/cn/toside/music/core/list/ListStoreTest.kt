package cn.toside.music.core.list

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ListStore 测试：对照 RN src/utils/listManage.ts 的操作语义。
 */
class ListStoreTest {
    private fun newStore(): Pair<ListStore, InMemoryKvStore> {
        val backend = InMemoryKvStore()
        val store = ListStore(DataRepository(ShardedKvStore(backend)))
        return store to backend
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
    fun userListCreateAndPersist() =
        runBlocking {
            val (store, backend) = newStore()
            store.userListCreate(ListStore.UserListInfo(id = "userlist_1", name = "我的歌单", locationUpdateTime = null), position = -1)
            store.userListCreate(ListStore.UserListInfo(id = "userlist_2", name = "第二个", locationUpdateTime = null), position = -1)
            assertEquals(2, store.state.value.userLists.size)
            // 持久层有元信息
            val persisted = DataRepository(ShardedKvStore(backend)).getUserLists()
            assertEquals(2, persisted.size)
            assertEquals("userlist_1", persisted[0]["id"]!!.jsonPrimitiveStr())
        }

    @Test
    fun duplicateUserListCreateIsNoop() =
        runBlocking {
            val (store, _) = newStore()
            store.userListCreate(ListStore.UserListInfo(id = "a", name = "a", locationUpdateTime = null), -1)
            store.userListCreate(ListStore.UserListInfo(id = "a", name = "dup", locationUpdateTime = null), -1)
            assertEquals(1, store.state.value.userLists.size)
            assertEquals(
                "a",
                store.state.value.userLists[0]
                    .name,
            )
        }

    @Test
    fun listMusicAddTopAndDedupe() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("love", listOf(music("1"), music("2"), music("1")), "top")
            val musics = store.getListMusics("love")
            // 去重：第 3 个（重复 id）被滤掉；top 插入整批保持批内顺序 → [1, 2]
            assertEquals(2, musics.size)
            assertEquals("1", musics[0]["id"]!!.jsonPrimitiveStr())
            assertEquals("2", musics[1]["id"]!!.jsonPrimitiveStr())
            // 再 top 加一批，新批在前
            store.listMusicAdd("love", listOf(music("3")), "top")
            assertEquals("3", store.getListMusics("love")[0]["id"]!!.jsonPrimitiveStr())
        }

    @Test
    fun listMusicAddBottomDefault() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("default", listOf(music("1")), "bottom")
            store.listMusicAdd("default", listOf(music("2")), "bottom")
            val musics = store.getListMusics("default")
            assertEquals(listOf("1", "2"), musics.map { it["id"]!!.jsonPrimitiveStr() })
        }

    @Test
    fun listMusicRemoveAndMove() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("love", listOf(music("1"), music("2"), music("3")), "bottom")
            store.listMusicMove("love", "default", listOf(music("2")), "bottom")
            assertEquals(listOf("1", "3"), store.getListMusics("love").map { it["id"]!!.jsonPrimitiveStr() })
            assertEquals(listOf("2"), store.getListMusics("default").map { it["id"]!!.jsonPrimitiveStr() })
        }

    @Test
    fun listMusicUpdatePosition() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("love", listOf(music("1"), music("2"), music("3"), music("4")), "bottom")
            // 把 3、4 移到开头
            store.listMusicUpdatePosition("love", 0, listOf("3", "4"))
            assertEquals(
                listOf("3", "4", "1", "2"),
                store.getListMusics("love").map { it["id"]!!.jsonPrimitiveStr() },
            )
        }

    @Test
    fun listMusicUpdateInfo() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("love", listOf(music("1", name = "旧名")), "bottom")
            val updated =
                buildJsonObject {
                    put("id", "1")
                    put("name", "新名")
                    put("singer", "新歌手")
                    put("source", "kw")
                    put("interval", "04:00")
                    put(
                        "meta",
                        buildJsonObject {
                            put("songId", "1")
                            put("albumName", "新专辑")
                        },
                    )
                }
            store.listMusicUpdateInfo(listOf("love" to updated))
            val musics = store.getListMusics("love")
            assertEquals("新名", musics[0]["name"]!!.jsonPrimitiveStr())
            assertEquals("新歌手", musics[0]["singer"]!!.jsonPrimitiveStr())
        }

    @Test
    fun listMusicClear() =
        runBlocking {
            val (store, _) = newStore()
            store.listMusicAdd("love", listOf(music("1")), "bottom")
            val changed = store.listMusicClear(listOf("love", "default"))
            assertEquals(listOf("love"), changed) // default 为空不报变更
            assertTrue(store.getListMusics("love").isEmpty())
        }

    @Test
    fun listDataOverwriteReplacesEverything() =
        runBlocking {
            val (store, backend) = newStore()
            // 预置旧数据
            store.userListCreate(ListStore.UserListInfo(id = "old_list", name = "旧列表", locationUpdateTime = null), -1)
            store.listMusicAdd("old_list", listOf(music("x9")), "bottom")

            // 覆盖导入（备份导入主入口）
            val updated =
                store.listDataOverwrite(
                    defaultList = listOf(music("d1")),
                    loveList = listOf(music("l1"), music("l2")),
                    userList =
                        listOf(
                            ListStore.UserListInfo(id = "new_list", name = "新列表", locationUpdateTime = 123L) to listOf(music("n1")),
                        ),
                )
            assertTrue(updated.contains("love"))
            assertEquals(1, store.state.value.userLists.size)
            assertEquals(
                "new_list",
                store.state.value.userLists[0]
                    .id,
            )

            // 从持久层重载验证写穿
            val repo = DataRepository(ShardedKvStore(backend))
            assertEquals(listOf("d1"), repo.getListMusics("default").map { (it as JsonObject)["id"]!!.jsonPrimitiveStr() })
            assertEquals(listOf("l1", "l2"), repo.getListMusics("love").map { (it as JsonObject)["id"]!!.jsonPrimitiveStr() })
            assertEquals(listOf("n1"), repo.getListMusics("new_list").map { (it as JsonObject)["id"]!!.jsonPrimitiveStr() })
        }

    @Test
    fun userListsUpdatePosition() =
        runBlocking {
            val (store, _) = newStore()
            store.userListCreate(ListStore.UserListInfo(id = "a", name = "a", locationUpdateTime = null), -1)
            store.userListCreate(ListStore.UserListInfo(id = "b", name = "b", locationUpdateTime = null), -1)
            store.userListCreate(ListStore.UserListInfo(id = "c", name = "c", locationUpdateTime = null), -1)
            // 把 c 移到最前
            store.userListsUpdatePosition(0, listOf("c"))
            assertEquals(
                listOf("c", "a", "b"),
                store.state.value.userLists
                    .map { it.id },
            )
            assertTrue(
                store.state.value.userLists[0]
                    .locationUpdateTime != null,
            )
        }

    @Test
    fun userListsRemoveDropsMusics() =
        runBlocking {
            val (store, _) = newStore()
            store.userListCreate(ListStore.UserListInfo(id = "gone", name = "gone", locationUpdateTime = null), -1)
            store.listMusicAdd("gone", listOf(music("1")), "bottom")
            val changed = store.userListsRemove(listOf("gone"))
            assertEquals(listOf("gone"), changed)
            assertTrue(
                store.state.value.userLists
                    .isEmpty(),
            )
        }

    @Test
    fun persistenceRoundTripAcrossStoreInstances() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val s1 = ListStore(repo)
            s1.userListCreate(ListStore.UserListInfo(id = "u1", name = "歌单", locationUpdateTime = null), -1)
            s1.listMusicAdd("u1", listOf(music("m1"), music("m2")), "bottom")

            // 新实例（模拟进程重启）从持久层恢复
            val s2 = ListStore(repo)
            s2.loadUserLists()
            assertEquals(1, s2.state.value.userLists.size)
            assertEquals(listOf("m1", "m2"), s2.getListMusics("u1").map { it["id"]!!.jsonPrimitiveStr() })
        }

    @Test
    fun normalizeListNameTrimsAndCaps() {
        val (store, _) = newStore()
        assertEquals("我的歌单", store.normalizeListName("  我的歌单 \n"))
        assertEquals(ListStore.MAX_LIST_NAME_LENGTH, store.normalizeListName("a".repeat(150)).length)
        assertEquals("", store.normalizeListName("   "))
    }

    @Test
    fun createUserListRejectsBlankAndUsesTimestampId() =
        runBlocking {
            val (store, backend) = newStore()
            assertNull(store.createUserList("   ", now = 1L))
            val id = store.createUserList("  新歌单  ", now = 1_700_000_000_000L)
            assertEquals("userlist_1700000000000", id)
            val info =
                store.state.value.userLists
                    .single()
            assertEquals("新歌单", info.name)
            assertEquals(1_700_000_000_000L, info.locationUpdateTime)
            assertTrue(store.hasUserListNamed("新歌单"))
            assertEquals(1, DataRepository(ShardedKvStore(backend)).getUserLists().size)
        }

    @Test
    fun renameUserListUpdatesNameButIgnoresBlankAndBuiltins() =
        runBlocking {
            val (store, backend) = newStore()
            store.userListCreate(ListStore.UserListInfo(id = "u1", name = "旧名", locationUpdateTime = null), -1)
            assertTrue(store.renameUserList("u1", "  新名 "))
            assertEquals(
                "新名",
                store.state.value.userLists
                    .single()
                    .name,
            )
            assertEquals(
                "新名",
                DataRepository(ShardedKvStore(backend)).getUserLists().single()["name"]!!.jsonPrimitiveStr(),
            )
            assertFalse(store.renameUserList("u1", "   "))
            assertFalse(store.renameUserList("default", "默认"))
        }

    @Test
    fun listMusicOverwriteReplacesWholeListAndPersists() =
        runBlocking {
            val (store, backend) = newStore()
            store.listMusicAdd("temp", listOf(music("a"), music("b")), "top")

            val changed = store.listMusicOverwrite("temp", listOf(music("x"), music("y"), music("z")))

            assertEquals(listOf("temp"), changed)
            val loaded = store.getListMusics("temp")
            assertEquals(listOf("x", "y", "z"), loaded.map { it.jsonPrimitiveStr2("id") })
            // 覆盖后旧歌不在
            assertTrue(loaded.none { it.jsonPrimitiveStr2("id") == "a" })
            // 持久层同步
            val persisted = DataRepository(ShardedKvStore(backend)).getListMusics("temp")
            assertEquals(3, persisted.size)
        }

    private fun kotlinx.serialization.json.JsonElement.jsonPrimitiveStr(): String = (this as JsonPrimitive).content

    private fun kotlinx.serialization.json.JsonObject.jsonPrimitiveStr2(key: String): String = (this[key] as JsonPrimitive).content
}
