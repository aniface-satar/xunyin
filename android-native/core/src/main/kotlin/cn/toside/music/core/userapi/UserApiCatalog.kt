package cn.toside.music.core.userapi

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 音源列表条目 —— RN `LX.UserApi.UserApiInfo`（`src/types/user_api.d.ts`）的移植。
 *
 * 列表本身存在存储里（一份 JSON 数组），脚本另存在按 id 的键下，与 RN
 * `src/utils/data.ts` 的 `userApiPrefix` / `${userApiPrefix}${id}` 分工一致。
 *
 * [allowShowUpdateAlert] / [autoUpdate] 是旧版逐源开关，RN 已改由全局设置决定，
 * 这里保留字段只为兼容已存数据（见 `user_api.d.ts` 注释）。
 */
@Serializable
data class UserApiInfo(
    val id: String,
    val name: String,
    val description: String = "",
    val author: String = "",
    val homepage: String = "",
    val version: String = "",
    /** 用户在设置里填的更新地址；内置源播种时来自目录，自定义源导入时来自来源地址。 */
    @SerialName("updateUrl") val updateUrl: String = "",
    /** 脚本头部注释里作者自己写的更新地址。 */
    @SerialName("scriptUpdateUrl") val scriptUpdateUrl: String = "",
    /** 上次自动检查更新的时间戳，0 表示从没查过。 */
    @SerialName("lastCheckAt") val lastCheckAt: Long = 0L,
    /** 自动更新写进去、还没被真正加载验证过。 */
    @SerialName("verifyPending") val verifyPending: Boolean = false,
    @SerialName("allowShowUpdateAlert") val allowShowUpdateAlert: Boolean = true,
    @SerialName("autoUpdate") val autoUpdate: Boolean = true,
    /** 随包内置源的类别："online" / "local"；自定义源为 null。 */
    val builtin: String? = null,
    /** 本地内置源上一次随应用包写入的脚本版本。 */
    @SerialName("builtinVersion") val builtinVersion: String? = null,
    /** 在线内置源上一次由应用包写入的更新地址。 */
    @SerialName("builtinUpdateUrl") val builtinUpdateUrl: String? = null,
    /** 自动检查里已证明「取回的是别的音源脚本」的地址。 */
    @SerialName("updateUrlRejected") val updateUrlRejected: String? = null,
)

/** 随包内置源参与播种所需的目录条目（对照 RN `BuiltinSourceDefinition`）。 */
data class BuiltinSeedDefinition(
    val id: String,
    val kind: String,
    val name: String,
    val version: String,
    val description: String = "",
    val author: String = "",
    val homepage: String = "",
    val script: String,
    val updateUrl: String = "",
    val legacyUpdateUrls: List<String> = emptyList(),
    val fallbackUpdateUrls: List<String> = emptyList(),
    val scriptUpdateUrl: String = "",
    val autoUpdate: Boolean = false,
    val checkUpdateUrls: List<String> = emptyList(),
    val autoCheck: Boolean = false,
)

/** 已下架的内置源（对照 RN `REMOVED_BUILTIN_SOURCES`）。 */
data class RemovedBuiltinSource(
    val id: String,
    val name: String,
)

data class BuiltinSeedInput(
    val existing: List<UserApiInfo>,
    /** 内置源 id → 盘上脚本；没有存过就是 null。下架的源也放进来，接手判定要看它。 */
    val storedScripts: Map<String, String?>,
    val definitions: List<BuiltinSeedDefinition>,
    val removed: List<RemovedBuiltinSource> = emptyList(),
)

data class BuiltinSeedWrite(
    val id: String,
    val script: String,
)

data class BuiltinSeedPlan(
    val list: List<UserApiInfo>,
    val writes: List<BuiltinSeedWrite>,
    /** 这次从列表里下架的源：调用方要把盘上的脚本和备份一起删掉。 */
    val removedIds: List<String>,
    val changed: Boolean,
)

