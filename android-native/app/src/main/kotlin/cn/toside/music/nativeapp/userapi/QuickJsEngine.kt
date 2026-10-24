package cn.toside.music.nativeapp.userapi

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Message
import android.util.Log
import cn.toside.music.core.crypto.Crypto
import com.whl.quickjs.android.QuickJSLoader
import com.whl.quickjs.wrapper.QuickJSContext
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID

/** 一次脚本加载的入参（对照 RN `UserApiLoadInfo` 里 native 需要的字段）。 */
data class UserApiScriptInfo(
    val id: String,
    val name: String,
    val script: String,
    val description: String = "",
    val version: String = "",
    val author: String = "",
    val homepage: String = "",
    val loadSeq: String = "",
)

/**
 * QuickJS 引擎桥 —— RN `userApi/QuickJS.java` + `JavaScriptThread.java` 的 Kotlin 移植。
 *
 * 只负责「给脚本一个干净沙箱」：加载 preload、注入 native 工具函数、把脚本发起的
 * `request`/`cancelRequest`/`init` 等动作交给上层。HTTP 请求由 [UserApiHttp] 在
 * 别的线程执行，回到引擎线程后再调 `response`。
 *
 * 一个实例只服务一次加载：换脚本整只换掉（与 RN 一致），旧实例的事件一律丢弃。
 */
