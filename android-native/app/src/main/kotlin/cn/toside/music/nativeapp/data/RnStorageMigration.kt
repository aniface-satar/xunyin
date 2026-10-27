package cn.toside.music.nativeapp.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import cn.toside.music.core.backup.BackupManager
import cn.toside.music.core.storage.StorageKeys
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

/**
 * 旧版（RN 版）歌单自动迁移 —— 解析层。
 *
 * 原生版与 RN 版同包名、同签名，覆盖升级后应用私有目录原样保留，
 * 因此可以直接读 RN 侧的 AsyncStorage（Room 库 AsyncStorage，表 Storage）。
 *
 * RN 的落库形态（对照 src/utils/data.ts 与 src/plugins/storage.ts）：
 * - 用户歌单元信息：key 为 @user_list，值为 JSON 数组；
 * - 各列表歌曲：key 为 @list__ 加列表 id（default / love / 自建 id），值为 JSON 数组；
 * - 单值超过 500 KB 时分片存：新格式的值本身是分片 key 的 JSON 数组（带 @___PART_A___ 前缀），
 *   旧格式是 @___PART___ 前缀加逗号分隔的 key 串，真正的数据在分片 key 里。
 *
 * 本对象只做纯文本变换，不碰 IO，便于用 JVM 单测锁语义。
 */
internal object RnStorageMigration {
    const val USER_LIST_KEY = "@user_list"
    const val LIST_PREFIX = "@list__"
    const val PART_ARRAY_PREFIX = "@___PART_A___"
    const val PART_OLD_PREFIX = "@___PART___"
    const val DEFAULT_LIST_NAME = "试听列表"
    const val LOVE_LIST_NAME = "我的收藏"

    /** 分片值还原；无法解析时返回 null（调用方按「没有该键」处理）。 */
    fun resolveValue(
        raw: String?,
        all: Map<String, String>,
    ): String? {
        if (raw == null) return null
        if (raw.startsWith(PART_ARRAY_PREFIX)) {
            val keys =
                runCatching {
                    Json.parseToJsonElement(raw.removePrefix(PART_ARRAY_PREFIX)).jsonArray
                }.getOrNull() ?: return null
            return keys.joinToString("") { part ->
                val key = (part as? JsonPrimitive)?.content
                if (key == null) "" else all[key].orEmpty()
            }
        }
        if (raw.startsWith(PART_OLD_PREFIX)) {
            return raw
                .removePrefix(PART_OLD_PREFIX)
                .split(",")
                .joinToString("") { all[it].orEmpty() }
        }
        return raw
    }

    /** 把 AsyncStorage 快照拼成 `playList_v2` 备份文本；没有 `@user_list` 时返回 null。 */
    fun buildPlayListJson(
        all: Map<String, String>,
        defaultName: String = DEFAULT_LIST_NAME,
        loveName: String = LOVE_LIST_NAME,
    ): String? {
        val userListJson = resolveValue(all[USER_LIST_KEY], all) ?: return null
        val userLists =
            runCatching { Json.parseToJsonElement(userListJson).jsonArray }.getOrNull() ?: return null

        val data = mutableListOf<JsonObject>()
        data += entry("default", defaultName, resolveValue(all["${LIST_PREFIX}default"], all), null)
        data += entry("love", loveName, resolveValue(all["${LIST_PREFIX}love"], all), null)
        for (item in userLists) {
            val meta = item as? JsonObject ?: continue
            val id = meta.string("id") ?: continue
            val name = meta.string("name") ?: id
            data += entry(id, name, resolveValue(all["$LIST_PREFIX$id"], all), meta)
        }

        return buildJsonObject {
            put("type", JsonPrimitive("playList_v2"))
            put("data", JsonArray(data))
        }.toString()
    }

    private fun entry(
        id: String,
        name: String,
        listJson: String?,
        meta: JsonObject?,
    ): JsonObject =
        buildJsonObject {
            put("id", JsonPrimitive(id))
            put("name", JsonPrimitive(name))
            meta?.string("source")?.let { put("source", JsonPrimitive(it)) }
            meta?.string("sourceListId")?.let { put("sourceListId", JsonPrimitive(it)) }
            meta?.let { m -> m["locationUpdateTime"]?.let { put("locationUpdateTime", it) } }
            put("list", parseArray(listJson))
        }

