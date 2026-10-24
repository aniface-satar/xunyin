package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.storage.KvStore
import cn.toside.music.core.userapi.BuiltinUpdateCatalog
import cn.toside.music.core.userapi.ScriptHeaderInfo
import cn.toside.music.core.userapi.ScriptResolver
import cn.toside.music.core.userapi.UpdateUrlSource
import cn.toside.music.core.userapi.UserApiScriptStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * 音源脚本的落盘层 —— 对应 RN `src/utils/data` 里 `getUserApiScript` / `saveUserApiScript`
 * / `getUserApiBackupScript` 等几个键。
 *
 * 内置源脚本随包放在 assets 里当初始值；更新后的脚本、备份、头部与检查状态写在 KvStore，
 * 读取时优先 KV。这样升级 APK 换掉 assets 里的旧脚本时，用户已经自动更新到的新脚本还在。
 */
class UserApiSourceStore(
    private val kv: KvStore,
    private val builtin: BuiltinSourceRepository,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : UserApiScriptStore {
    private companion object {
        const val KEY_SCRIPT = "userapi.script."
        const val KEY_BACKUP = "userapi.backup."
        const val KEY_HEADER = "userapi.header."
        const val KEY_UPDATE_URL = "userapi.updateUrl."
        const val KEY_URL_REJECTED = "userapi.updateUrlRejected."
        const val KEY_VERIFY_PENDING = "userapi.verifyPending."
        const val KEY_LAST_CHECK = "userapi.lastCheckAt."
    }

    fun list(): List<BuiltinSource> = builtin.list()

    fun find(id: String): BuiltinSource? = builtin.find(id)

    fun updateCatalog(): BuiltinUpdateCatalog = builtin.updateCatalog()

    /** 没有脚本（既不在 KV 也不在 assets）时返回 null，调用方按「源不在了」处理。 */
    suspend fun scriptOf(id: String): String? = kv.getString(KEY_SCRIPT + id) ?: builtin.find(id)?.let { builtin.readScript(it) }

    override suspend fun readScript(id: String): String = scriptOf(id).orEmpty()

    override suspend fun writeScript(
        id: String,
        script: String,
        header: ScriptHeaderInfo?,
    ) {
        kv.setString(KEY_SCRIPT + id, script)
        // header 为 null 只有回滚会走到：那份备份连头部注释都没有，保留原列表信息（与 RN 一致）
        if (header != null) kv.setString(KEY_HEADER + id, encodeHeader(header))
    }

    override suspend fun writeBackup(
        id: String,
        script: String,
    ) {
        kv.setString(KEY_BACKUP + id, script)
    }

    override suspend fun readBackup(id: String): String? = kv.getString(KEY_BACKUP + id)

    suspend fun nameOf(id: String): String = sourceHeader(id)?.name?.ifEmpty { null } ?: builtin.find(id)?.name ?: id

    suspend fun versionOf(id: String): String = sourceHeader(id)?.version?.ifEmpty { null } ?: builtin.find(id)?.version.orEmpty()

    /** 加载脚本时用的完整信息：脚本头部优先，缺的字段用随包清单补。 */
    suspend fun scriptInfo(id: String): UserApiScriptInfo? {
        val source = builtin.find(id)
        val script = scriptOf(id) ?: return null
        val header = sourceHeader(id)
        return UserApiScriptInfo(
            id = id,
            name = header?.name?.ifEmpty { null } ?: source?.name.orEmpty(),
            script = script,
            description = header?.description?.ifEmpty { null } ?: source?.description.orEmpty(),
            version = header?.version?.ifEmpty { null } ?: source?.version.orEmpty(),
            author = header?.author?.ifEmpty { null } ?: source?.author.orEmpty(),
            homepage = header?.homepage?.ifEmpty { null } ?: source?.homepage.orEmpty(),
            loadSeq = "1",
        )
    }

    suspend fun updateUrlSource(id: String): UpdateUrlSource? {
        val source = builtin.find(id)
        val script = scriptOf(id) ?: return null
        val header = readHeader(id) ?: ScriptResolver.parseScriptHeader(script)
        val userUrl = kv.getString(KEY_UPDATE_URL + id).orEmpty()
        return UpdateUrlSource(
            id = id,
            builtinKind = source?.kind,
            updateUrl = userUrl.ifEmpty { source?.updateUrl.orEmpty() },
            scriptUpdateUrl = header?.updateUrl.orEmpty().ifEmpty { source?.scriptUpdateUrl.orEmpty() },
            version = header?.version.orEmpty().ifEmpty { source?.version.orEmpty() },
            updateUrlRejected = kv.getString(KEY_URL_REJECTED + id).orEmpty(),
            lastCheckAt = lastCheckAt(id),
        )
    }

    /** 用户自己填的更新地址（B5 设置页接入后写入）；没有就是空串。 */
    suspend fun userUpdateUrl(id: String): String = kv.getString(KEY_UPDATE_URL + id).orEmpty()

    suspend fun setUserUpdateUrl(
        id: String,
        url: String,
    ) {
        if (url.isEmpty()) kv.remove(KEY_UPDATE_URL + id) else kv.setString(KEY_UPDATE_URL + id, url)
    }

    suspend fun updateUrlRejected(id: String): String = kv.getString(KEY_URL_REJECTED + id).orEmpty()

    suspend fun setUpdateUrlRejected(
        id: String,
        url: String,
    ) {
        if (url.isEmpty()) kv.remove(KEY_URL_REJECTED + id) else kv.setString(KEY_URL_REJECTED + id, url)
    }

    suspend fun verifyPending(id: String): Boolean = kv.getString(KEY_VERIFY_PENDING + id) == "1"

    suspend fun setVerifyPending(
        id: String,
        pending: Boolean,
    ) {
        if (pending) kv.setString(KEY_VERIFY_PENDING + id, "1") else kv.remove(KEY_VERIFY_PENDING + id)
    }

    suspend fun lastCheckAt(id: String): Long = kv.getString(KEY_LAST_CHECK + id)?.toLongOrNull() ?: 0L

    suspend fun setLastCheckAt(
        id: String,
        time: Long,
    ) {
        kv.setString(KEY_LAST_CHECK + id, time.toString())
    }

    private suspend fun sourceHeader(id: String): ScriptHeaderInfo? =
        readHeader(id) ?: scriptOf(id)?.let { ScriptResolver.parseScriptHeader(it) }

    private suspend fun readHeader(id: String): ScriptHeaderInfo? {
        val text = kv.getString(KEY_HEADER + id) ?: return null
        return runCatching {
            val obj = json.parseToJsonElement(text).jsonObject
            ScriptHeaderInfo(
                name = obj.text("name").orEmpty(),
                version = obj.text("version").orEmpty(),
                description = obj.text("description").orEmpty(),
                author = obj.text("author").orEmpty(),
                homepage = obj.text("homepage").orEmpty(),
                updateUrl = obj.text("updateUrl").orEmpty(),
                buildTime = obj.text("buildTime")?.toLongOrNull() ?: 0L,
            )
        }.getOrNull()
    }

    private fun encodeHeader(header: ScriptHeaderInfo): String =
        buildJsonObject {
            put("name", header.name)
            put("version", header.version)
            put("description", header.description)
            put("author", header.author)
            put("homepage", header.homepage)
            put("updateUrl", header.updateUrl)
            put("buildTime", header.buildTime)
        }.toString()
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