class QuickJsEngine(
    private val readPreloadScript: () -> String?,
    private val onEvent: (action: String, data: String?) -> Unit,
) {
    private companion object {
        const val MSG_ACTION = 1
        const val MSG_DESTROY = 2
        const val MSG_TIMEOUT = 3
        const val TAG = "UserApi"
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var context: QuickJSContext? = null
    private var key: String = ""
    private var scriptInited = false

    /** 被换掉的实例：事件和定时回调一律不再执行。 */
    @Volatile
    private var stopped = false

    fun load(info: UserApiScriptInfo) {
        val worker = HandlerThread("UserApiThread").apply { start() }
        thread = worker
        handler =
            object : Handler(worker.looper) {
                override fun handleMessage(msg: Message) {
                    when (msg.what) {
                        MSG_ACTION -> {
                            @Suppress("UNCHECKED_CAST")
                            val data = msg.obj as Array<Any?>
                            callJs(data[0] as String, data[1])
                        }
                        MSG_DESTROY -> {
                            destroyContext()
                            worker.quitSafely()
                        }
                        MSG_TIMEOUT -> {
                            if (!stopped) callJs("__set_timeout__", msg.obj)
                        }
                        else -> Log.w(TAG, "unknown message: ${msg.what}")
                    }
                }
            }
        handler!!.post { doLoad(info) }
    }

    /** 上层（Kotlin 侧）给脚本发动作：request / response / cancelRequest。 */
    fun sendAction(
        action: String,
        data: String?,
    ) {
        if (stopped) return
        handler?.obtainMessage(MSG_ACTION, arrayOf(action, data))?.sendToTarget()
    }

    /** 换脚本时先叫停：队列里剩下的消息也不再执行。 */
    fun stop() {
        stopped = true
    }

    fun destroy() {
        stop()
        handler?.obtainMessage(MSG_DESTROY)?.sendToTarget()
    }

    private fun doLoad(info: UserApiScriptInfo) {
        if (stopped) return
        try {
            QuickJSLoader.init()
            key = UUID.randomUUID().toString()
            val ctx = QuickJSContext.create()
            context = ctx
            ctx.setConsole(ConsoleBridge())
            ctx.getGlobalObject().setProperty("__lx_load_seq__", info.loadSeq)
            createEnvObject(ctx)
            val preload = readPreloadScript() ?: throw IllegalStateException("preload script missing")
            ctx.evaluate(preload)
            ctx.getGlobalObject().getJSFunction("lx_setup").call(
                key,
                info.id,
                info.name,
                info.description,
                info.version,
                info.author,
                info.homepage,
                info.script,
            )
            ctx.evaluate(info.script)
        } catch (e: Throwable) {
            Log.e(TAG, "load script failed: ${e.message}")
            if (!scriptInited) {
                scriptInited = true
                emit(
                    "init",
                    """{"info":null,"status":false,"errorMessage":"Create JavaScript Env Failed"}""",
                )
                emit("log", """{"type":"error","log":"${escapeJson(e.message ?: "script load failed")}"}""")
            } else {
                callJs("__run_error__", null)
            }
        }
    }

    private fun createEnvObject(ctx: QuickJSContext) {
        ctx.getGlobalObject().setProperty("__lx_native_call__") { args ->
            if (key == args[0]) callNative(args[1] as String, args[2] as String)
            null
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__utils_str2b64") { args ->
            runCatching {
                String(
                    Base64.getEncoder().encode((args[0] as String).toByteArray(Charsets.UTF_8)),
                    Charsets.UTF_8,
                )
            }.getOrElse {
                Log.e(TAG, "utils_str2b64 error: ${it.message}")
                ""
            }
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__utils_b642buf") { args ->
            runCatching {
                val bytes = Base64.getDecoder().decode(args[0] as String)
                bytes.joinToString(prefix = "[", postfix = "]", separator = ",") { it.toInt().toString() }
            }.getOrElse {
                Log.e(TAG, "utils_b642buf error: ${it.message}")
                ""
            }
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__utils_str2md5") { args ->
            runCatching {
                // 脚本传的是 encodeURIComponent 后的串，先还原再取摘要（对照 RN QuickJS.java）
                val text = URLDecoder.decode(args[0] as String, "UTF-8")
                val digest = MessageDigest.getInstance("MD5").digest(text.toByteArray(Charsets.UTF_8))
                digest.joinToString("") { "%02x".format(it) }
            }.getOrElse {
                Log.e(TAG, "utils_str2md5 error: ${it.message}")
                ""
            }
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__utils_aes_encrypt") { args ->
            runCatching {
                Crypto.aesEncrypt(args[0] as String, args[1] as String, args[2] as String, args[3] as String)
            }.getOrElse {
                Log.e(TAG, "utils_aes_encrypt error: ${it.message}")
                ""
            }
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__utils_rsa_encrypt") { args ->
            runCatching {
                Crypto.rsaEncrypt(args[0] as String, args[1] as String, args[2] as String)
            }.getOrElse {
                Log.e(TAG, "utils_rsa_encrypt error: ${it.message}")
                ""
            }
        }
        ctx.getGlobalObject().setProperty("__lx_native_call__set_timeout") { args ->
            val handler = handler
            if (handler == null || stopped) {
                null
            } else {
                handler.postDelayed({ if (!stopped) callJs("__set_timeout__", args[0]) }, (args[1] as Number).toLong())
                null
            }
        }
    }

    private fun callNative(
        action: String,
        data: String,
    ) {
        if (stopped) return
        if (action == "init") {
            if (scriptInited) return
            scriptInited = true
        }
        emit(action, data)
    }

    private fun callJs(
        action: String,
        data: Any?,
    ) {
        if (stopped) return
        val ctx = context ?: return
        runCatching {
            ctx.getGlobalObject().getJSFunction("__lx_native__").call(key, action, data)
        }.onFailure {
            Log.e(TAG, "call script error: ${it.message}")
            emit("log", """{"type":"error","log":"Call script error: ${escapeJson(it.message ?: "")}"}""")
        }
    }

    private fun emit(
        action: String,
        data: String?,
    ) {
        mainHandler.post {
            if (!stopped) onEvent(action, data)
        }
    }

    private fun destroyContext() {
        context?.let { runCatching { it.destroy() }.onFailure { e -> Log.w(TAG, "destroy error: ${e.message}") } }
        context = null
    }

    private inner class ConsoleBridge : QuickJSContext.Console {
        override fun log(info: String) = log("log", info)

        override fun info(info: String) = log("info", info)

        override fun warn(info: String) = log("warn", info)

        override fun error(info: String) = log("error", info)

        private fun log(
            type: String,
            message: String,
        ) {
            Log.d("$TAG Log", "[$type]$message")
            if (stopped) return
            emit("log", """{"type":"$type","log":"${escapeJson(message)}"}""")
        }
    }
}

private fun escapeJson(text: String): String =
    buildString {
        for (ch in text) {
            when (ch) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) append("\\u%04x".format(ch.code)) else append(ch)
            }
        }
    }