/**
 * 音源目录规则 —— RN `src/utils/builtinSources.ts` 与 `src/utils/data.ts` 里
 * 音源列表那几个纯函数的移植。
 *
 * 这里只做「列表该怎么变」的判断，读写存储由 app 侧的目录存储负责，
 * 于是每条规则都能用 JVM 用例锁死。
 */
object UserApiCatalog {
    private val json = Json { ignoreUnknownKeys = true }

    /** 头部注释各字段入库长度上限（对照 RN `INFO_NAMES`）。 */
    private val INFO_LIMITS =
        linkedMapOf(
            "name" to 24,
            "description" to 36,
            "author" to 56,
            "homepage" to 1024,
            "version" to 36,
        )

    fun encode(list: List<UserApiInfo>): String = json.encodeToString(list)

    /**
     * 解析列表。RN 1.7.1 之前把脚本正文内联存进过列表（`script` 字段），
     * `ignoreUnknownKeys` 让那份脏数据在这里自然被丢掉。
     */
    fun decode(text: String?): List<UserApiInfo> =
        runCatching { json.decodeFromString<List<UserApiInfo>>(text ?: "") }
            .getOrElse { emptyList() }

    /**
     * 导入一份脚本：头部注释必须齐全，否则按 RN 的 `addUserApi` 报「不是音源脚本」。
     *
     * @param randomSuffix RN 用 `Math.random()` 的前三位数字，测试里注入固定值
     */
    fun buildImportedInfo(
        script: String,
        updateUrl: String? = null,
        now: Long = System.currentTimeMillis(),
        randomSuffix: String = (100..999).random().toString(),
        fallbackName: String = "user_api_$now",
    ): Result<UserApiInfo> {
        val comment =
            ScriptResolver.matchHeaderComment(script)
                ?: return Result.failure(IllegalArgumentException("导入的内容不是音源脚本：缺少头部注释"))
        val infos = matchInfo(comment)
        val name = infos["name"].orEmpty().ifEmpty { fallbackName }
        return Result.success(
            UserApiInfo(
                id = "user_api_${randomSuffix}_$now",
                name = name,
                description = infos["description"].orEmpty(),
                author = infos["author"].orEmpty(),
                homepage = infos["homepage"].orEmpty(),
                version = infos["version"].orEmpty(),
                allowShowUpdateAlert = true,
                autoUpdate = true,
                // 线上导入时记下取脚本的地址，入库后就能走定时检查；本地文件导入没有来源地址
                updateUrl = updateUrl?.trim().orEmpty(),
                scriptUpdateUrl = ScriptResolver.parseScriptHeader(script)?.updateUrl.orEmpty(),
                lastCheckAt = 0L,
            ),
        )
    }

    /**
     * 新脚本换上来后刷新列表条目（对照 RN `updateUserApi` / `applyDefinitionScriptInfo`）。
     *
     * 用户在设置里填的 `updateUrl` 不动：覆盖它等于把他的话擦掉。
     */
    fun applyScriptInfo(
        info: UserApiInfo,
        script: String,
        keepNameWhenHeaderEmpty: Boolean = true,
    ): UserApiInfo {
        val comment = ScriptResolver.matchHeaderComment(script) ?: return info
        val infos = matchInfo(comment)
        val header = ScriptResolver.parseScriptHeader(script)
        val name = infos["name"].orEmpty()
        return info.copy(
            name = if (keepNameWhenHeaderEmpty && name.isEmpty()) info.name else name,
            description = infos["description"].orEmpty(),
            author = infos["author"].orEmpty(),
            homepage = infos["homepage"].orEmpty(),
            version = infos["version"].orEmpty(),
            scriptUpdateUrl = header?.updateUrl.orEmpty(),
        )
    }

    /** 用户改了更新地址：之前「这个地址取回的是别的音源」的结论作废。 */
    fun withUserUpdateUrl(
        info: UserApiInfo,
        url: String,
    ): UserApiInfo = info.copy(updateUrl = url.trim(), updateUrlRejected = null)