    private fun parseArray(text: String?): JsonArray =
        if (text == null) {
            JsonArray(emptyList())
        } else {
            runCatching { Json.parseToJsonElement(text).jsonArray }
                .getOrDefault(JsonArray(emptyList()))
        }

    private fun JsonObject.string(key: String): String? {
        val value = this[key] as? JsonPrimitive ?: return null
        return if (value.isString) value.content else null
    }
}

/**
 * 旧版歌单自动迁移 —— 执行层。
 *
 * 只在首次启动跑一次（标记文件 `filesDir/rn_migration.done`）：
 * 把旧库复制到缓存目录再只读打开，避免读写旧库（WAL 恢复需要写权限，读副本最稳）。
 */
internal class RnAutoMigration(
    private val context: Context,
    private val backup: BackupManager,
) {
    /** 成功导入返回 true。任何异常都吞掉并返回 false —— 迁移失败不能挡住启动。 */
    suspend fun runIfNeeded(): Boolean {
        val marker = File(context.filesDir, MARKER_NAME)
        if (marker.exists()) return false
        val snapshot = readSnapshot() ?: return false
        val json = RnStorageMigration.buildPlayListJson(snapshot) ?: return false
        // 旧版确实没有歌单时不导入也不打标记：既不改动现有数据，也留一次重试机会。
        if (!hasContent(json)) return false
        if (backup.importJson(json) != BackupManager.ImportResult.FullImported) return false
        runCatching { marker.writeText(System.currentTimeMillis().toString()) }
        return true
    }

    /** 备份里是否有「自建歌单」或「试听/收藏里有歌」。 */
    private fun hasContent(json: String): Boolean =
        runCatching {
            val data = Json.parseToJsonElement(json).jsonObject["data"]?.jsonArray ?: return false
            data.any { item ->
                val obj = item.jsonObject
                val id = obj["id"]?.jsonPrimitive?.content
                id != StorageKeys.ListIds.DEFAULT &&
                    id != StorageKeys.ListIds.LOVE ||
                    obj["list"]?.jsonArray?.isNotEmpty() == true
            }
        }.getOrDefault(false)

    private fun readSnapshot(): Map<String, String>? {
        val source = context.getDatabasePath(DB_NAME)
        if (!source.exists()) return null

        val copyDir = File(context.cacheDir, "rn_migration").apply { mkdirs() }
        val copy = File(copyDir, DB_NAME)
        if (runCatching { source.copyTo(copy, overwrite = true) }.isFailure) return null
        // 只带主库与 -wal：RN 侧是 WAL 模式，新写入可能还在 wal 里。
        // -shm 故意不复制（陈旧的 shm 会让 SQLite 误判 wal 已落盘，导致读到旧值）。
        val wal = File(source.path + "-wal")
        if (wal.exists()) runCatching { wal.copyTo(File(copy.path + "-wal"), overwrite = true) }

        // 以读写模式打开**副本**：只读连接无法回放 wal，会静默读到旧数据。
        // 原库全程不动，回放产生的改动只落在缓存目录里。
        val db =
            runCatching { SQLiteDatabase.openDatabase(copy.path, null, SQLiteDatabase.OPEN_READWRITE) }
                .getOrNull() ?: return null
        return db.use { readAll(it) }
    }

    private fun readAll(db: SQLiteDatabase): Map<String, String> {
        val values = mutableMapOf<String, String>()
        for (table in TABLE_CANDIDATES) {
            val read =
                runCatching {
                    db.rawQuery("SELECT `key`, `value` FROM `$table`", null).use { cursor ->
                        while (cursor.moveToNext()) {
                            val key = cursor.getString(0) ?: continue
                            values[key] = cursor.getString(1).orEmpty()
                        }
                    }
                }.isSuccess
            if (read && values.isNotEmpty()) break
        }
        return values
    }

    private companion object {
        const val DB_NAME = "AsyncStorage"
        const val MARKER_NAME = "rn_migration.done"

        /** async-storage 2.x 是 `Storage`；1.x 旧库是 `catalystLocalStorage`。 */
        val TABLE_CANDIDATES = listOf("Storage", "storage", "catalystLocalStorage")
    }
}
