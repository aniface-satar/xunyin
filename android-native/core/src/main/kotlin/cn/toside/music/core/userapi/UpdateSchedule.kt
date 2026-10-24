package cn.toside.music.core.userapi

import java.net.URLEncoder

/**
 * 「什么时候查更新、这次按什么顺序试哪些地址」—— RN
 * `src/core/userApiUpdate/schedule.ts` 的移植。
 *
 * 目录（内置源的备用线路、版本接口）通过 [BuiltinUpdateCatalog] 注入：
 * 这里只做排序与过滤，不依赖 app 的 assets。
 */
enum class UserApiUpdateCheckMode { OFF, STARTUP, DAILY, WEEKLY }

/** 内置源目录里参与更新检查的字段（对照 RN `catalog.ts` 的 definition）。 */
data class BuiltinUpdateCatalogEntry(
    val kind: String,
    val updateUrl: String = "",
    val legacyUpdateUrls: List<String> = emptyList(),
    val fallbackUpdateUrls: List<String> = emptyList(),
    val checkUpdateUrls: List<String> = emptyList(),
    val autoCheck: Boolean = false,
)

fun interface BuiltinUpdateCatalog {
    fun find(id: String): BuiltinUpdateCatalogEntry?

    companion object {
        val EMPTY: BuiltinUpdateCatalog = BuiltinUpdateCatalog { null }
    }
}

/** 一个源参与更新检查的地址与时间信息（对照 RN `UpdateUrlSource`）。 */
data class UpdateUrlSource(
    val id: String,
    /** "online" / "local"；自定义源没有目录条目，留空。 */
    val builtinKind: String? = null,
    val updateUrl: String = "",
    val scriptUpdateUrl: String = "",
    /** 当前脚本版本：目录补的检查地址里 {version} 会换成它。 */
    val version: String = "",
    /** 自动检查里已经被证明「取回的是别的音源脚本」的地址。 */
    val updateUrlRejected: String = "",
    val lastCheckAt: Long = 0L,
)

data class UpdateUrlPlan(
    val primary: List<String>,
    val fallback: List<String>,
)

data class UpdateUrlOptions(
    /** 手动更新里用户这次填的地址：只试它，不拿存档地址顶替。 */
    val overrideUrl: String? = null,
    /** 后台定时检查：本地内置源只试脚本自带的地址。 */
    val scheduled: Boolean = false,
)

object UpdateSchedule {
    private const val DAY_MS = 24 * 60 * 60 * 1000L

    val CHECK_MODES =
        listOf(
            UserApiUpdateCheckMode.OFF,
            UserApiUpdateCheckMode.STARTUP,
            UserApiUpdateCheckMode.DAILY,
            UserApiUpdateCheckMode.WEEKLY,
        )

    // jsDelivr 同一路径挂在不同 CDN 上，各边缘节点的缓存进度不一样：一个节点可能还停在旧版，
    // 也可能正好缓存到作者发布途中的半截脚本（语法检查会拒掉）。只给一个域名时，
    // 手机换不到能用的节点就只能一直报「新版脚本语法不完整」。
    private val JSDELIVR_HOSTS = listOf("fastly.jsdelivr.net", "gcore.jsdelivr.net", "cdn.jsdelivr.net")

    // GitHub raw 在国内基本连不上，同一份内容 jsDelivr 上就有：头部把导入地址写成 raw 的源
    // （落雪云）检查时补上镜像，不然后台每轮都只等到一次超时
    private val RAW_GITHUB_RXP = Regex("^https://raw\\.githubusercontent\\.com/([^/]+)/([^/]+)/([^/]+)/(.+)$", RegexOption.IGNORE_CASE)
    private val HTTP_URL_RXP = Regex("^https?://\\S+$", RegexOption.IGNORE_CASE)
    private val JSDELIVR_RXP = Regex("^(https?://)([^/]+)(/.*)$")