    fun withRejectedUrl(
        info: UserApiInfo,
        url: String,
    ): UserApiInfo = if (url.isEmpty() || info.updateUrlRejected == url) info else info.copy(updateUrlRejected = url)

    /**
     * 当前音源被下架后改用哪个（对照 RN `pickAvailableUserApiId`）：
     * 优先默认源，退到任一在线内置源、任一内置源，最后才是列表第一个。
     */
    fun pickAvailableId(
        list: List<UserApiInfo>,
        preferredId: String,
    ): String {
        if (list.any { it.id == preferredId }) return preferredId
        return list.firstOrNull { it.builtin == "online" }?.id
            ?: list.firstOrNull { it.builtin != null }?.id
            ?: list.firstOrNull()?.id
            ?: ""
    }

    /**
     * 把随包内置源补进源列表 —— RN `planBuiltinSeed` 的逐条移植。
     *
     * 在线源可能已被自动更新换成更新的脚本，只在盘上丢了时才拿包里的补回去；
     * 本地源现在也能检查更新，所以不能每次启动都拿包里的覆盖盘上的：
     * `builtinVersion` 记着这个应用包最后一次带进来的版本，同一应用包里盘上的差异
     * 只可能是用户检查更新换上的，要保留；应用升级后再按版本号决定。
     * 用户的开关、手改的更新地址、上次检查时间一律保留。
     */
    fun seed(input: BuiltinSeedInput): BuiltinSeedPlan {
        val definitions = input.definitions
        val definitionIds = definitions.map { it.id }.toSet()
        val removed = input.removed.filter { it.id !in definitionIds }.associateBy { it.id }
        val removedIds = mutableListOf<String>()
        val writes = mutableListOf<BuiltinSeedWrite>()
        var changed = false

        // 只带内置标记且已下架的条目才处理；用户接手过（自己填过地址、盘上有自己那份脚本）的摘掉标记留下
        var list =
            input.existing.mapNotNull { info ->
                if (info.builtin == null || !removed.containsKey(info.id)) return@mapNotNull info
                changed = true
                val takenOver =
                    hasOwnUpdateUrl(info, definitions) && !input.storedScripts[info.id].isNullOrEmpty()
                if (takenOver) {
                    info.copy(builtin = null, builtinVersion = null, builtinUpdateUrl = null, updateUrlRejected = null)
                } else {
                    // RN 这里只要用户填过地址就留着，因为它播种时把随包脚本也复制进了存储；
                    // 原生侧随包正文留在 assets，目录一撤就没有任何地方还留着它，
                    // 留一行没有脚本的条目只会变成一个点不动的按钮
                    removedIds.add(info.id)
                    null
                }
            }

        // 旧版「手动更新先落址再预览」可能把别的内置源的地址存到这个源上：
        // 地址是用户字段不能替他删，但自动检查已证明它没用，记下来别再白跑
        list =
            list.map { info ->
                val owner = findByUpdateUrl(info.updateUrl, definitions) ?: return@map info
                if (owner.id == info.id || owner.name == info.name || info.updateUrlRejected == info.updateUrl) return@map info
                changed = true
                info.copy(updateUrlRejected = info.updateUrl)
            }

        for (definition in definitions) {
            val index = list.indexOfFirst { it.id == definition.id }
            if (index < 0) {
                list = list + createInfo(definition)
                writes.add(BuiltinSeedWrite(definition.id, definition.script))
                changed = true
                continue
            }
            var info = list[index]
            if (info.builtin != definition.kind) {
                info = info.copy(builtin = definition.kind)
                changed = true
            }
            val storedScript = input.storedScripts[definition.id]

            if (definition.kind == "local") {
                if (storedScript == definition.script) {
                    // 应用包和盘上的脚本一致：补上（或修正）这个应用包的版本标记
                    if (info.builtinVersion != definition.version) {
                        info = info.copy(builtinVersion = definition.version)
                        changed = true
                    }
                    if (info.scriptUpdateUrl != definition.scriptUpdateUrl) {
                        info = info.copy(scriptUpdateUrl = definition.scriptUpdateUrl)
                        changed = true
                    }
                    list = list.replaceAt(index, info)
                    continue
                }
                if (storedScript.isNullOrEmpty()) {
                    writes.add(BuiltinSeedWrite(definition.id, definition.script))
                    info = applyDefinitionScriptInfo(info, definition).copy(builtinVersion = definition.version)
                    changed = true
                    list = list.replaceAt(index, info)
                    continue
                }
                // 这个应用包已经处理过了：盘上的差异是用户检查更新换上的脚本，保留
                if (info.builtinVersion == definition.version) {
                    val (next, didChange) = fillMissingScriptUpdateUrl(info, storedScript, definition)
                    if (didChange) {
                        changed = true
                        list = list.replaceAt(index, next)
                    }
                    continue
                }
                // 应用升级了：随包更新就覆盖，用户已更到更高版本就保留
                val storedVersion = ScriptResolver.parseScriptHeader(storedScript)?.version.orEmpty()
                val compared =
                    if (storedVersion.isEmpty()) null else VersionCompare.compare(definition.version, storedVersion)
                info = info.copy(builtinVersion = definition.version)
                changed = true
                if (compared != null && compared < 0) {
                    val (next, didChange) = fillMissingScriptUpdateUrl(info, storedScript, definition)
                    list = list.replaceAt(index, next)
                    if (didChange) changed = true
                } else {
                    writes.add(BuiltinSeedWrite(definition.id, definition.script))
                    list = list.replaceAt(index, applyDefinitionScriptInfo(info, definition))
                }
                continue
            }

            val (migrated, didMigrate) = migrateOnlineUpdateUrl(info, definition)
            if (didMigrate) {
                info = migrated
                changed = true
            }
            list = list.replaceAt(index, info)
            if (!storedScript.isNullOrEmpty()) continue
            writes.add(BuiltinSeedWrite(definition.id, definition.script))
            info =
                info
                    .copy(
                        name = info.name.ifEmpty { definition.name },
                        version = info.version.ifEmpty { definition.version },
                        scriptUpdateUrl = info.scriptUpdateUrl.ifEmpty { definition.scriptUpdateUrl },
                    )
            changed = true
            list = list.replaceAt(index, info)
        }

        return BuiltinSeedPlan(list, writes, removedIds, changed)
    }

