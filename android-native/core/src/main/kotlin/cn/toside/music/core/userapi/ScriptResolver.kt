package cn.toside.music.core.userapi

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * 音源更新地址 → 音源脚本 —— RN `src/core/userApiUpdate/resolveScript.ts` 的移植。
 *
 * 作者填的 updateUrl 可能是脚本直链、版本接口、GitHub 页或网盘页，这里不假设它是什么：
 * 取回内容后按「是不是音源脚本」判断，不是就从内容里能找到的链接继续找，
 * 找不到就明确报失败 —— 宁可退回人工打开，也不把 HTML 当成脚本写回源里。
 */
data class ScriptHeaderInfo(
    val name: String,
    val version: String,
    val description: String,
    val author: String,
    val homepage: String,
    val updateUrl: String,
    val buildTime: Long,
)

/** 更新页里只给了版本号、没给能下载的脚本时，拿它和本地版本比一比。 */
data class VersionDescriptor(
    val version: String,
    val url: String,
)

data class ScriptFetchResponse(
    val ok: Boolean,
    val status: Int,
    val body: String,
)

fun interface ScriptFetcher {
    suspend fun fetch(url: String): ScriptFetchResponse
}

data class ScriptResolveOptions(
    val fetcher: ScriptFetcher,
    val hint: String? = null,
    val maxRequests: Int = DEFAULT_MAX_REQUESTS,
    /** 本地脚本版本：版本接口明确说不比它新时，不用再顺着作者的更新页爬。 */
    val currentVersion: String? = null,
) {
    companion object {
        const val DEFAULT_MAX_REQUESTS = 8
    }
}

enum class ResolveFailureReason { INVALID_URL, FETCH_FAILED, NO_SCRIPT_LINK, NO_UPDATE, BUDGET_EXCEEDED }

sealed interface ScriptResolveResult {
    data class Success(
        val script: String,
        val fromUrl: String,
        val requests: Int,
    ) : ScriptResolveResult

    data class Failure(
        val reason: ResolveFailureReason,
        val message: String,
        val descriptor: VersionDescriptor? = null,
    ) : ScriptResolveResult
}

object ScriptResolver {
    // 官方 matchInfo 从第 0 位严格匹配 /*，带 BOM 或前导空行的脚本会被误判成「不是脚本」，这里放宽。
    // 只放宽到 BOM 与空白：再宽就会把 HTML 里随便一段注释当成人家脚本的头部。
    private val HEADER_RXP = Regex("^\\s*/\\*[\\s\\S]+?\\*/")
    private val INFO_LINE_RXP = Regex("^\\s?\\*\\s?@(\\w+)\\s(.+)$")

