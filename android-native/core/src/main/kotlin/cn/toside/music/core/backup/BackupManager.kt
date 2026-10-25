package cn.toside.music.core.backup

import cn.toside.music.core.list.ListStore
import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.storage.GzipCodec
import cn.toside.music.core.storage.StorageKeys
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * .lxmc 备份文件导入导出 —— RN 侧 src/screens/.../Backup/actions.ts 的编排移植。
 *
 * 文件格式：gzip(JSON)，JSON 结构 {"type": ..., "data": ...}。
 * 支持的导入类型（对照 RN importPlayList 的 switch）：
 * - playList_v2 / allData_v2（v2 格式，fixNewMusicInfoQuality）
 * - playList / allData（v1 旧格式，toNewMusicInfo 转换）
 * - playListPart_v2 / playListPart（单列表，追加导入）
 * 导出固定 playList_v2。
 *
 * B1 范围：数据层编解码 + 列表操作编排（RN 侧的文件选择/对话框/toast
 * 属 UI 层，由 app 模块在 B5 接入）。
 */
class BackupManager(
    private val listStore: ListStore,
) {
    private val json = Json { ignoreUnknownKeys = true }

    /** 单列表导入冲突策略（对照 RN handleImportListPart：覆盖 / 新建带时间戳副本）。 */
    enum class PartConflictMode {
        RENAME_COPY,
        OVERWRITE,
    }

    /** 导入文件预览：单列表文件带 partId/partName，整份备份为 null。 */
    data class BackupPreview(
        val type: String,
        val partId: String? = null,
        val partName: String? = null,
    )

    /** 导出全部列表为 .lxmc 字节流（RN exportAllList：type=playList_v2）。 */
    suspend fun exportAllLists(): ByteArray {
        val defaultList = listStore.getListMusics("default")
        val loveList = listStore.getListMusics("love")
        val userLists =
            listStore.state.value.userLists.map { info ->
                buildJsonObject {
                    put("id", info.id)
                    put("name", info.name)
                    info.source?.let { put("source", it) }
                    info.sourceListId?.let { put("sourceListId", it) }
                    put(
                        "locationUpdateTime",
                        info.locationUpdateTime?.let { kotlinx.serialization.json.JsonPrimitive(it) }
                            ?: kotlinx.serialization.json.JsonNull,
                    )
                    put("list", JsonArray(listStore.getListMusics(info.id)))
                }
            }
        val data =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", "default")
                        put("name", "试听列表")
                        put("list", JsonArray(defaultList))
                    },
                )
                add(
                    buildJsonObject {
                        put("id", "love")
                        put("name", "我的收藏")
                        put("list", JsonArray(loveList))
                    },
                )
                userLists.forEach { add(it) }
            }
        val envelope =
            buildJsonObject {
                put("type", "playList_v2")
                put("data", data)
            }
        return GzipCodec.gzip(envelope.toString().toByteArray(Charsets.UTF_8))
    }

    /** 单列表导出：对照 RN MyList/listAction.ts#exportList（type=playListPart_v2）。 */
    suspend fun exportSingleList(
        listId: String,
        name: String,
    ): ByteArray {
        val store = listStore.state.value
        val info = store.userLists.firstOrNull { it.id == listId }
        val data =
            buildJsonObject {
                put("id", listId)
                put("name", name)
                info?.source?.let { put("source", it) }
                info?.sourceListId?.let { put("sourceListId", it) }
                put(
                    "locationUpdateTime",
                    info?.locationUpdateTime?.let { kotlinx.serialization.json.JsonPrimitive(it) }
                        ?: kotlinx.serialization.json.JsonNull,
                )
                put("list", JsonArray(listStore.getListMusics(listId)))
            }
        val envelope =
            buildJsonObject {
                put("type", "playListPart_v2")
                put("data", data)
            }
        return GzipCodec.gzip(envelope.toString().toByteArray(Charsets.UTF_8))
    }

    /** 导入前预览：只读 type 与单列表元信息，不落库（UI 用它决定是否弹覆盖确认）。 */
    fun preview(bytes: ByteArray): BackupPreview? =
        runCatching { previewJson(GzipCodec.gunzip(bytes).toString(Charsets.UTF_8)) }.getOrNull()

    fun previewJson(jsonText: String): BackupPreview? {
        val root =
            runCatching { json.parseToJsonElement(jsonText).jsonObject }.getOrNull()
                ?: return null
        val type = root.str("type") ?: return null
        val data = root["data"] as? JsonObject
        return BackupPreview(
            type = type,
            partId = data?.str("id"),
            partName = data?.str("name"),
        )
    }

    /** 导入结果。 */
    sealed class ImportResult {
        /** 整表导入成功（v1/v2 列表格式）。 */
        object FullImported : ImportResult()

        /** 单列表追加导入成功；name 冲突时由调用方决定改名（B5 UI 层对话框）。 */
        data class PartImported(
            val listInfo: PartListInfo,
        ) : ImportResult()

        /** 类型不支持。 */
        data class Unsupported(
            val type: String?,
        ) : ImportResult()

        /** 文件解析失败。 */
        object ParseError : ImportResult()
    }

    /** 单列表数据（追加导入用）。 */
    data class PartListInfo(
        val id: String,
        val name: String,
        val source: String? = null,
        val sourceListId: String? = null,
        val locationUpdateTime: Long? = null,
        val list: List<JsonObject>,
    )

    /** 导入 .lxmc 字节流（RN importPlayList 的 switch 编排）。 */
    suspend fun import(
        bytes: ByteArray,
        partConflict: PartConflictMode = PartConflictMode.RENAME_COPY,
    ): ImportResult {
        val text = runCatching { GzipCodec.gunzip(bytes).toString(Charsets.UTF_8) }.getOrElse { return ImportResult.ParseError }
        return importJson(text, partConflict)
    }

    /** JSON 直读（RN handleReadFile 对 .json 后缀的处理路径）。 */
    suspend fun importJson(
        jsonText: String,
        partConflict: PartConflictMode = PartConflictMode.RENAME_COPY,
    ): ImportResult {
        val root = runCatching { json.parseToJsonElement(jsonText).jsonObject }.getOrElse { return ImportResult.ParseError }
        val type = (root["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content

        return when (type) {
            "playList_v2" -> {
                val lists = root["data"]?.jsonArray ?: return ImportResult.ParseError
                fullImport(lists, legacy = false)
            }
            "playList" -> {
                val lists = root["data"]?.jsonArray ?: return ImportResult.ParseError
                fullImport(lists, legacy = true)
            }
            "allData_v2" -> {
                val lists = root["playList"]?.jsonArray ?: return ImportResult.ParseError
                fullImport(lists, legacy = false)
            }
            "allData" -> {
                val lists = root["playList"]?.jsonArray ?: return ImportResult.ParseError
                fullImport(lists, legacy = true)
            }
            "playListPart_v2" -> partImport(root["data"]?.jsonObject, legacy = false, partConflict)
            "playListPart" -> partImport(root["data"]?.jsonObject, legacy = true, partConflict)
            else -> ImportResult.Unsupported(type)
        }
    }

    /** 整表导入（RN importNewListData/importOldListData 语义）。 */
    private suspend fun fullImport(
        lists: JsonArray,
        legacy: Boolean,
    ): ImportResult {
        // RN getAllLists：现有列表（含元信息）→ 目标列表覆盖/追加 → overwriteListFull
        val existing = listStore.state.value.userLists
        val existingIds = existing.map { it.id }.toHashSet()

        val newUserLists = mutableListOf<ListStore.UserListInfo>()
        val defaultMusics = mutableListOf<JsonElement>()
        val loveMusics = mutableListOf<JsonElement>()
        val userMusics = mutableListOf<Pair<ListStore.UserListInfo, List<JsonElement>>>()

        for (el in lists) {
            val listObj = el as? JsonObject ?: continue
            val id = listObj.str("id") ?: continue
            val name = listObj.str("name") ?: continue
            val rawList = (listObj["list"] as? JsonArray) ?: JsonArray(emptyList())
            val converted =
                if (legacy) {
                    rawList.mapNotNull { (it as? JsonObject)?.let { o -> MusicInfoTools.toNewMusicInfo(o) } }
                } else {
                    rawList.map { MusicInfoTools.fixNewMusicInfoQuality(it as JsonObject) }
                }

            when (id) {
                "default" -> defaultMusics.addAll(converted)
                "love" -> loveMusics.addAll(converted)
                else -> {
                    val info =
                        ListStore.UserListInfo(
                            id = id,
                            name = name,
                            source = listObj.str("source"),
                            sourceListId = listObj.str("sourceListId"),
                            locationUpdateTime = listObj.str("locationUpdateTime")?.toLongOrNull(),
                        )
                    if (existingIds.contains(id) || newUserLists.none { it.id == id }) {
                        if (existingIds.contains(id)) {
                            // 已存在：覆盖该列表内容（RN targetList.list = ...）
                            val idx = userMusics.indexOfFirst { it.first.id == id }
                            if (idx >= 0) userMusics[idx] = info to converted else userMusics.add(info to converted)
                        } else {
                            newUserLists.add(info)
                            userMusics.add(info to converted)
                        }
                    }
                }
            }
        }

        listStore.listDataOverwrite(
            defaultList = defaultMusics,
            loveList = loveMusics,
            userList = userMusics,
        )
        return ImportResult.FullImported
    }

    /** 单列表导入（RN handleImportListPart：冲突时覆盖原列表或新建时间戳副本）。 */
    private suspend fun partImport(
        listObj: JsonObject?,
        legacy: Boolean,
        partConflict: PartConflictMode,
    ): ImportResult {
        if (listObj == null) return ImportResult.ParseError
        val id = listObj.str("id") ?: return ImportResult.ParseError
        val name = listObj.str("name") ?: return ImportResult.ParseError
        val rawList = (listObj["list"] as? JsonArray) ?: JsonArray(emptyList())
        val converted =
            if (legacy) {
                rawList.mapNotNull { (it as? JsonObject)?.let { o -> MusicInfoTools.toNewMusicInfo(o) } }
            } else {
                rawList.map { MusicInfoTools.fixNewMusicInfoQuality(it as JsonObject) }
            }
        val source = listObj.str("source")
        val sourceListId = listObj.str("sourceListId")
        val locationUpdateTime = listObj.str("locationUpdateTime")?.toLongOrNull()
        val convertedObjects = converted.filterIsInstance<JsonObject>()

        val existing = listStore.state.value.userLists
        val target = existing.firstOrNull { it.id == id }
        val isBuiltin = id == StorageKeys.ListIds.DEFAULT || id == StorageKeys.ListIds.LOVE
        if (target != null || isBuiltin) {
            if (partConflict == PartConflictMode.OVERWRITE) {
                // RN 覆盖分支：保留本地列表名，元信息与歌曲以文件为准
                if (target != null) {
                    listStore.userListsUpdate(
                        listOf(
                            target.copy(
                                source = source,
                                sourceListId = sourceListId,
                                locationUpdateTime = locationUpdateTime,
                            ),
                        ),
                    )
                }
                listStore.listMusicOverwrite(id, converted)
                return ImportResult.PartImported(
                    PartListInfo(
                        id = id,
                        name = target?.name ?: name,
                        source = source,
                        sourceListId = sourceListId,
                        locationUpdateTime = locationUpdateTime,
                        list = convertedObjects,
                    ),
                )
            }
        }

        val finalId =
            if (target != null || isBuiltin) {
                "${id}__${System.currentTimeMillis()}"
            } else {
                id
            }
        listStore.userListCreate(
            ListStore.UserListInfo(
                id = finalId,
                name = name,
                source = source,
                sourceListId = sourceListId,
                locationUpdateTime = locationUpdateTime,
            ),
            position = existing.size,
        )
        listStore.listMusicAdd(finalId, converted, "bottom")
        return ImportResult.PartImported(
            PartListInfo(
                id = finalId,
                name = name,
                source = source,
                sourceListId = sourceListId,
                locationUpdateTime = locationUpdateTime,
                list = convertedObjects,
            ),
        )
    }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it !is kotlinx.serialization.json.JsonNull }?.content
}