    private fun List<UserApiInfo>.replaceAt(
        index: Int,
        value: UserApiInfo,
    ): List<UserApiInfo> = mapIndexed { i, item -> if (i == index) value else item }

    private fun createInfo(definition: BuiltinSeedDefinition): UserApiInfo =
        UserApiInfo(
            id = definition.id,
            name = definition.name,
            description = definition.description,
            allowShowUpdateAlert = definition.kind == "online",
            autoUpdate = definition.autoUpdate,
            author = definition.author,
            homepage = definition.homepage,
            version = definition.version,
            updateUrl = definition.updateUrl,
            scriptUpdateUrl = definition.scriptUpdateUrl,
            lastCheckAt = 0,
            verifyPending = false,
            builtin = definition.kind,
            builtinVersion = if (definition.kind == "local") definition.version else null,
            builtinUpdateUrl = if (definition.kind == "local") null else definition.updateUrl,
        )

    private fun applyDefinitionScriptInfo(
        info: UserApiInfo,
        definition: BuiltinSeedDefinition,
    ): UserApiInfo =
        info.copy(
            name = definition.name,
            description = definition.description,
            author = definition.author,
            homepage = definition.homepage,
            version = definition.version,
            scriptUpdateUrl = definition.scriptUpdateUrl,
        )

    /**
     * 这个源的更新地址是不是用户自己填的。
     *
     * 本地内置源播种时 updateUrl 是空的，非空就说明用户点过「手动更新」并保存了地址；
     * 记过「取回别家脚本」的地址是旧版误存进来的，不算用户的东西。
     */
    private fun hasOwnUpdateUrl(
        info: UserApiInfo,
        definitions: List<BuiltinSeedDefinition>,
    ): Boolean {
        val url = info.updateUrl
        if (url.isEmpty() || info.updateUrlRejected == url) return false
        return findByUpdateUrl(url, definitions) == null
    }

