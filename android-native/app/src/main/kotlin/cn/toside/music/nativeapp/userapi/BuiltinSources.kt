package cn.toside.music.nativeapp.userapi

import android.content.Context
import cn.toside.music.core.userapi.BuiltinUpdateCatalog
import cn.toside.music.core.userapi.BuiltinUpdateCatalogEntry
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
 * 随包内置音源脚本（`android-native/tools/export-builtin-sources.mjs` 从 RN
 * `src/config/builtinSources/scripts.ts` 导出）。脚本是纯 JS，运行时完全一致。
 */
class BuiltinSourceRepository(
    private val context: Context,
) {
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

    fun readScript(source: BuiltinSource): String? =
        runCatching {
            context.assets
                .open("lx-sources/${source.scriptFile}")
                .bufferedReader()
                .use { it.readText() }
        }.getOrNull()

    /** 更新检查用的目录：备用线路与本地源的版本接口都来自随包清单。 */
    fun updateCatalog(): BuiltinUpdateCatalog =
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