    /**
     * 到不该到这次检查的时候 —— 「每次启动」档不看时间，其余档按周期，
     * 时间戳为 0（从没查过）一律放行。
     *
     * 手机时间被往回调过会让 lastCheckAt 落在未来，严格按差值算会永远等不到下一次检查，
     * 所以负差值当作「该查了」处理。
     */
    fun shouldCheck(
        mode: UserApiUpdateCheckMode,
        lastCheckAt: Long,
        now: Long,
    ): Boolean =
        when (mode) {
            UserApiUpdateCheckMode.OFF -> false
            UserApiUpdateCheckMode.STARTUP -> true
            UserApiUpdateCheckMode.DAILY -> dueWithin(lastCheckAt, now, DAY_MS)
            UserApiUpdateCheckMode.WEEKLY -> dueWithin(lastCheckAt, now, 7 * DAY_MS)
        }

    private fun dueWithin(
        lastCheckAt: Long,
        now: Long,
        period: Long,
    ): Boolean {
        if (lastCheckAt == 0L) return true
        val elapsed = now - lastCheckAt
        if (elapsed < 0) return true
        return elapsed >= period
    }

    /**
     * 这一轮该查哪些源。
     *
     * 「自动更新源」是总开关：关掉就一个都不查；打开后只挑真正有更新地址的源，
     * 没地址的源不在后台空跑请求。频率档选「关闭」时同样一个都不挑。
     */
    fun pickCheckTargets(
        list: List<UpdateUrlSource>,
        mode: UserApiUpdateCheckMode,
        now: Long,
        autoUpdate: Boolean = true,
        catalog: BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY,
    ): List<UpdateUrlSource> {
        if (mode == UserApiUpdateCheckMode.OFF || !autoUpdate) return emptyList()
        return list.filter { api ->
            pickScheduledUpdateUrls(api, catalog).isNotEmpty() && shouldCheck(mode, api.lastCheckAt, now)
        }
    }

    private fun isHttpUrl(url: String): Boolean = HTTP_URL_RXP.matches(url)

    fun expandJsdelivrMirrors(url: String): List<String> {
        val matched = JSDELIVR_RXP.find(url)
        if (matched != null && matched.groupValues[2] in JSDELIVR_HOSTS) {
            val scheme = matched.groupValues[1]
            val host = matched.groupValues[2]
            val path = matched.groupValues[3]
            return listOf(host)
                .plus(JSDELIVR_HOSTS.filter { it != host })
                .map { "$scheme$it$path" }
        }
        val rawMatched = RAW_GITHUB_RXP.find(url)
        if (rawMatched != null) {
            val (owner, repo, ref, path) = rawMatched.destructured
            return listOf(url).plus(JSDELIVR_HOSTS.map { host -> "https://$host/gh/$owner/$repo@$ref/$path" })
        }
        return listOf(url)
    }

    /**
     * 这一次更新可以按什么顺序试哪些地址：用户在设置里填的最准，压过脚本自己报的；
     * 没填才轮得到脚本 —— 先这次上报的，再头部注释里存的。
     * 非 http(s) 的地址当没有，继续找下一个，不让一个坏地址挡住后面能用的。
     */
    fun pickUpdateUrls(
        api: UpdateUrlSource,
        eventUrl: String? = null,
    ): List<String> {
        val urls = mutableListOf<String>()
        for (url in listOf(api.updateUrl, eventUrl.orEmpty(), api.scriptUpdateUrl)) {
            if (!isHttpUrl(url)) continue
            for (candidate in expandJsdelivrMirrors(url)) {
                if (candidate !in urls) urls.add(candidate)
            }
        }
        return urls
    }

    fun pickUpdateUrl(
        api: UpdateUrlSource,
        eventUrl: String? = null,
    ): String = pickUpdateUrls(api, eventUrl).firstOrNull().orEmpty()

    /**
     * 同一条 jsDelivr 路径的镜像算同一组：地址是 fastly，实际报错可能来自 gcore，
     * 记下任何一条都应把整组挡掉，而不是换一个镜像接着撞。
     */
    private fun isSameMirrorGroup(
        a: String,
        b: String,
    ): Boolean {
        val group = expandJsdelivrMirrors(a)
        return expandJsdelivrMirrors(b).any { it in group }
    }