    private data class OnlineOwner(
        val id: String,
        val name: String,
    )

    /** 这个地址是不是某个在线内置源由目录写入的（当前地址或上一版随包写的旧地址）。 */
    private fun findByUpdateUrl(
        url: String,
        definitions: List<BuiltinSeedDefinition>,
    ): OnlineOwner? {
        if (url.isEmpty()) return null
        val definition =
            definitions.firstOrNull {
                it.kind == "online" && (it.updateUrl == url || it.legacyUpdateUrls.contains(url))
            } ?: return null
        return OnlineOwner(definition.id, definition.name)
    }

    /**
     * 本地源的脚本头部地址要一直留在列表里（对照 RN `fillMissingScriptUpdateUrl`）。
     *
     * @return 有没有改动
     */
    private fun fillMissingScriptUpdateUrl(
        info: UserApiInfo,
        storedScript: String?,
        definition: BuiltinSeedDefinition,
    ): Pair<UserApiInfo, Boolean> {
        if (info.scriptUpdateUrl.isNotEmpty()) return info to false
        val headerUrl = storedScript?.let { ScriptResolver.parseScriptHeader(it)?.updateUrl }.orEmpty()
        val url = headerUrl.ifEmpty { definition.scriptUpdateUrl }
        if (url.isEmpty()) return info to false
        return info.copy(scriptUpdateUrl = url) to true
    }

    /**
     * 在线内置源的更新地址跟着目录走（对照 RN `migrateOnlineUpdateUrl`）。
     *
     * 只有盘上那个地址还是目录写的才换成新地址；用户自己改过、或者手动清空了就不动。
     *
     * @return 换过的条目与是否改动
     */
    private fun migrateOnlineUpdateUrl(
        info: UserApiInfo,
        definition: BuiltinSeedDefinition,
    ): Pair<UserApiInfo, Boolean> {
        val current = info.updateUrl
        val seeded = info.builtinUpdateUrl
        if (seeded != null) {
            if (current != seeded) {
                if (current != definition.updateUrl) return info to false
                if (seeded == definition.updateUrl) return info to false
                return info.copy(builtinUpdateUrl = definition.updateUrl) to true
            }
            if (current == definition.updateUrl) return info to false
            return info.copy(updateUrl = definition.updateUrl, builtinUpdateUrl = definition.updateUrl) to true
        }
        if (definition.legacyUpdateUrls.contains(current)) {
            return info.copy(updateUrl = definition.updateUrl, builtinUpdateUrl = definition.updateUrl) to true
        }
        if (current.isNotEmpty() && current == definition.updateUrl) {
            return info.copy(builtinUpdateUrl = definition.updateUrl) to true
        }
        return info to false
    }

    /**
     * 头部注释 → 入库信息，按 RN `matchInfo` 逐条对齐：
     * 只认 `@key value` 形式的已知字段，超长截断后补 `...`。
     */
    private fun matchInfo(comment: String): Map<String, String> {
        val infos = linkedMapOf<String, String>()
        for (line in comment.split(Regex("\\r?\\n"))) {
            val matched = INFO_LINE_RXP.find(line) ?: continue
            val key = matched.groupValues[1]
            if (!INFO_LIMITS.containsKey(key)) continue
            val value = matched.groupValues[2].trim()
            val limit = INFO_LIMITS[key] ?: continue
            infos[key] = if (value.length > limit) value.substring(0, limit) + "..." else value
        }
        return INFO_LIMITS.keys.map { it to infos[it].orEmpty() }.toMap()
    }

    // RN 的 matchInfo 严格区分大小写（@name / @description / @author / @homepage / @version）
    private val INFO_LINE_RXP = Regex("^\\s?\\*\\s?@(\\w+)\\s(.+)$")
}
