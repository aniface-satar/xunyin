package cn.toside.music.nativeapp.userapi

import android.content.Context
import android.util.Log
import cn.toside.music.core.data.DataRepository
import cn.toside.music.core.data.MusicUrlCache
import cn.toside.music.core.music.PlayQuality
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.userapi.UpdateExecutor
import cn.toside.music.core.userapi.UserApiInfo
import cn.toside.music.nativeapp.data.DataStoreKvStore
import cn.toside.music.nativeapp.data.SettingsRuntime
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap
import kotlin.random.Random

/** 音源初始化后脚本声明的平台能力（对照 RN `info.sources[source]`）。 */
data class SourceSupport(
    val actions: List<String>,
    val qualitys: List<String>,
)

/**
 * 音源运行时 —— 对应 RN `src/core/init/userApi/index.ts` 的音源侧部分：
 * 加载内置脚本、等 init 事件、把取链请求转成脚本动作，并维护 requestKey 到协程的映射。
 *
 * 线程约定：所有入口都在主线程（[PlayerRuntime] 的 scope 是 Main.immediate），
 * 引擎事件也由 QuickJS 桥投递到主线程，因此状态无需额外加锁。
 */
class UserApiRuntime(
    context: Context,
) {
    private companion object {
        const val TAG = "UserApi"
        const val INIT_TIMEOUT_MS = 15_000L
        const val REQUEST_TIMEOUT_MS = 20_000L

        /** 日志页最多留这么多条（最新在前）。 */
        const val LOG_LIMIT = 200
    }

    private val appContext = context.applicationContext
    private val repository = BuiltinSourceRepository(appContext)

    /** 取链缓存落盘层（W6-1）：与设置层/列表层同一份 DataStore，只是另一个门面实例。 */
    private val data = DataRepository(ShardedKvStore(DataStoreKvStore(appContext)))

    /** 设置层（与设置页同一个进程级单例）：当前源 id 与音源更新三键都从这里读。 */
    private val settings = SettingsRuntime.get(appContext)

    /** 脚本落盘层：内置脚本来自 assets，用户导入的源、更新后的脚本与备份写在 KvStore。 */
    val store = UserApiSourceStore(DataStoreKvStore(appContext), repository)

    /** 该加载哪个源（设置里的当前源不在了就换一个还能用的）。 */
    private val selector = UserApiSourceSelector(store, settings.store)

    /**
     * 更新检查的设置 —— 来自设置层那三个键（对照 RN `common.userApiUpdateCheck` /
     * `common.userApiAutoUpdate` / `common.userApiAllowShowUpdateAlert`）。
     *
     * 设置还没从存储合并时读到的就是默认表里的值（每天检查、自动更新开、弹窗关）。
     */
    var updaterSettings: () -> UpdaterSettings = { UpdaterSettingsFrom.of(settings.store) }

    /** 取脚本正文（更新检查与「按地址导入」共用）。 */
    private val fetcher = NativeScriptFetcher()

    val updater =
        UserApiUpdater(
            store = store,
            fetcher = fetcher,
            syntaxChecker = QuickJsSyntaxChecker(),
            currentSourceId = { currentSourceId },
            reloadSource = { id, verify -> setSource(id, verify).isSuccess },
            settings = { updaterSettings() },
        )

    private val loadMutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }
    private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonObject>>()

    private var engine: QuickJsEngine? = null
    private var http: UserApiHttp? = null
    private var support: Map<String, SourceSupport> = emptyMap()

    var currentSourceId: String? = null
        private set

    /**
     * 音源日志（脚本自己打的日志 + 更新检查结果）——设置里的「音源日志」页读这份。
     *
     * 只留在内存里，最新一条在前，超过 [LOG_LIMIT] 条就丢掉最旧的：
     * 这份日志是排查用的，不值得为它写存储。
     */
    data class LogEntry(
        val time: Long,
        val type: String,
        val message: String,
    )

    private val _logs = MutableStateFlow<List<LogEntry>>(emptyList())
    val logs: StateFlow<List<LogEntry>> = _logs.asStateFlow()

    /**
     * 是否记下脚本自己打印的日志（对照 RN `global.lx.isEnableUserApiLog`，默认关、不持久化）。
     *
     * 只挡脚本自己 `console.*` 出来的那一路：一份源的日志能刷到上百行，
     * 默认全记会把真正有用的更新结论挤掉。更新检查/回滚这类结论不受这个开关影响，
     * RN 那边它们走的也是另一条日志通道。
     */
    var logsEnabled = false

    /**
     * 日志出口：默认把每条日志记进 [logs]。
     *
     * [PlayerRuntime] 会把更新执行的日志转发到这里，所以「检查更新失败」这类结论
     * 也能在日志页看到；外部接管这个钩子时，日志页就只剩脚本自己打的日志。
     */
    var onLog: ((type: String, message: String) -> Unit)? = { type, message ->
        val time = System.currentTimeMillis()
        _logs.value = (listOf(LogEntry(time, type, message)) + _logs.value).take(LOG_LIMIT)
    }

    var onUpdateAlert: ((name: String, log: String, updateUrl: String) -> Unit)? = null

    /** 清空日志页（RN 没有这项，纯为本机的排查便利）。 */
    fun clearLogs() {
        _logs.value = emptyList()
    }

    /** 源清单（内置 + 用户导入），设置里的音源管理页用。 */
    suspend fun sources(): List<UserApiInfo> = store.list()

    /** 切源：换脚本就整只换引擎（与 RN 一致）。失败时抛异常，调用方决定是否回退。 */
    suspend fun setSource(
        sourceId: String,
        verify: Boolean = false,
    ): Result<Unit> =
        loadMutex.withLock {
            val first = loadSource(sourceId, verify)
            // 自动更新写进去、还没被普通加载验证过的脚本起不来：先退回备份再用旧脚本试一次。
            // 验证加载（verify=true）不能走这里，失败要交给更新执行器结算。
            if (first.isFailure && !verify && store.verifyPending(sourceId)) {
                val rolledBack = runCatching { UpdateExecutor.rollbackScript(store, sourceId) }.getOrElse { false }
                store.setVerifyPending(sourceId, false)
                onLog?.invoke(
                    if (rolledBack) "info" else "error",
                    if (rolledBack) {
                        "user api rolled back to the previous script: $sourceId"
                    } else {
                        "user api rollback failed: $sourceId"
                    },
                )
                return@withLock loadSource(sourceId, verify = false)
            }
            first
        }

    private suspend fun loadSource(
        sourceId: String,
        verify: Boolean,
    ): Result<Unit> {
        val info = store.scriptInfo(sourceId) ?: return Result.failure(IllegalStateException("source not found: $sourceId"))
        teardown()

        val init = CompletableDeferred<Result<Unit>>()
        val newEngine =
            QuickJsEngine(readPreloadScript = { readAsset("script/user-api-preload.js") }) { action, data ->
                handleEvent(action, data, init)
            }
        val newHttp = UserApiHttp { action, data -> newEngine.sendAction(action, data) }
        engine = newEngine
        http = newHttp
        newEngine.load(info)
        val result = withTimeoutOrNull(INIT_TIMEOUT_MS) { init.await() }
        if (result == null || result.isFailure) {
            val error = result?.exceptionOrNull() ?: IllegalStateException("source init timeout")
            teardown()
            return Result.failure(error)
        }
        currentSourceId = sourceId
        // 普通加载成功：自动更新留下的「待验证」标记到此为止（验证加载不结算）
        if (!verify) store.setVerifyPending(sourceId, false)
        return Result.success(Unit)
    }

    /**
     * 取链缓存开关（W6-1，默认开）。
     *
     * RN 的缓存在 `online.ts/utils.ts` 里是无条件的（只有 `isRefresh` 才跳过），
     * 原生多给一个关闭位：真机上出现「换了音源还在放旧直链」这类问题时可一键绕过。
     */
    var musicUrlCacheEnabled: () -> Boolean = { true }

    /** 缓存新鲜度判定的时间源（默认系统时钟；测试可换）。 */
    var nowProvider: () -> Long = { System.currentTimeMillis() }

    /**
     * 取播放链接；脚本不可用或取链失败时返回 null（由 PlayerCore 走失败链路）。
     *
     * 缓存（W6-1）在**取链入口前后**拦截：命中直接返回（键 `<musicId>_<quality>`，
     * RN `data.ts:529` 同口径），未命中取链成功后写回一份。
     * `refresh = true`（刷新取链）时跳过读、仍写 —— 与 RN `isRefresh` 同语义。
     */
    suspend fun getMusicUrl(
        musicInfo: JsonObject,
        qualityProvider: () -> String,
        refresh: Boolean = false,
    ): String? {
        val source = musicInfo.text("source") ?: return null
        ensureReady()
        val support = support[source] ?: return null
        if ("musicUrl" !in support.actions) return null
        val meta = musicInfo["meta"] as? JsonObject
        val musicQualitys = (meta?.get("_qualitys") as? JsonObject)?.keys.orEmpty()
        val quality = PlayQuality.pick(qualityProvider(), musicQualitys, support.qualitys)
        val musicId = musicInfo.text("id")
        val cacheEnabled = musicUrlCacheEnabled()
        if (!refresh && cacheEnabled && musicId != null) {
            val cached =
                MusicUrlCache.pick(
                    runCatching { data.getMusicUrlEntry(musicId, quality) }.getOrNull(),
                    nowProvider(),
                )
            if (cached != null) {
                Log.d(TAG, "music url cache hit: $musicId $quality")
                return cached
            }
        }
        val result =
            sendScriptRequest(
                buildJsonObject {
                    put("source", source)
                    put("action", "musicUrl")
                    put(
                        "info",
                        buildJsonObject {
                            put("type", quality)
                            put("musicInfo", musicInfo)
                        },
                    )
                },
            )
        val url = (result["data"] as? JsonObject)?.text("url")
        if (!url.isNullOrEmpty() && cacheEnabled && musicId != null) {
            runCatching { data.saveMusicUrlEntry(musicId, quality, url, nowProvider()) }
        }
        return url
    }

    /** 歌词（B4 播放页接入时用），结构照 preload 的 verifyLyricInfo。 */
    suspend fun getLyric(musicInfo: JsonObject): JsonObject? {
        val source = musicInfo.text("source") ?: return null
        ensureReady()
        if (support[source]?.actions?.contains("lyric") != true) return null
        val result =
            sendScriptRequest(
                buildJsonObject {
                    put("source", source)
                    put("action", "lyric")
                    put(
                        "info",
                        buildJsonObject {
                            put("type", "128k")
                            put("musicInfo", musicInfo)
                        },
                    )
                },
            )
        return result["data"] as? JsonObject
    }

    fun release() {
        teardown()
    }

    private fun teardown() {
        engine?.destroy()
        http?.shutdown()
        engine = null
        http = null
        support = emptyMap()
        currentSourceId = null
        pending.clear()
    }

    /**
     * 启动时加载当前源（设置里的 `common.apiSource`）。
     *
     * 先播种再读：内置源第一次见到时要从随包目录补进清单；
     * 设置里那个源不在清单里（被下架、或用户删了）就按 [UserApiCatalog.pickAvailableId]
     * 换一个还能用的，并把换的结果写回设置。
     */
    suspend fun ensureSourceReady(): Result<Unit> {
        if (engine != null) return Result.success(Unit)
        settings.ensureLoaded()
        val removed = store.prepare()
        if (removed.isNotEmpty()) {
            onLog?.invoke("warn", "user api removed with the bundled catalog: ${removed.joinToString()}")
        }
        val target = selector.resolve() ?: return Result.failure(IllegalStateException("no user api source"))
        return setSource(target)
    }

    /**
     * 换到另一个源（音源管理页的「使用这个源」）。
     *
     * 脚本真的起来了才改设置里的当前源：起不来就留在原来那个上，
     * 免得设置指向一个加载失败的脚本，下次启动也没人兜底。
     */
    suspend fun switchSource(sourceId: String): Result<Unit> {
        val result = setSource(sourceId)
        if (result.isSuccess) selector.select(sourceId)
        return result
    }

    /**
     * 导入一份粘贴进来的脚本（对照 RN `ImportBtn` 的「本地导入」）。
     *
     * 头部注释不齐全时失败返回，不会往清单里塞一个加载不起来的源。
     */
    suspend fun importScript(
        script: String,
        updateUrl: String? = null,
    ): Result<UserApiInfo> = store.importScript(script, updateUrl)

    /** 按地址导入（对照 RN `ScriptImportOnline`）：取回的正文按「在线导入」入库，之后能自动检查。 */
    suspend fun importFromUrl(url: String): Result<UserApiInfo> {
        val target = url.trim()
        if (!target.startsWith("http://") && !target.startsWith("https://")) {
            return Result.failure(IllegalArgumentException("地址要以 http:// 或 https:// 开头"))
        }
        val response =
            runCatching { fetcher.fetch(target) }.getOrElse {
                return Result.failure(IllegalArgumentException("取不到脚本：${it.message ?: "网络错误"}"))
            }
        if (!response.ok) return Result.failure(IllegalArgumentException("取不到脚本：HTTP ${response.status}"))
        return importScript(response.body, target)
    }

    /**
     * 删掉一个源。两种情况不让删：
     * 正在用的那个（播放器会指着已经不存在的脚本），
     * 以及随包内置源（下次启动目录会把它补回来，删了只是看着像删了）。
     */
    suspend fun removeSource(sourceId: String): Boolean {
        if (sourceId == currentSourceId) return false
        if (store.find(sourceId)?.builtin != null) return false
        return store.removeSource(sourceId)
    }

    private suspend fun ensureReady() {
        if (engine != null) return
        val result = ensureSourceReady()
        if (result.isFailure) throw result.exceptionOrNull() ?: IllegalStateException("source init failed")
    }

    private suspend fun sendScriptRequest(data: JsonObject): JsonObject {
        val current = engine ?: throw IllegalStateException("source not ready")
        val requestKey = "request__${Random.nextLong().toString().substring(1)}"
        val deferred = CompletableDeferred<JsonObject>()
        pending[requestKey] = deferred
        current.sendAction(
            "request",
            buildJsonObject {
                put("requestKey", requestKey)
                put("data", data)
            }.toString(),
        )
        val response = withTimeoutOrNull(REQUEST_TIMEOUT_MS) { deferred.await() }
        pending.remove(requestKey)
        if (response == null) throw IllegalStateException("request timeout")
        if (response["status"]?.jsonPrimitive?.booleanOrNull != true) {
            throw IllegalStateException(response["errorMessage"]?.jsonPrimitive?.contentOrNull ?: "request failed")
        }
        return response["result"] as? JsonObject ?: throw IllegalStateException("empty response")
    }

    private fun handleEvent(
        action: String,
        data: String?,
        init: CompletableDeferred<Result<Unit>>,
    ) {
        val payload = data?.let { runCatching { json.parseToJsonElement(it) }.getOrNull() }
        when (action) {
            "init" -> handleInit(payload, init)
            "request" -> handleHttpRequest(payload)
            "cancelRequest" -> {
                val requestKey = (payload as? JsonPrimitive)?.contentOrNull
                if (requestKey != null) http?.cancel(requestKey)
            }
            "response" -> {
                val response = payload as? JsonObject ?: return
                val requestKey = response.text("requestKey") ?: return
                pending.remove(requestKey)?.complete(response)
            }
            "showUpdateAlert" -> {
                val alert = payload as? JsonObject ?: return
                onUpdateAlert?.invoke(
                    alert.text("name").orEmpty(),
                    alert.text("log").orEmpty(),
                    alert.text("updateUrl").orEmpty(),
                )
            }
            "log" -> {
                val entry = payload as? JsonObject ?: return
                val type = entry.text("type") ?: "log"
                val message = entry.text("log").orEmpty()
                Log.d("$TAG [${currentSourceId ?: "?"}]", "[$type]$message")
                // 脚本自己刷的日志按开关收（RN 的 isEnableUserApiLog），logcat 那条照旧
                if (logsEnabled) onLog?.invoke(type, message)
            }
            else -> Log.w(TAG, "unknown script action: $action")
        }
    }

    private fun handleInit(
        payload: JsonElement?,
        init: CompletableDeferred<Result<Unit>>,
    ) {
        val data = payload as? JsonObject
        val status = data?.get("status")?.jsonPrimitive?.booleanOrNull == true
        val info = data?.get("info") as? JsonObject
        if (!status || info == null) {
            val error = data?.text("errorMessage") ?: "source init failed"
            init.complete(Result.failure(IllegalStateException(error)))
            return
        }
        support = parseSupport(info["sources"] as? JsonObject)
        Log.d(TAG, "source inited: ${currentSourceId ?: "?"} -> ${support.keys}")
        init.complete(Result.success(Unit))
    }

    private fun parseSupport(sources: JsonObject?): Map<String, SourceSupport> {
        if (sources == null) return emptyMap()
        return buildMap {
            for ((name, value) in sources) {
                val entry = value as? JsonObject ?: continue
                if (entry.text("type") != "music") continue
                put(
                    name,
                    SourceSupport(
                        actions = entry.stringList("actions"),
                        qualitys = entry.stringList("qualitys"),
                    ),
                )
            }
        }
    }

    private fun handleHttpRequest(payload: JsonElement?) {
        val request = payload as? JsonObject ?: return
        val requestKey = request.text("requestKey") ?: return
        val url = request.text("url") ?: return
        val options = request["options"] as? JsonObject ?: JsonObject(emptyMap())
        http?.execute(requestKey, url, options)
    }

    private fun readAsset(path: String): String? =
        runCatching {
            appContext.assets
                .open(path)
                .bufferedReader()
                .use { it.readText() }
        }.getOrNull()

    private fun JsonObject.stringList(key: String): List<String> =
        (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
