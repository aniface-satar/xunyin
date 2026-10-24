package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.storage.KvStore
import cn.toside.music.core.userapi.BuiltinSeedInput
import cn.toside.music.core.userapi.BuiltinUpdateCatalog
import cn.toside.music.core.userapi.RemovedBuiltinSource
import cn.toside.music.core.userapi.ScriptHeaderInfo
import cn.toside.music.core.userapi.ScriptResolver
import cn.toside.music.core.userapi.UpdateUrlSource
import cn.toside.music.core.userapi.UserApiCatalog
import cn.toside.music.core.userapi.UserApiInfo
import cn.toside.music.core.userapi.UserApiScriptStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/**
 * 音源目录的落盘层 —— 一份可写的源清单 + 按 id 存的脚本/备份。
 *
 * 对应 RN `src/utils/data.ts` 里音源那组键（列表 + `${userApiPrefix}${id}` 脚本 + 备份），
 * 「列表该怎么变」的规则全部在 `:core` 的 [UserApiCatalog] 里，这里只负责读写与串行。
 *
 * 清单是这份存储的唯一事实来源：内置源第一次见到时按随包目录播种（[prepare]），
 * 用户导入的自定义源进同一张表，所以运行时的 `list` / `find` / `scriptOf`
 * 走的是同一份数据（文档 B3 续接点第 2 条）。
 *
 * 随包脚本不复制进 KV：内置源的正文留在 assets 里，KV 只存「用户换过的那份」，
 * 九个源 350KB 的正文不必在应用数据里再存一遍。
 */
