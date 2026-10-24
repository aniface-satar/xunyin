package cn.toside.music.nativeapp.userapi

import android.content.Context
import android.util.Log
import cn.toside.music.core.music.PlayQuality
import cn.toside.music.core.userapi.UpdateExecutor
import cn.toside.music.nativeapp.data.DataStoreKvStore
import kotlinx.coroutines.CompletableDeferred
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
    }

    private val appContext = context.applicationContext
    private val repository = BuiltinSourceRepository(appContext)

    /** 脚本落盘层：内置脚本来自 assets，更新后的脚本与备份写在 KvStore。 */
    val store = UserApiSourceStore(DataStoreKvStore(appContext), repository)

    /** 设置层接线前先用 RN defaultSetting 的默认值（自动更新开、弹窗关、每天检查）。 */
    var updaterSettings: () -> UpdaterSettings = { UpdaterSettings() }

    val updater =
        UserApiUpdater(
            store = store,
            fetcher = NativeScriptFetcher(),
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

    var onLog: ((type: String, message: String) -> Unit)? = null
    var onUpdateAlert: ((name: String, log: String, updateUrl: String) -> Unit)? = null

    fun availableSources(): List<BuiltinSource> = store.list()

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

    /** 取播放链接；脚本不可用或取链失败时返回 null（由 PlayerCore 走失败链路）。 */
    suspend fun getMusicUrl(
        musicInfo: JsonObject,
        qualityProvider: () -> String,
    ): String? {
        val source = musicInfo.text("source") ?: return null
        ensureReady()
        val support = support[source] ?: return null
        if ("musicUrl" !in support.actions) return null
        val meta = musicInfo["meta"] as? JsonObject
        val musicQualitys = (meta?.get("_qualitys") as? JsonObject)?.keys.orEmpty()
        val quality = PlayQuality.pick(qualityProvider(), musicQualitys, support.qualitys)
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
        return (result["data"] as? JsonObject)?.text("url")
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

    /** 启动时加载默认源；失败结果交给调用方（启动检查仍可继续跑别的源）。 */
    suspend fun ensureSourceReady(): Result<Unit> {
        if (engine != null) return Result.success(Unit)
        return setSource(BuiltinSourceRepository.DEFAULT_SOURCE_ID)
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
                onLog?.invoke(type, message)
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
