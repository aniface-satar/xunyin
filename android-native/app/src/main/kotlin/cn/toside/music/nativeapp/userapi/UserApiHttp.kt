package cn.toside.music.nativeapp.userapi

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URI
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

/**
 * 音源脚本的 HTTP 执行器 —— 对应 RN `src/core/init/userApi/request.js`（global.fetch 那段）
 * 与 `handleRequestData` 的头/表单处理。
 *
 * 脚本通过 preload 的 `lx.request` 发 `request` 动作，这里在 IO 线程真正发请求，
 * 完成后回 `response` 动作。响应体与 RN 一致：能 JSON.parse 就给对象，否则给字符串；
 * binary 请求给 Base64（RN 给 Buffer，内置源取链用不到二进制，先记为已知差异）。
 */
class UserApiHttp(
    private val sendAction: (action: String, data: String) -> Unit,
) {
    private companion object {
        const val DEFAULT_TIMEOUT_MS = 13_000
        const val DEFAULT_UA =
            "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val json = Json { ignoreUnknownKeys = true }

    fun execute(
        requestKey: String,
        url: String,
        options: JsonObject,
    ) {
        scope.launch {
            val payload =
                try {
                    buildJsonObject {
                        put("requestKey", requestKey)
                        put("error", JsonNull)
                        put("response", perform(requestKey, url, options))
                    }
                } catch (e: Exception) {
                    buildJsonObject {
                        put("requestKey", requestKey)
                        put("error", e.message ?: "request failed")
                        put("response", JsonNull)
                    }
                } finally {
                    connections.remove(requestKey)
                }
            sendAction("response", payload.toString())
        }
    }

    fun cancel(requestKey: String) {
        connections.remove(requestKey)?.disconnect()
    }

    fun shutdown() {
        connections.values.forEach { runCatching { it.disconnect() } }
        connections.clear()
        scope.cancel()
    }

    private fun perform(
        requestKey: String,
        url: String,
        options: JsonObject,
    ): JsonObject {
        if (options["formData"] != null) throw IllegalArgumentException("formData is not supported")
        val method = options.stringOrNull("method")?.uppercase() ?: "GET"
        val timeout = options["timeout"]?.jsonPrimitive?.intOrNull ?: DEFAULT_TIMEOUT_MS
        val binary = options["binary"]?.jsonPrimitive?.booleanOrNull == true
        val body = buildRequestBody(options)

        val connection = URI.create(url).toURL().openConnection() as HttpURLConnection
        connections[requestKey] = connection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeout
            connection.readTimeout = timeout
            connection.instanceFollowRedirects = true
            connection.setRequestProperty("User-Agent", DEFAULT_UA)
            connection.setRequestProperty("Accept", "application/json")
            options["headers"]?.let { headers ->
                if (headers is JsonObject) {
                    for ((name, value) in headers) {
                        val text = (value as? JsonPrimitive)?.contentOrNull ?: continue
                        connection.setRequestProperty(name, text)
                    }
                }
            }
            if (body != null && method != "GET" && method != "HEAD") {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", body.contentType)
                connection.outputStream.use { it.write(body.bytes) }
            }
            val statusCode = connection.responseCode
            val statusMessage = connection.responseMessage ?: ""
            val headers =
                buildJsonObject {
                    for ((name, values) in connection.headerFields) {
                        if (name == null) continue
                        put(name.lowercase(), values.joinToString(", "))
                    }
                }
            val stream = if (statusCode >= 400) connection.errorStream else connection.inputStream
            val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
            return buildJsonObject {
                put("statusCode", statusCode)
                put("statusMessage", statusMessage)
                put("headers", headers)
                put("body", parseBody(bytes, binary))
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun parseBody(
        bytes: ByteArray,
        binary: Boolean,
    ): JsonElement {
        if (binary) return JsonPrimitive(Base64.getEncoder().encodeToString(bytes))
        val text = String(bytes, Charsets.UTF_8)
        return runCatching { json.parseToJsonElement(text) }.getOrElse { JsonPrimitive(text) }
    }

    private fun buildRequestBody(options: JsonObject): RequestBody? {
        options["form"]?.let { form ->
            if (form !is JsonObject) return null
            val encoded =
                form.entries.joinToString("&") { (name, value) ->
                    "${encode(name)}=${encode((value as? JsonPrimitive)?.contentOrNull ?: "")}"
                }
            return RequestBody(encoded.toByteArray(Charsets.UTF_8), "application/x-www-form-urlencoded")
        }
        val body = options["body"] ?: return null
        val text =
            if (body is JsonPrimitive && body.isString) {
                body.content
            } else {
                body.toString()
            }
        val contentType =
            options["headers"]
                ?.let { if (it is JsonObject) it["Content-Type"]?.jsonPrimitive?.contentOrNull else null }
                ?: if (body is JsonPrimitive) "text/plain; charset=utf-8" else "application/json"
        return RequestBody(text.toByteArray(Charsets.UTF_8), contentType)
    }

    private fun encode(text: String): String = java.net.URLEncoder.encode(text, "UTF-8")

    private data class RequestBody(
        val bytes: ByteArray,
        val contentType: String,
    )
}

internal fun JsonObject.stringOrNull(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
