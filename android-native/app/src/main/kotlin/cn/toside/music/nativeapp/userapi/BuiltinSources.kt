package cn.toside.music.nativeapp.userapi

import android.content.Context
import cn.toside.music.core.userapi.BuiltinSeedDefinition
import cn.toside.music.core.userapi.BuiltinUpdateCatalog
import cn.toside.music.core.userapi.BuiltinUpdateCatalogEntry
import cn.toside.music.core.userapi.RemovedBuiltinSource
import cn.toside.music.core.userapi.ScriptResolver
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class BuiltinSource(
    val id: String,
    val key: String,
    val kind: String = "",
    val name: String,
    val version: String,
    val description: String = "",
    val author: String = "",
    val homepage: String = "",
    val updateUrl: String = "",
    @SerialName("scriptUpdateUrl") val scriptUpdateUrl: String = "",
    @SerialName("legacyUpdateUrls") val legacyUpdateUrls: List<String> = emptyList(),
    @SerialName("fallbackUpdateUrls") val fallbackUpdateUrls: List<String> = emptyList(),
    @SerialName("checkUpdateUrls") val checkUpdateUrls: List<String> = emptyList(),
    @SerialName("autoCheck") val autoCheck: Boolean = false,
    @SerialName("scriptFile") val scriptFile: String,
)

@Serializable private data class BuiltinSourceManifest(
    val sources: List<BuiltinSource>,
)

/**
 * 已随应用更新下架的内置源（对照 RN `REMOVED_BUILTIN_SOURCES`）。
 *
 * 这几个源的更新链路已经失效，留在清单里用户点「检查更新」只会一直报没有地址。
 * 下架名单参与播种：老安装里随包播种的那份会被清掉，
 * 用户自己填过更新地址的则摘掉内置标记、当自定义源留下。
 */
val REMOVED_BUILTIN_SOURCES: List<RemovedBuiltinSource> =
    listOf(
        RemovedBuiltinSource("builtin_xigua", "西瓜聚合源"),
        RemovedBuiltinSource("builtin_yuxi", "屿溪-终章"),
        RemovedBuiltinSource("builtin_yuningxi", "lx-玉宁熙-Pro"),
        RemovedBuiltinSource("builtin_juhe_cf", "聚合API接口 (CF)"),
    )

/**
 * 随包内置源的读取面 —— 音源存储层只依赖这个接口，
 * 于是「可写音源目录」的整条链路能在 JVM 用例里注入假目录，不用造 `Context`。
 */
interface BuiltinSourceCatalog {
    /** 参与播种的目录条目（脚本正文来自 assets）。 */
    fun definitions(): List<BuiltinSeedDefinition>

    /** 随包脚本正文；源不在清单里返回 null。 */
    fun scriptOf(id: String): String?

    /** 更新检查用的目录：备用线路与本地源的版本接口都来自随包清单。 */
    fun updateCatalog(): BuiltinUpdateCatalog

    companion object {
        /** 没有随包目录时用（JVM 用例、目录读坏的兜底）。 */
        val EMPTY: BuiltinSourceCatalog =
            object : BuiltinSourceCatalog {
                override fun definitions(): List<BuiltinSeedDefinition> = emptyList()

                override fun scriptOf(id: String): String? = null

                override fun updateCatalog(): BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY
            }
    }
}

/**
 * 随包内置音源脚本（`android-native/tools/export-builtin-sources.mjs` 从 RN
 * `src/config/builtinSources/scripts.ts` 导出）。脚本是纯 JS，运行时完全一致。
 */
class BuiltinSourceRepository(
    private val context: Context,
) : BuiltinSourceCatalog {
    companion object {
        const val DEFAULT_SOURCE_ID = "builtin_xinghai"
        private const val MANIFEST = "lx-sources/manifest.json"
    }

    private val json = Json { ignoreUnknownKeys = true }

    private val sources: List<BuiltinSource> by lazy {
        runCatching {
            val text =
                context.assets
                    .open(MANIFEST)
                    .bufferedReader()
                    .use { it.readText() }
            json.decodeFromString<BuiltinSourceManifest>(text).sources
        }.getOrElse { emptyList() }
    }

    fun list(): List<BuiltinSource> = sources

    fun find(id: String): BuiltinSource? = sources.firstOrNull { it.id == id }

    fun readScript(source: BuiltinSource): String? = readScript(source.scriptFile)

    private val scriptCache = java.util.concurrent.ConcurrentHashMap<String, String>()

    /** 同一份随包脚本只从 assets 读一次（播种时九个源都要读）。 */
    private fun readScript(scriptFile: String): String? =
        scriptCache.getOrPut(scriptFile) {
            runCatching {
                context.assets
                    .open("lx-sources/$scriptFile")
                    .bufferedReader()
                    .use { it.readText() }
            }.getOrNull() ?: return null
        }

    override fun scriptOf(id: String): String? = find(id)?.let { readScript(it) }

    /**
     * 随包清单 → 播种用的目录条目。
     *
     * `scriptUpdateUrl` 清单里没写时补读脚本头部注释：本地源（星海、animemusic）
     * 作者把地址写在头部，在线源则只有目录地址。
     */
    override fun definitions(): List<BuiltinSeedDefinition> =
        sources.map { source ->
            val script = readScript(source).orEmpty()
            BuiltinSeedDefinition(
                id = source.id,
                kind = source.kind,
                name = source.name,
                version = source.version,
                description = source.description,
                author = source.author,
                homepage = source.homepage,
                script = script,
                updateUrl = source.updateUrl,
                legacyUpdateUrls = source.legacyUpdateUrls,
                fallbackUpdateUrls = source.fallbackUpdateUrls,
                scriptUpdateUrl =
                    source.scriptUpdateUrl.ifEmpty {
                        ScriptResolver.parseScriptHeader(script)?.updateUrl.orEmpty()
                    },
                // 逐源 autoUpdate 是旧字段（全局设置才是事实来源），按「有没有可用地址」填
                autoUpdate =
                    source.autoCheck ||
                        source.updateUrl.isNotEmpty() ||
                        source.scriptUpdateUrl.isNotEmpty() ||
                        source.checkUpdateUrls.isNotEmpty(),
                checkUpdateUrls = source.checkUpdateUrls,
                autoCheck = source.autoCheck,
            )
        }

    /** 更新检查用的目录：备用线路与本地源的版本接口都来自随包清单。 */
    override fun updateCatalog(): BuiltinUpdateCatalog =
        BuiltinUpdateCatalog { id ->
            find(id)?.let { source ->
                BuiltinUpdateCatalogEntry(
                    kind = source.kind,
                    updateUrl = source.updateUrl,
                    legacyUpdateUrls = source.legacyUpdateUrls,
                    fallbackUpdateUrls = source.fallbackUpdateUrls,
                    checkUpdateUrls = source.checkUpdateUrls,
                    autoCheck = source.autoCheck,
                )
            }
        }
}
