package cn.toside.music.core.music

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * 音乐信息模型与工具 —— 从 RN 侧 src/utils/index.ts + src/types/music.d.ts 移植。
 *
 * B1 阶段用 kotlinx.serialization 的 JsonElement 动态模型：
 * LX.Music.MusicInfo 的 meta 按源（kw/kg/tx/wy/mg/local）形状多变，
 * 备份导入导出只需要结构级操作（id/name/singer/source/meta），
 * 不做强类型反序列化（避免各源 meta 差异炸掉），与 JS 侧动态对象行为一致。
 */
object MusicInfoTools {
    private val json = Json { ignoreUnknownKeys = true }

    /** sanitizeMusicInfo：字段兜底与类型规整（对照 RN utils/index.ts:135）。 */
    fun sanitizeMusicInfo(info: JsonObject): JsonObject {
        val meta = (info["meta"] as? JsonObject) ?: JsonObject(emptyMap())
        val source =
            info["source"].stringOrNull ?: run {
                val filePath = meta["filePath"].stringOrNull
                if (!filePath.isNullOrEmpty()) "local" else "kw"
            }

        val id = info["id"].stringOrNull.orEmpty()
        val name = info["name"].stringOrNull.orEmpty()
        val singer = info["singer"].stringOrNull.orEmpty()
        val interval: JsonElement? =
            (info["interval"] as? JsonPrimitive)?.let {
                if (it is JsonNull) null else it
            }

        val metaOut = meta.toMutableMap()
        if (!metaOut.containsKey("songId")) metaOut["songId"] = JsonPrimitive(id)
        metaOut["albumName"] = JsonPrimitive(metaOut["albumName"].stringOrNull ?: "")
        metaOut["picUrl"] =
            when (val picUrl = metaOut["picUrl"]) {
                null -> JsonNull
                is JsonPrimitive -> picUrl
                else -> JsonNull
            }

        if (source == "local") {
            if (metaOut["filePath"] == null || metaOut["filePath"] is JsonNull) {
                metaOut["filePath"] = JsonPrimitive(metaOut["songId"].stringOrNull ?: id)
            }
            val ext = metaOut["ext"].stringOrNull
            if (ext.isNullOrEmpty()) {
                val fp = metaOut["filePath"].stringOrNull ?: ""
                metaOut["ext"] = JsonPrimitive(Regex("\\.(\\w+)$").find(fp)?.groupValues?.get(1) ?: "")
            }
        } else {
            if (metaOut["qualitys"] !is JsonArray) metaOut["qualitys"] = JsonArray(emptyList())
            if (metaOut["_qualitys"] !is JsonObject) metaOut["_qualitys"] = JsonObject(emptyMap())
        }

        return buildJsonObject {
            put("id", JsonPrimitive(id))
            put("name", JsonPrimitive(name))
            put("singer", JsonPrimitive(singer))
            put("interval", interval ?: JsonNull)
            put("source", JsonPrimitive(source))
            put("meta", JsonObject(metaOut))
        }
    }

    /** fixNewMusicInfoQuality：修复 flac32bit → flac24bit（对照 RN utils/index.ts:171）。 */
    fun fixNewMusicInfoQuality(info: JsonObject): JsonObject {
        val sanitized = sanitizeMusicInfo(info)
        val source = sanitized["source"].stringOrNull
        if (source == "local") return sanitized

        val meta = sanitized["meta"] as? JsonObject ?: return sanitized
        val qualitysMap = meta["_qualitys"] as? JsonObject ?: return sanitized
        if (!qualitysMap.containsKey("flac32bit") || qualitysMap.containsKey("flac24bit")) return sanitized

        val metaOut = meta.toMutableMap()
        val qualitysMapOut = qualitysMap.toMutableMap()
        qualitysMapOut["flac24bit"] = qualitysMapOut["flac32bit"]!!
        qualitysMapOut.remove("flac32bit")
        metaOut["_qualitys"] = JsonObject(qualitysMapOut)

        val qualitys = (metaOut["qualitys"] as? JsonArray) ?: JsonArray(emptyList())
        metaOut["qualitys"] =
            JsonArray(
                qualitys.map { q ->
                    if (q is JsonObject && q["type"].stringOrNull == "flac32bit") {
                        JsonObject(q.toMutableMap() + ("type" to JsonPrimitive("flac24bit")))
                    } else {
                        q
                    }
                },
            )

        return JsonObject(sanitized.toMutableMap() + ("meta" to JsonObject(metaOut)))
    }