    // 只认带时分秒的完整时间：作者常用的 @lastUpdate 2026-08-18 这种日期不是构建时间
    private val BUILD_TIME_RXP = Regex("\\b(20\\d{2})[-/.](\\d{1,2})[-/.](\\d{1,2})[ T](\\d{1,2}):(\\d{2}):(\\d{2})\\b")
    private val HTTP_URL_RXP = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)
    private val NON_HTTP_SCHEME_RXP = Regex("^(?:javascript|data|mailto|tel):", RegexOption.IGNORE_CASE)
    private val HTTP_SCHEME_RXP = Regex("^https?://", RegexOption.IGNORE_CASE)
    private val BASE_SCHEME_RXP = Regex("^(\\w+):")
    private val BASE_ROOT_RXP = Regex("^(https?://[^/]+)", RegexOption.IGNORE_CASE)
    private val GITHUB_BLOB_RXP =
        Regex("^https://github\\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)$", RegexOption.IGNORE_CASE)
    private val NOT_SCRIPT_RXP =
        Regex(
            "\\.(?:css|less|scss|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp[34]|zip|rar|7z|apk)(?:[?#]|\$)",
            RegexOption.IGNORE_CASE,
        )
    private val SCRIPT_LINK_RXP = Regex("\\.js(?:[?#]|\$)", RegexOption.IGNORE_CASE)
    private val HTML_LINK_RXP = Regex("(?:href|src)\\s*=\\s*[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE)
    private val CANDIDATE_KEY_RXP = Regex("(?:url|link|download|src|file)", RegexOption.IGNORE_CASE)

    // 版本检查接口在「已是最新」时往往只回一句话、不给任何脚本地址（HYW 就是 code:0 + 已是最新版本）。
    private val NO_UPDATE_RXP =
        Regex(
            "已是最新|最新版本|没有新版本|无更新|no\\s*update|up[-\\s]?to[-\\s]?date|" +
                "already\\s+(?:the\\s+)?latest|latest\\s+version",
            RegexOption.IGNORE_CASE,
        )

    private val DESCRIPTOR_VERSION_KEYS = setOf("version", "latest", "latestversion", "newversion")
    private val DESCRIPTOR_URL_KEYS = setOf("updateurl", "download", "downloadurl", "url", "link", "src", "file")
    private val NULL_UPDATE_URL_KEYS = setOf("updateurl", "downloadurl", "download", "scripturl")

    private val json = Json { ignoreUnknownKeys = true }

    fun matchHeaderComment(content: String): String? {
        val body = if (content.isNotEmpty() && content[0] == '\uFEFF') content.substring(1) else content
        val matched = HEADER_RXP.find(body) ?: return null
        // 放宽只为了认得带 BOM / 前导空行的脚本，交出去的仍然是从 /* 开头的那段注释
        return matched.value.trimStart()
    }

    fun parseScriptHeader(content: String): ScriptHeaderInfo? {
        val comment = matchHeaderComment(content) ?: return null
        val infos = mutableMapOf<String, String>()
        for (line in comment.split(Regex("\\r?\\n"))) {
            val matched = INFO_LINE_RXP.find(line) ?: continue
            // 作者们写 @updateUrl、@update_url、@UpdateUrl 的都有；归一化后精确匹配 updateurl，
            // 这样 @update（更新说明）不会被当成更新地址去请求
            val key = matched.groupValues[1].replace("_", "").lowercase()
            val value = matched.groupValues[2].trim()
            if (infos[key].isNullOrEmpty()) infos[key] = value
        }
        return ScriptHeaderInfo(
            name = infos["name"].orEmpty(),
            version = infos["version"].orEmpty(),
            description = infos["description"].orEmpty(),
            author = infos["author"].orEmpty(),
            homepage = infos["homepage"].orEmpty(),
            updateUrl = infos["updateurl"].orEmpty(),
            buildTime = parseBuildTime(comment),
        )
    }

    suspend fun resolveScriptFromUrl(
        url: String,
        options: ScriptResolveOptions,
    ): ScriptResolveResult {
        if (!isHttpUrl(url)) {
            return ScriptResolveResult.Failure(ResolveFailureReason.INVALID_URL, "更新地址不是 http(s) 链接")
        }

        val queue = ArrayDeque<String>()
        queue.add(url)
        val visited = mutableSetOf<String>()
        var requests = 0
        var fetchedAny = false
        var failedStatus = ""
        var descriptor: VersionDescriptor? = null

        fun fail(
            reason: ResolveFailureReason,
            message: String,
        ): ScriptResolveResult.Failure = ScriptResolveResult.Failure(reason, message, descriptor)

        while (queue.isNotEmpty()) {
            if (requests >= options.maxRequests) {
                return fail(ResolveFailureReason.BUDGET_EXCEEDED, "试过 $requests 个地址，仍没找到音源脚本")
            }
            val target = queue.removeFirst()
            if (!visited.add(target)) continue
            requests++

            val content =
                try {
                    val response = options.fetcher.fetch(target)
                    if (!response.ok) {
                        if (!fetchedAny) failedStatus = response.status.toString()
                        continue
                    }
                    fetchedAny = true
                    response.body
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (!fetchedAny) failedStatus = e.message ?: "unknown"
                    continue
                }

            if (isScript(content)) {
                return ScriptResolveResult.Success(content, target, requests)
            }
            val pageDescriptor = parseVersionDescriptor(content, target)
            if (descriptor == null) descriptor = pageDescriptor
            val candidates = collectCandidates(target, content)
            val jsonBody = parseJsonOrNull(content)
            val hasScriptLink = candidates.any(::isScriptLink)
            // 候选里还有能下载的脚本链接时继续爬：接口一边说「已最新」一边给得出脚本的，以脚本为准
            if (!hasScriptLink && isNoUpdateResponse(content, jsonBody, pageDescriptor != null)) {
                return fail(ResolveFailureReason.NO_UPDATE, "更新地址显示已经是最新版本")
            }
            // 长青/念心/聚合 API 这类地址本身就带着版本号，更新页只是给人看的文档。
            // 版本不比本地新、页面上又没有脚本可下载时，到这里就可以说「已是最新」
            val pageVersion = pageDescriptor?.version
            if (options.currentVersion != null && !pageVersion.isNullOrEmpty() && !hasScriptLink) {
                val compared = VersionCompare.compare(pageVersion, options.currentVersion)
                if (compared != null && compared <= 0) {
                    return fail(ResolveFailureReason.NO_UPDATE, "更新地址显示已经是最新版本")
                }
            }
            queue.addAll(rankCandidates(candidates, options.hint).filter { it !in visited })
        }

        if (!fetchedAny) {
            return fail(ResolveFailureReason.FETCH_FAILED, "更新地址取不到（${describeFetchFailure(failedStatus)}）")
        }
        return fail(ResolveFailureReason.NO_SCRIPT_LINK, "更新地址里没有可用的音源脚本链接")
    }

    private fun isScript(content: String): Boolean {
        val header = parseScriptHeader(content) ?: return false
        // 只是「以块注释开头」不算：网页引用的 zepto 这类库也有块注释，但没有任何 lx 头部字段
        return header.name.isNotEmpty() && header.version.isNotEmpty()
    }

    private fun isHttpUrl(url: String): Boolean = HTTP_URL_RXP.matches(url)

    // AbortController 中断时各运行时给的 message 就是英文的 Aborted，直接摆给用户看不懂
    private fun describeFetchFailure(status: String): String =
        when (status) {
            "Aborted" -> "请求超时"
            else -> status.ifEmpty { "网络错误" }
        }

    // 相对路径补全：不依赖 URL 构造器，按更新地址自己拼
    private fun resolveUrl(
        base: String,
        href: String,
    ): String? {
        val link = href.trim()
        if (link.isEmpty() || link.startsWith("#") || NON_HTTP_SCHEME_RXP.containsMatchIn(link)) return null
        if (HTTP_SCHEME_RXP.containsMatchIn(link)) return link
        if (link.startsWith("//")) {
            val scheme = BASE_SCHEME_RXP.find(base)?.groupValues?.get(1) ?: "https"
            return "$scheme:$link"
        }
        val baseRoot = BASE_ROOT_RXP.find(base)?.groupValues?.get(1) ?: return null
        if (link.startsWith("/")) return baseRoot + link
        val basePath = base.substring(baseRoot.length).split("?")[0].split("#")[0]
        val dir = basePath.substring(0, basePath.lastIndexOf('/') + 1)
        return "$baseRoot$dir$link"
    }

    // GitHub 的 blob 页给人看，raw 才是脚本本体
    private fun githubRawOf(url: String): String? {
        val matched = GITHUB_BLOB_RXP.find(url) ?: return null
        val (owner, repo, branch, path) = matched.destructured
        return "https://raw.githubusercontent.com/$owner/$repo/$branch/$path"
    }

    private fun collectCandidates(
        url: String,
        content: String,
    ): List<String> {
        val links = LinkedHashSet<String>()

        fun add(href: String?) {
            if (href == null) return
            val resolved = resolveUrl(url, href) ?: return
            if (!isHttpUrl(resolved) || resolved == url) return
            links.add(resolved)
        }

        githubRawOf(url)?.let(::add)

        val body = parseJsonOrNull(content)
        if (body != null) {
            walkCandidates(body, "", 0, ::add)
            return links.toList()
        }

        for (matched in HTML_LINK_RXP.findAll(content)) add(matched.groupValues[1])
        return links.filter { !NOT_SCRIPT_RXP.containsMatchIn(it) }
    }

    private fun walkCandidates(
        value: JsonElement,
        key: String,
        depth: Int,
        add: (String?) -> Unit,
    ) {
        if (depth > 4) return
        when (value) {
            is JsonArray -> value.forEach { walkCandidates(it, key, depth + 1, add) }
            is JsonObject -> value.forEach { (childKey, child) -> walkCandidates(child, childKey, depth + 1, add) }
            is JsonPrimitive -> if (value.isString && CANDIDATE_KEY_RXP.containsMatchIn(key)) add(value.content)
        }
    }

    /**
     * 从 JSON 里找「版本 + 更新页」描述。
     *
     * 描述可能出现一层（念心/长青）或嵌在 data 里（HYW），所以按对象树往下找。
     */
    private fun parseVersionDescriptor(
        content: String,
        baseUrl: String,
    ): VersionDescriptor? {
        val body = parseJsonOrNull(content) ?: return null
        return visitDescriptor(body, baseUrl, 0)
    }

    private fun visitDescriptor(
        value: JsonElement,
        baseUrl: String,
        depth: Int,
    ): VersionDescriptor? {
        if (depth > 4 || value is JsonNull || (value !is JsonObject && value !is JsonArray)) return null
        if (value is JsonObject) {
            var version = ""
            var url = ""
            for ((key, field) in value) {
                val normalized = normalizeKey(key)
                if (version.isEmpty() && normalized in DESCRIPTOR_VERSION_KEYS) {
                    val text = versionText(field)
                    if (text.isNotEmpty()) version = text
                }
                if (url.isEmpty() && normalized in DESCRIPTOR_URL_KEYS && field is JsonPrimitive && field.isString) {
                    val resolved = resolveUrl(baseUrl, field.content)
                    if (resolved != null && isHttpUrl(resolved)) url = resolved
                }
            }
            if (version.isNotEmpty()) return VersionDescriptor(version, url)
        }
        val children = if (value is JsonArray) value else (value as JsonObject).values
        for (child in children) {
            visitDescriptor(child, baseUrl, depth + 1)?.let { return it }
        }
        return null
    }

    // 版本描述字段各家写法不同：念心/长青用 version，玉宁熙用 latest；下划线归一化后比较
    private fun versionText(field: JsonElement): String {
        if (field !is JsonPrimitive || !isStringOrNumber(field)) return ""
        val text = field.content.trim()
        return if (text.isNotEmpty() && text.length <= 64) text else ""
    }

    // JS 的 typeof x === 'number'：JSON 里的布尔和 null 不能当版本号
    private fun isStringOrNumber(field: JsonPrimitive): Boolean =
        field.isString || (field !is JsonNull && field.content.toDoubleOrNull() != null)

    private fun normalizeKey(key: String): String = key.replace("_", "").lowercase()

    /**
     * 也有人家的提示语根本不让正则认（星海用 GBK 编码，UTF-8 解码后全是乱码），
     * 但 JSON 里把更新地址字段显式回成 null —— 结构上就是「这次没有可推送的更新」。
     * 只在整份 JSON 里没有任何版本信息时才算：带着版本号的接口不能靠这条吞掉。
     */
    private fun hasNullUpdateUrl(
        value: JsonElement,
        depth: Int,
    ): Boolean {
        if (depth > 4 || value is JsonNull) return false
        if (value is JsonArray) return value.any { hasNullUpdateUrl(it, depth + 1) }
        if (value is JsonObject) {
            if (value.any { (key, field) -> field is JsonNull && normalizeKey(key) in NULL_UPDATE_URL_KEYS }) return true
            return value.any { (_, field) -> hasNullUpdateUrl(field, depth + 1) }
        }
        return false
    }

    private fun isNoUpdateResponse(
        content: String,
        body: JsonElement?,
        hasDescriptor: Boolean,
    ): Boolean {
        if (body !is JsonObject && body !is JsonArray) return false
        if (body is JsonObject) {
            // 也有人家的接口什么话都不说，只回 {"code":200,"data":null} 表示“没有可推送的更新”
            val code = body["code"]
            if (code is JsonPrimitive && code !is JsonNull && code.content.trim().toDoubleOrNull() == 200.0) {
                if (!body.containsKey("data") || body["data"] is JsonNull) return true
            }
        }
        if (!hasDescriptor && hasNullUpdateUrl(body, 0)) return true
        return NO_UPDATE_RXP.containsMatchIn(content)
    }

    private fun isScriptLink(link: String): Boolean = SCRIPT_LINK_RXP.containsMatchIn(link)

    private fun rankCandidates(
        candidates: List<String>,
        hint: String?,
    ): List<String> {
        val key = hint?.trim()?.lowercase().orEmpty()

        // 更新页里既有脚本又有说明页/图片时，先拿脚本；名字像当前源的再往前排。
        // 同一档内保持页面里的文档顺序（作者通常把最新版放最前面）。
        fun score(link: String): Int {
            val normalized = link.lowercase()
            return (if (isScriptLink(normalized)) 0 else 2) + (if (key.isNotEmpty() && normalized.contains(key)) -1 else 0)
        }
        return candidates
            .withIndex()
            .sortedWith(compareBy({ score(it.value) }, { it.index }))
            .map { it.value }
    }

    // kotlinx.serialization 的 SerializationException 本身就是 IllegalArgumentException
    private fun parseJsonOrNull(content: String): JsonElement? =
        try {
            json.parseToJsonElement(content)
        } catch (_: IllegalArgumentException) {
            null
        }

    private fun parseBuildTime(comment: String): Long {
        val matched = BUILD_TIME_RXP.find(comment) ?: return 0
        val (year, month, day, hour, minute, second) = matched.destructured
        return runCatching {
            val local =
                LocalDateTime.of(
                    year.toInt(),
                    month.toInt(),
                    day.toInt(),
                    hour.toInt(),
                    minute.toInt(),
                    second.toInt(),
                )
            local.toInstant(ZoneOffset.UTC).toEpochMilli()
        }.getOrDefault(0)
    }
}
