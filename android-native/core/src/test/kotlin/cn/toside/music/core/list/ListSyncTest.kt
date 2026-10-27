package cn.toside.music.core.list

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 「更新」同步测试：对照 RN `core/syncSourceList.ts` 与 `data.ts#setListUpdateTime`。
 */
class ListSyncTest {
    private fun music(id: String): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", id)
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

    private fun idsOf(list: List<JsonObject>): List<String> = list.map { (it["id"] as JsonPrimitive).content }

    private fun userList(
        source: String? = "kw",
        sourceListId: String? = "123",
    ): ListStore.UserListInfo = ListStore.UserListInfo(id = "userlist_1", name = "在线歌单", source = source, sourceListId = sourceListId)

    @Test
    fun fetchTargetFollowsRnBoardPrefix() {
        assertEquals(
            ListSync.FetchTarget.Songlist("kw", "123"),
            ListSync.fetchTarget(userList()),
        )
        assertEquals(
            ListSync.FetchTarget.Board("tx__board1"),
            ListSync.fetchTarget(userList(source = "tx", sourceListId = "board__tx__board1")),
        )
    }

    @Test
    fun fetchTargetRequiresBothSourceFields() {
        assertNull(ListSync.fetchTarget(userList(source = null)))
        assertNull(ListSync.fetchTarget(userList(source = "")))
        assertNull(ListSync.fetchTarget(userList(sourceListId = null)))
        assertNull(ListSync.fetchTarget(userList(sourceListId = "")))
    }

    @Test
    fun runReplacesSongsAndStampsUpdateTime() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val kv = ShardedKvStore(backend)
            // 预置 isAutoUpdate=true，确认同步不会把它重置
            kv.saveData(
                StorageKeys.LIST_UPDATE_INFO,
                buildJsonObject {
                    put(
                        "userlist_1",
                        buildJsonObject {
                            put("updateTime", 1L)
                            put("isAutoUpdate", true)
                        },
                    )
                },
            )
            val store = ListStore(repo)
            store.userListCreate(userList().copy(locationUpdateTime = 5L), position = -1)
            store.listMusicAdd("userlist_1", listOf(music("old1"), music("old2")), "bottom")

            var seenTarget: ListSync.FetchTarget? = null
            val done =
                ListSync.run(store, userList(), now = 1_700_000_000_000L) { target ->
                    seenTarget = target
                    listOf(music("new1"), music("new2"), music("new3"))
                }

            assertEquals(ListSync.FetchTarget.Songlist("kw", "123"), seenTarget)
            assertEquals(ListSync.Done("userlist_1", 3, 1_700_000_000_000L), done)
            assertEquals(listOf("new1", "new2", "new3"), idsOf(store.getListMusics("userlist_1")))
            val synced =
                store.state.value.userLists
                    .single()
            assertEquals(1_700_000_000_000L, synced.locationUpdateTime)

            val updateInfo = checkNotNull(kv.getData<JsonObject>(StorageKeys.LIST_UPDATE_INFO))
            val info = updateInfo["userlist_1"] as JsonObject
            assertEquals("1700000000000", (info["updateTime"] as JsonPrimitive).content)
            assertEquals("true", (info["isAutoUpdate"] as JsonPrimitive).content)
        }

    @Test
    fun runKeepsListWhenFetchFails() =
        runBlocking {
            val backend = InMemoryKvStore()
            val repo = DataRepository(ShardedKvStore(backend))
            val store = ListStore(repo)
            store.userListCreate(userList().copy(locationUpdateTime = 5L), position = -1)
            store.listMusicAdd("userlist_1", listOf(music("keep")), "bottom")

            val done =
                ListSync.run(store, userList(), now = 2L) {
                    throw IllegalStateException("network down")
                }

            assertNull(done)
            assertEquals(listOf("keep"), idsOf(store.getListMusics("userlist_1")))
            val untouched =
                store.state.value.userLists
                    .single()
            assertEquals(5L, untouched.locationUpdateTime)
            val updateInfo = ShardedKvStore(backend).getData<JsonObject>(StorageKeys.LIST_UPDATE_INFO)
            assertNull(updateInfo)
        }

    @Test
    fun runWithMissingMetadataDoesNothing() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val store = ListStore(repo)
            store.userListCreate(userList(sourceListId = null).copy(locationUpdateTime = 5L), position = -1)

            var called = false
            val done =
                ListSync.run(store, userList(sourceListId = null), now = 2L) {
                    called = true
                    emptyList()
                }

            assertNull(done)
            assertTrue(!called)
            val untouched =
                store.state.value.userLists
                    .single()
            assertEquals(5L, untouched.locationUpdateTime)
        }

    @Test
    fun runWithEmptyOnlineListClearsLocalListLikeRn() =
        runBlocking {
            val repo = DataRepository(ShardedKvStore(InMemoryKvStore()))
            val store = ListStore(repo)
            store.userListCreate(userList(), position = -1)
            store.listMusicAdd("userlist_1", listOf(music("a")), "bottom")

            val done = ListSync.run(store, userList(), now = 3L) { emptyList() }

            assertEquals(0, done?.trackCount)
            assertTrue(store.getListMusics("userlist_1").isEmpty())
        }
}