    /**
     * 这一次更新分两档试哪些地址。
     *
     * 主地址：用户填的 > 脚本这次报的 > 头部存的，jsDelivr 自动补镜像；
     * 内置在线源目录里的备用线路放第二档，只有主地址全军覆没才走。
     *
     * 手动更新时 overrideUrl 只试这一个；后台检查本地内置源只用脚本自带的地址，
     * 本地源头部没写地址时再用目录替作者记的版本接口（只给 autoCheck 的源加）。
     */
    fun planUpdateUrls(
        api: UpdateUrlSource,
        eventUrl: String? = null,
        options: UpdateUrlOptions = UpdateUrlOptions(),
        catalog: BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY,
    ): UpdateUrlPlan {
        val overrideUrl = options.overrideUrl
        if (overrideUrl != null) {
            return UpdateUrlPlan(
                primary = pickUpdateUrls(UpdateUrlSource(id = api.id, updateUrl = overrideUrl)),
                fallback = emptyList(),
            )
        }

        val entry = catalog.find(api.id)
        var primary: List<String>
        var fallback = mutableListOf<String>()
        val scheduledLocal = options.scheduled && api.builtinKind == "local"
        if (scheduledLocal) {
            primary = pickUpdateUrls(UpdateUrlSource(id = api.id, scriptUpdateUrl = api.scriptUpdateUrl))
        } else {
            primary = pickUpdateUrls(api, eventUrl)
            for (url in builtinFallbackUrls(api, entry)) {
                for (candidate in expandJsdelivrMirrors(url)) {
                    if (candidate !in primary && candidate !in fallback) fallback.add(candidate)
                }
            }
        }
        if (api.builtinKind == "local" && (!scheduledLocal || entry?.autoCheck == true)) {
            val extras = primary.toMutableList()
            for (candidate in builtinLocalUpdateUrls(api, entry)) {
                if (candidate !in extras && candidate !in fallback) extras.add(candidate)
            }
            primary = extras
        }
        val rejected = if (options.scheduled) api.updateUrlRejected else ""
        if (rejected.isNotEmpty()) {
            primary = primary.filter { !isSameMirrorGroup(it, rejected) }
            fallback = fallback.filter { !isSameMirrorGroup(it, rejected) }.toMutableList()
        }
        return UpdateUrlPlan(primary = primary, fallback = fallback)
    }

    fun pickScheduledUpdateUrls(
        api: UpdateUrlSource,
        catalog: BuiltinUpdateCatalog = BuiltinUpdateCatalog.EMPTY,
    ): List<String> {
        val plan = planUpdateUrls(api, options = UpdateUrlOptions(scheduled = true), catalog = catalog)
        return plan.primary + plan.fallback
    }

    /** 目录给的备用线路只在「地址还是目录写的」时才用，用户自己填的地址不猜备用线路。 */
    private fun builtinFallbackUrls(
        api: UpdateUrlSource,
        entry: BuiltinUpdateCatalogEntry?,
    ): List<String> {
        if (api.updateUrl.isEmpty() || entry == null || entry.kind != "online") return emptyList()
        val owned = api.updateUrl == entry.updateUrl || api.updateUrl in entry.legacyUpdateUrls
        return if (owned) entry.fallbackUpdateUrls else emptyList()
    }

    private fun builtinLocalUpdateUrls(
        api: UpdateUrlSource,
        entry: BuiltinUpdateCatalogEntry?,
    ): List<String> {
        if (entry == null || entry.kind != "local") return emptyList()
        return entry.checkUpdateUrls.map { url ->
            if ("{version}" !in url) url else url.replace("{version}", encodeComponent(api.version))
        }
    }

    // encodeURIComponent 的空格是 %20，URLEncoder 给的是 '+'
    private fun encodeComponent(text: String): String = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
}