    /** filterMusicList：去 null/去缺 id/去重、兜底 singer（对照 RN utils/index.ts:191）。 */
    fun filterMusicList(list: List<JsonElement>): List<JsonObject> {
        val ids = mutableSetOf<String>()
        return list.filterIsInstance<JsonObject>().mapNotNull { raw ->
            val s = sanitizeMusicInfo(raw)
            val id = s["id"].stringOrNull
            val name = s["name"].stringOrNull
            if (id.isNullOrEmpty() || ids.contains(id) || name.isNullOrEmpty()) return@mapNotNull null
            ids.add(id)
            val singerEl = s["singer"]
            if (singerEl == null || singerEl is JsonNull) {
                JsonObject(s.toMutableMap() + ("singer" to JsonPrimitive("")))
            } else {
                s
            }
        }
    }

    /** toNewMusicInfo：v1 旧格式 → v2 新格式（对照 RN utils/index.ts:28）。 */
    fun toNewMusicInfo(old: JsonObject): JsonObject? {
        val songmid = old["songmid"].stringOrNull ?: return null
        val source = old["source"].stringOrNull ?: return null
        val name = old["name"].stringOrNull ?: return null
        val singer = old["singer"].stringOrNull ?: return null

        val meta = mutableMapOf<String, JsonElement>()
        meta["songId"] = JsonPrimitive(songmid)
        meta["albumName"] = JsonPrimitive(old["albumName"].stringOrNull ?: "")
        meta["picUrl"] = JsonPrimitive(old["img"].stringOrNull ?: "")
        old["releaseDate"]?.let { meta["releaseDate"] = it }
        old["lang"]?.let { meta["lang"] = it }

        var id = "${source}_$songmid"
        if (source == "local") {
            val filePath = old["filePath"].stringOrNull ?: songmid
            meta["filePath"] = JsonPrimitive(filePath)
            meta["ext"] =
                JsonPrimitive(
                    old["ext"].stringOrNull ?: Regex("\\.(\\w+)$").find(filePath)?.groupValues?.get(1) ?: "",
                )
        } else {
            meta["qualitys"] = old["types"] ?: JsonArray(emptyList())
            meta["_qualitys"] = old["_types"] ?: JsonObject(emptyMap())
            old["albumId"]?.let { meta["albumId"] = it }
            val qMap = (meta["_qualitys"] as? JsonObject)?.toMutableMap() ?: mutableMapOf()
            if (qMap.containsKey("flac32bit") && !qMap.containsKey("flac24bit")) {
                qMap["flac24bit"] = qMap["flac32bit"]!!
                qMap.remove("flac32bit")
                meta["_qualitys"] = JsonObject(qMap)
                meta["qualitys"] =
                    JsonArray(
                        (meta["qualitys"] as? JsonArray ?: JsonArray(emptyList())).map { q ->
                            if (q is JsonObject && q["type"].stringOrNull == "flac32bit") {
                                JsonObject(q.toMutableMap() + ("type" to JsonPrimitive("flac24bit")))
                            } else {
                                q
                            }
                        },
                    )
            }
            when (source) {
                "kg" -> {
                    meta["hash"] = JsonPrimitive(old["hash"].stringOrNull ?: "")
                    id = "${songmid}_${meta["hash"].stringOrNull ?: ""}"
                }
                "tx" -> {
                    meta["strMediaMid"] = JsonPrimitive(old["strMediaMid"].stringOrNull ?: "")
                    old["albumMid"]?.let { meta["albumMid"] = it }
                    old["songId"]?.let { meta["id"] = it }
                }
                "mg" -> {
                    meta["copyrightId"] = JsonPrimitive(old["copyrightId"].stringOrNull ?: "")
                    old["lrcUrl"]?.let { meta["lrcUrl"] = it }
                    old["mrcUrl"]?.let { meta["mrcUrl"] = it }
                    old["trcUrl"]?.let { meta["trcUrl"] = it }
                }
            }
        }

        return buildJsonObject {
            put("id", JsonPrimitive(id))
            put("name", JsonPrimitive(name))
            put("singer", JsonPrimitive(singer))
            put("source", JsonPrimitive(source))
            put("interval", old["interval"] ?: JsonNull)
            put("meta", JsonObject(meta))
        }
    }

    fun parseObject(text: String): JsonObject? = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()

    fun parseArray(text: String): List<JsonElement>? = runCatching { json.parseToJsonElement(text).jsonArray }.getOrNull()

    /** JsonElement 的字符串内容访问（null 安全）。 */
    private val JsonElement?.stringOrNull: String?
        get() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
}