class UserApiSourceStore(
    private val kv: KvStore,
    private val builtin: BuiltinSourceCatalog = BuiltinSourceCatalog.EMPTY,
    private val removedSources: List<RemovedBuiltinSource> = REMOVED_BUILTIN_SOURCES,
    private val now: () -> Long = System::currentTimeMillis,
    private val randomSuffix: () -> String = { (100..999).random().toString() },
) : UserApiScriptStore {
    private companion object {
        const val KEY_LIST = "userapi.list"
        const val KEY_SCRIPT = "userapi.script."
        const val KEY_BACKUP = "userapi.backup."
        const val KEY_HEADER = "userapi.header."
    }

    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }

    private var list: List<UserApiInfo> = emptyList()
    private var loaded = false
    private var prepared = false

    // ---------- 清单 ----------

    /** 读清单（第一次会先按随包目录播种）。 */
    suspend fun list(): List<UserApiInfo> = mutex.withLock { prepareLocked() }

    suspend fun find(id: String): UserApiInfo? = mutex.withLock { prepareLocked().firstOrNull { it.id == id } }

    /**
     * 按随包目录补种内置源，返回这次被下架的内置源 id。
     *
     * 一个应用进程里只跑一次：播种要比对盘上脚本，反复跑没有意义。
     */
    suspend fun prepare(): List<String> = mutex.withLock { seedLocked().second }

    private suspend fun prepareLocked(): List<UserApiInfo> = seedLocked().first

    private suspend fun seedLocked(): Pair<List<UserApiInfo>, List<String>> {
        if (!loaded) {
            list = UserApiCatalog.decode(kv.getString(KEY_LIST))
            loaded = true
        }
        if (prepared) return list to emptyList()
        prepared = true

        val definitions = builtin.definitions()
        // 只看 KV：那里存的是「用户/自动更新换上的那份」，随包正文留在 assets。
        // 清单里已有的源也要读一遍：下架的内置源不在 definitions 里了，
        // 播种规则得靠这份映射判断「用户有没有自己那份脚本」。
        val storedScripts =
            (definitions.map { it.id } + list.map { it.id }).distinct().associateWith { id ->
                kv.getString(KEY_SCRIPT + id)
            }
        val plan =
            UserApiCatalog.seed(
                BuiltinSeedInput(
                    existing = list,
                    storedScripts = storedScripts,
                    definitions = definitions,
                    removed = removedSources,
                ),
            )

        for (write in plan.writes) {
            // 盘上没有、assets 里就是这份正文时不必落盘：读的时候自然兜底，省掉九份脚本的重复
            if (kv.getString(KEY_SCRIPT + write.id) == null && builtin.scriptOf(write.id) == write.script) continue
            kv.setString(KEY_SCRIPT + write.id, write.script)
            kv.remove(KEY_HEADER + write.id)
        }
        for (id in plan.removedIds) {
            kv.remove(KEY_SCRIPT + id)
            kv.remove(KEY_BACKUP + id)
            kv.remove(KEY_HEADER + id)
        }
        if (plan.changed) persistLocked(plan.list)
        return list to plan.removedIds
    }

    /**
     * 导入一份脚本（在线取回或用户粘贴）。
     *
     * 头部注释不齐全就按 RN 的 `addUserApi` 失败返回，不落盘。
     */
    suspend fun importScript(
        script: String,
        updateUrl: String? = null,
    ): Result<UserApiInfo> =
        mutex.withLock {
            prepareLocked()
            // 先查数量再验脚本：满了还去解析脚本，等于给用户一个「导入成功又立刻塞不进」的假象
            if (!UserApiCatalog.canImport(list)) {
                return@withLock Result.failure(
                    IllegalStateException("最多只能同时存在 ${UserApiCatalog.MAX_SOURCE_COUNT} 个源，先移除一些旧的源腾出位置吧"),
                )
            }
            val info =
                UserApiCatalog
                    .buildImportedInfo(
                        script = script,
                        updateUrl = updateUrl,
                        now = now(),
                        randomSuffix = randomSuffix(),
                    ).getOrElse { return@withLock Result.failure(it) }
            kv.setString(KEY_SCRIPT + info.id, script)
            persistLocked(list + info)
            Result.success(info)
        }

    /** 删掉一个源：清单条目与盘上的脚本、备份、头部一起清。 */
    suspend fun removeSource(id: String): Boolean =
        mutex.withLock {
            prepareLocked()
            if (list.none { it.id == id }) return@withLock false
            persistLocked(list.filterNot { it.id == id })
            kv.remove(KEY_SCRIPT + id)
            kv.remove(KEY_BACKUP + id)
            kv.remove(KEY_HEADER + id)
            true
        }

    private suspend fun persistLocked(next: List<UserApiInfo>) {
        list = next
        loaded = true
        kv.setString(KEY_LIST, UserApiCatalog.encode(next))
    }

    /** 用户在设置里改更新地址（空串表示清空、以后不再自动检查这个源）。 */
    suspend fun setUpdateUrl(
        id: String,
        url: String,
    ): Boolean = updateInfo(id) { UserApiCatalog.withUserUpdateUrl(it, url) }

    /** 记下「这个地址取回的是别的音源脚本」，后台检查不再白跑。 */
    suspend fun setUpdateUrlRejected(
        id: String,
        url: String,
    ): Boolean = updateInfo(id) { UserApiCatalog.withRejectedUrl(it, url) }

    suspend fun setLastCheckAt(
        id: String,
        time: Long,
    ): Boolean = updateInfo(id) { it.copy(lastCheckAt = time) }

    suspend fun setVerifyPending(
        id: String,
        pending: Boolean,
    ): Boolean = updateInfo(id) { it.copy(verifyPending = pending) }

    /** 新脚本换上来后刷新条目信息（对照 RN `updateUserApi`）。 */
    suspend fun refreshFromScript(id: String): Boolean =
        mutex.withLock {
            val script = scriptOfLocked(id) ?: return@withLock false
            updateInfoLocked(id) { UserApiCatalog.applyScriptInfo(it, script) }
        }

    private suspend fun updateInfo(
        id: String,
        transform: (UserApiInfo) -> UserApiInfo,
    ): Boolean = mutex.withLock { updateInfoLocked(id, transform) }

    private suspend fun updateInfoLocked(
        id: String,
        transform: (UserApiInfo) -> UserApiInfo,
    ): Boolean {
        prepareLocked()
        val index = list.indexOfFirst { it.id == id }
        if (index < 0) return false
        val current = list[index]
        val next = transform(current)
        if (next == current) return true
        persistLocked(list.mapIndexed { i, info -> if (i == index) next else info })
        return true
    }

    // ---------- 清单里的可查字段 ----------

    suspend fun userUpdateUrl(id: String): String = find(id)?.updateUrl.orEmpty()

    suspend fun updateUrlRejected(id: String): String = find(id)?.updateUrlRejected.orEmpty()

    suspend fun verifyPending(id: String): Boolean = find(id)?.verifyPending == true

    suspend fun lastCheckAt(id: String): Long = find(id)?.lastCheckAt ?: 0L

    suspend fun nameOf(id: String): String = sourceHeader(id)?.name?.ifEmpty { null } ?: find(id)?.name?.ifEmpty { null } ?: id

    suspend fun versionOf(id: String): String = sourceHeader(id)?.version.orEmpty().ifEmpty { find(id)?.version.orEmpty() }

    /**
     * 更新检查用的地址与状态（对照 RN `getUserApi` 里那组地址字段）。
     *
     * 脚本正文都不在盘上时这个源已经没法更新了，返回 null 让调用方按「源不在了」处理。
     */
    suspend fun updateUrlSource(id: String): UpdateUrlSource? {
        val info = find(id) ?: return null
        val script = scriptOf(id) ?: return null
        val header = readHeader(id) ?: ScriptResolver.parseScriptHeader(script)
        return UpdateUrlSource(
            id = id,
            builtinKind = info.builtin,
            updateUrl = info.updateUrl,
            scriptUpdateUrl = header?.updateUrl.orEmpty().ifEmpty { info.scriptUpdateUrl },
            version = header?.version.orEmpty().ifEmpty { info.version },
            updateUrlRejected = info.updateUrlRejected.orEmpty(),
            lastCheckAt = info.lastCheckAt,
        )
    }

    fun updateCatalog(): BuiltinUpdateCatalog = builtin.updateCatalog()

    // ---------- 脚本正文 ----------

    /** 没有脚本（KV 和 assets 都没有）时返回 null，调用方按「源不在了」处理。 */
    suspend fun scriptOf(id: String): String? = mutex.withLock { scriptOfLocked(id) }

    private suspend fun scriptOfLocked(id: String): String? = kv.getString(KEY_SCRIPT + id) ?: builtin.scriptOf(id)

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

    /** 加载脚本时用的完整信息：脚本头部优先，缺的字段用清单条目补。 */
    suspend fun scriptInfo(id: String): UserApiScriptInfo? {
        val info = find(id) ?: return null
        val script = scriptOf(id) ?: return null
        val header = sourceHeader(id)
        return UserApiScriptInfo(
            id = id,
            name = header?.name?.ifEmpty { null } ?: info.name,
            script = script,
            description = header?.description?.ifEmpty { null } ?: info.description,
            version = header?.version?.ifEmpty { null } ?: info.version,
            author = header?.author?.ifEmpty { null } ?: info.author,
            homepage = header?.homepage?.ifEmpty { null } ?: info.homepage,
            loadSeq = "1",
        )
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
