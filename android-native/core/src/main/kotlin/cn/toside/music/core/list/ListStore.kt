package cn.toside.music.core.list

import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 歌单列表状态与操作 —— RN 侧 src/utils/listManage.ts + src/store/list 的合并移植。
 *
 * B1 决策（Redux slice → StateFlow/MVI）：RN 的 list slice（state + action +
 * 事件广播）合并为单一 [ListStore]；UI 观察两个 StateFlow（列表元信息、
 * 每列表歌曲按需观察）。所有操作走 [Mutex] 串行，替代 RN 的全局事件时序。
 *
 * 操作语义与 listManage.ts 一一对应：
 * - listDataOverwrite / userListCreate / userListsRemove / userListsUpdate /
 *   userListsUpdatePosition
 * - listMusicAdd（top/bottom 去重）/ listMusicRemove / listMusicMove /
 *   listMusicUpdateInfo / listMusicUpdatePosition / listMusicClear
 * 均先改内存态再由调用方持久化（与 RN 事件流一致的写穿时机）。
 */
class ListStore(
    private val repo: DataRepository,
    private val stats: MusicStatsStore? = null,
) {
    /** 用户列表项（对应 LX.List.UserListInfo）。 */
    data class UserListInfo(
        val id: String,
        val name: String,
        val source: String? = null,
        val sourceListId: String? = null,
        val isLove: Boolean? = null,
        val locationUpdateTime: Long? = null,
    )

    /** 列表元信息快照（对应 RN list state 的 allList + activeListId）。 */
    data class ListState(
        val userLists: List<UserListInfo> = emptyList(),
        val activeListId: String = StorageKeys.ListIds.DEFAULT,
    )

    private val mutex = Mutex()
    private val _state = MutableStateFlow(ListState())

    /** 列表元信息流（UI 观察）。 */
    val state: StateFlow<ListState> = _state

    /** 内存歌曲缓存（listId → 歌曲数组；对应 listManage 的 allMusicList）。 */
    private val allMusicList = mutableMapOf<String, MutableList<JsonObject>>()

    // ---------- 初始化 ----------

    /** 从持久层加载用户列表（RN getUserLists）。 */
    suspend fun loadUserLists() {
        mutex.withLock {
            val lists = repo.getUserLists().mapNotNull { it.toUserListInfo() }
            _state.value = _state.value.copy(userLists = lists)
        }
    }

    suspend fun setActiveList(id: String) {
        mutex.withLock {
            _state.value = _state.value.copy(activeListId = id)
            repo.saveListPrevSelectId(id)
        }
    }

    // ---------- 列表歌曲读写 ----------

    /** RN getListMusics：缓存优先，无则读持久层并缓存。 */
    suspend fun getListMusics(listId: String): List<JsonObject> {
        if (listId.isEmpty()) return emptyList()
        mutex.withLock {
            allMusicList[listId]?.let { return it.toList() }
            val list = repo.getListMusics(listId).filterIsInstance<JsonObject>()
            val safe = MusicInfoTools.filterMusicList(list)
            allMusicList[listId] = safe.toMutableList()
            return safe
        }
    }

    // ---------- 列表元信息操作（对照 listManage.ts） ----------

    /** 列表名规范化（RN ListNameEdit：trim 后最多 100 字符）。 */
    fun normalizeListName(raw: String): String = raw.trim().take(MAX_LIST_NAME_LENGTH)

    /** 是否已有同名用户列表（RN 新建时的重复提示判据）。 */
    fun hasUserListNamed(name: String): Boolean = _state.value.userLists.any { it.name == name }

    /** RN core/list.ts#createList 的新建入口：空名不建，id 沿用 `userlist_<时间戳>`。 */
    suspend fun createUserList(
        name: String,
        position: Int = -1,
        now: Long = System.currentTimeMillis(),
    ): String? {
        val normalized = normalizeListName(name)
        if (normalized.isEmpty()) return null
        val id = "userlist_$now"
        userListCreate(UserListInfo(id = id, name = normalized, locationUpdateTime = now), position)
        return id
    }

    /** 单个用户列表改名；内置列表或不存在 id 返回 false。 */
    suspend fun renameUserList(
        listId: String,
        name: String,
    ): Boolean {
        val normalized = normalizeListName(name)
        if (normalized.isEmpty()) return false
        val info = _state.value.userLists.firstOrNull { it.id == listId } ?: return false
        userListsUpdate(listOf(info.copy(name = normalized)))
        return true
    }

    /** RN listDataOverwrite：整表覆盖（备份导入主入口）。返回更新过的列表 id。 */
    suspend fun listDataOverwrite(
        defaultList: List<JsonElement>,
        loveList: List<JsonElement>,
        userList: List<Pair<UserListInfo, List<JsonElement>>>,
        tempList: List<JsonElement>? = null,
    ): List<String> =
        mutex.withLock {
            val updatedListIds = mutableListOf<String>()
            val newUserListInfos = mutableListOf<UserListInfo>()
            for ((info, list) in userList) {
                if (allMusicList.containsKey(info.id)) updatedListIds.add(info.id)
                setMusicListLocked(info.id, list)
                newUserListInfos.add(info)
            }
            for (old in _state.value.userLists) {
                if (!allMusicList.containsKey(old.id) || newUserListInfos.any { it.id == old.id }) continue
                allMusicList.remove(old.id)
                updatedListIds.add(old.id)
            }
            _state.value = _state.value.copy(userLists = newUserListInfos)

            setMusicListLocked(StorageKeys.ListIds.DEFAULT, defaultList)
            setMusicListLocked(StorageKeys.ListIds.LOVE, loveList)
            updatedListIds.add(StorageKeys.ListIds.LOVE)
            tempList?.let {
                setMusicListLocked(StorageKeys.ListIds.TEMP, it)
                updatedListIds.add(StorageKeys.ListIds.TEMP)
            }

            // 持久化（RN 通过事件流异步写库；这里在锁内写穿）
            repo.saveUserList(newUserListInfos.map { it.toJson() })
            repo.saveListMusics(
                buildList {
                    add(StorageKeys.ListIds.DEFAULT to allMusicList[StorageKeys.ListIds.DEFAULT].orEmpty().toList())
                    add(StorageKeys.ListIds.LOVE to allMusicList[StorageKeys.ListIds.LOVE].orEmpty().toList())
                    for ((info, _) in userList) add(info.id to allMusicList[info.id].orEmpty().toList())
                },
            )
            updatedListIds
        }

    /** RN userListCreate。 */
    suspend fun userListCreate(
        info: UserListInfo,
        position: Int,
    ) = mutex.withLock {
        if (_state.value.userLists.any { it.id == info.id }) return@withLock
        val lists = _state.value.userLists.toMutableList()
        if (position < 0 || position >= lists.size) {
            lists.add(info)
        } else {
            lists.add(position, info)
        }
        _state.value = _state.value.copy(userLists = lists)
        repo.saveUserList(lists.map { it.toJson() })
    }

    /** RN userListsRemove。返回实际移除的 id。 */
    suspend fun userListsRemove(ids: List<String>): List<String> =
        mutex.withLock {
            val changed = mutableListOf<String>()
            val lists = _state.value.userLists.toMutableList()
            for (id in ids) {
                val index = lists.indexOfFirst { it.id == id }
                if (index >= 0) lists.removeAt(index)
                if (allMusicList.containsKey(id)) {
                    allMusicList.remove(id)
                    changed.add(id)
                }
            }
            _state.value = _state.value.copy(userLists = lists)
            if (changed.isNotEmpty()) {
                repo.removeListMusics(changed)
            }
            repo.saveUserList(lists.map { it.toJson() })
            changed
        }

    /** RN userListsUpdate。 */
    suspend fun userListsUpdate(listInfos: List<UserListInfo>) =
        mutex.withLock {
            val lists = _state.value.userLists.toMutableList()
            for (info in listInfos) {
                if (info.id == StorageKeys.ListIds.DEFAULT ||
                    info.id == StorageKeys.ListIds.LOVE ||
                    info.id == StorageKeys.ListIds.TEMP
                ) {
                    continue
                }
                val index = lists.indexOfFirst { it.id == info.id }
                if (index < 0) continue
                lists[index] =
                    lists[index].copy(
                        name = info.name,
                        source = info.source,
                        sourceListId = info.sourceListId,
                        isLove = info.isLove,
                        locationUpdateTime = info.locationUpdateTime,
                    )
            }
            _state.value = _state.value.copy(userLists = lists)
            repo.saveUserList(lists.map { it.toJson() })
        }

    /** RN userListsUpdatePosition：批量移动列表位置。 */
    suspend fun userListsUpdatePosition(
        position: Int,
        ids: List<String>,
    ) = mutex.withLock {
        val old = _state.value.userLists
        val map = linkedMapOf<String, UserListInfo>()
        old.forEach { map[it.id] = it }
        val updateLists = mutableListOf<UserListInfo>()
        for (id in ids) {
            val info = map.remove(id) ?: continue
            updateLists.add(info.copy(locationUpdateTime = System.currentTimeMillis()))
        }
        val rest = map.values.toList()
        val insertAt = minOf(position, rest.size)
        val newLists = rest.subList(0, insertAt) + updateLists + rest.subList(insertAt, rest.size)
        _state.value = _state.value.copy(userLists = newLists)
        repo.saveUserList(newLists.map { it.toJson() })
    }

    // ---------- 列表内歌曲操作（对照 listManage.ts） ----------

    /** RN listMusicAdd：去重 + top/bottom 插入。返回变更列表 id。 */
    suspend fun listMusicAdd(
        listId: String,
        musicInfos: List<JsonElement>,
        addMusicLocationType: String,
    ): List<String> =
        mutex.withLock {
            val targetList = ensureListLoadedLocked(listId)
            val listSet = mutableSetOf<String>()
            targetList.forEach { listSet.add(it.stringField("id").orEmpty()) }
            val filtered =
                MusicInfoTools.filterMusicList(musicInfos).filter { m ->
                    val id = m.stringField("id").orEmpty()
                    if (listSet.contains(id)) {
                        false
                    } else {
                        listSet.add(id)
                        true
                    }
                }
            when (addMusicLocationType) {
                "top" -> targetList.addAll(0, filtered)
                else -> targetList.addAll(filtered)
            }
            persistListLocked(listId, targetList)
            // RN initMusicAddTimeTracker：请求批里的 id 全部重打时间戳（含重复项/已在列表的曲目）
            stats?.stampAddTimes(listId, musicInfos.mapNotNull { (it as? JsonObject)?.stringField("id") })
            listOf(listId)
        }

    /** RN listMusicRemove。 */
    suspend fun listMusicRemove(
        listId: String,
        ids: List<String>,
    ): List<String> =
        mutex.withLock {
            val targetList = ensureListLoadedLocked(listId)
            val removeSet = ids.toHashSet()
            targetList.removeAll { removeSet.contains(it.stringField("id")) }
            persistListLocked(listId, targetList)
            listOf(listId)
        }

    /** RN listMusicMove：先删后加。 */
    suspend fun listMusicMove(
        fromId: String,
        toId: String,
        musicInfos: List<JsonElement>,
        addMusicLocationType: String,
    ): List<String> {
        listMusicRemove(fromId, musicInfos.mapNotNull { (it as? JsonObject)?.stringField("id") })
        return listMusicAdd(toId, musicInfos, addMusicLocationType)
    }

    /** RN listMusicUpdateInfo：更新列表内歌曲信息。 */
    suspend fun listMusicUpdateInfo(musicInfos: List<Pair<String, JsonObject>>): List<String> =
        mutex.withLock {
            val updateListIds = linkedSetOf<String>()
            for ((listId, musicInfo) in musicInfos) {
                val targetList = allMusicList[listId] ?: continue
                val musicId = musicInfo.stringField("id") ?: continue
                val index = targetList.indexOfFirst { it.stringField("id") == musicId }
                if (index < 0) continue
                val info = targetList[index].toMutableMap()
                info["name"] = musicInfo["name"] ?: info["name"]!!
                info["singer"] = musicInfo["singer"] ?: info["singer"]!!
                info["source"] = musicInfo["source"] ?: info["source"]!!
                info["interval"] = musicInfo["interval"] ?: info["interval"]!!
                info["meta"] = musicInfo["meta"] ?: info["meta"]!!
                targetList[index] = JsonObject(info)
                updateListIds.add(listId)
            }
            for (id in updateListIds) persistListLocked(id, allMusicList[id].orEmpty())
            updateListIds.toList()
        }

    /** RN listMusicUpdatePosition：批内移动歌曲位置。 */
    suspend fun listMusicUpdatePosition(
        listId: String,
        position: Int,
        ids: List<String>,
    ): List<String> =
        mutex.withLock {
            val targetList = ensureListLoadedLocked(listId)
            val map = linkedMapOf<String, JsonObject>()
            targetList.forEach { map[it.stringField("id").orEmpty()] = it }
            val infos = mutableListOf<JsonObject>()
            for (id in ids) {
                val info = map.remove(id) ?: continue
                infos.add(info)
            }
            val rest = map.values.toMutableList()
            val insertAt = minOf(position, rest.size)
            rest.addAll(insertAt, infos)
            targetList.clear()
            targetList.addAll(rest)
            persistListLocked(listId, targetList)
            listOf(listId)
        }

    /** RN listMusicClear：清空列表内歌曲。返回实际清空的 id。 */
    suspend fun listMusicClear(ids: List<String>): List<String> =
        mutex.withLock {
            val changed = mutableListOf<String>()
            for (id in ids) {
                val list = allMusicList[id] ?: continue
                if (list.isEmpty()) continue
                list.clear()
                persistListLocked(id, list)
                changed.add(id)
            }
            changed
        }

    /**
     * RN list_music_overwrite（core/list.ts#overwriteListMusics）：
     * 整表覆盖列表内歌曲（临时列表 / 排行榜播放入口）。
     */
    suspend fun listMusicOverwrite(
        listId: String,
        musicInfos: List<JsonElement>,
    ): List<String> =
        mutex.withLock {
            val targetList = ensureListLoadedLocked(listId)
            val safe = MusicInfoTools.filterMusicList(musicInfos.filterIsInstance<JsonObject>())
            targetList.clear()
            targetList.addAll(safe)
            persistListLocked(listId, targetList)
            listOf(listId)
        }

    // ---------- 内部 ----------

    /** RN data.ts#setListUpdateTime：同步成功后记录列表更新时间（`@list_update_info`）。 */
    suspend fun setListUpdateTime(
        listId: String,
        time: Long,
    ) = repo.setListUpdateTime(listId, time)

    private suspend fun ensureListLoadedLocked(listId: String): MutableList<JsonObject> {
        allMusicList[listId]?.let { return it }
        val list = repo.getListMusics(listId).filterIsInstance<JsonObject>()
        val safe = MusicInfoTools.filterMusicList(list)
        allMusicList[listId] = safe.toMutableList()
        return allMusicList[listId]!!
    }

    private fun setMusicListLocked(
        listId: String,
        list: List<JsonElement>,
    ) {
        val safe = MusicInfoTools.filterMusicList(list.filterIsInstance<JsonObject>())
        allMusicList[listId] = safe.toMutableList()
    }

    private suspend fun persistListLocked(
        listId: String,
        list: List<JsonElement>,
    ) {
        repo.saveListMusics(listOf(listId to list))
    }

    private fun UserListInfo.toJson(): JsonObject =
        buildJsonObject {
            put("id", JsonPrimitive(id))
            put("name", JsonPrimitive(name))
            source?.let { put("source", JsonPrimitive(it)) }
            sourceListId?.let { put("sourceListId", JsonPrimitive(it)) }
            isLove?.let { put("isLove", JsonPrimitive(it)) }
            put("locationUpdateTime", locationUpdateTime?.let { JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
        }

    private fun JsonObject.toUserListInfo(): UserListInfo? {
        val id = stringField("id") ?: return null
        val name = stringField("name") ?: return null
        return UserListInfo(
            id = id,
            name = name,
            source = stringField("source"),
            sourceListId = stringField("sourceListId"),
            isLove = (this["isLove"] as? JsonPrimitive)?.let { it.content == "true" },
            locationUpdateTime = (this["locationUpdateTime"] as? JsonPrimitive)?.content?.toLongOrNull(),
        )
    }

    private fun JsonObject.stringField(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.content

    companion object {
        /** 与 RN 一致：列表名超过 100 字符截断。 */
        const val MAX_LIST_NAME_LENGTH = 100
    }
}
