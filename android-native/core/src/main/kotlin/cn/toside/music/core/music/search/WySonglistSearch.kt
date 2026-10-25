package cn.toside.music.core.music.search

import cn.toside.music.core.crypto.Crypto
import cn.toside.music.core.songlist.asArray
import cn.toside.music.core.songlist.asInt
import cn.toside.music.core.songlist.asLong
import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.util.Base64

/**
 * 网易云歌单搜索（对照 RN `utils/musicSdk/wy/songList.js#search`）。
 *
 * 与单曲搜索一样走 eapi/batch（`/api/cloudsearch/pc`，type=1000）。
 * `code != 200` 视为失败（RN `throw new Error('filed')`），没有内部重试。
 *
 * 实测：服务端接受 PKCS#7 补齐（即 JCE 的 PKCS5Padding）；RN 的 NoPadding
 * 对非 16 字节对齐的载荷会直接抛错，因此这里沿用单曲 [WySearch] 的补齐方式。
 */
class WySonglistSearch(
    private val fetch: suspend (SearchRequest) -> String,
) {
    suspend fun search(
        keyword: String,
        page: Int = 1,
        limit: Int = DEFAULT_LIMIT,
    ): SonglistSearchPage =
        checkNotNull(parse(fetch(buildRequest(keyword, page, limit)), page, limit)) {
            "wy songlist search failed"
        }

    companion object {
        const val DEFAULT_LIMIT = SonglistSearchAggregator.SOURCE_LIMIT
        private const val SEARCH_PATH = "/api/cloudsearch/pc"
        private const val USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/60.0.3112.90 Safari/537.36"
        private val json = Json { ignoreUnknownKeys = true }

        fun buildRequest(
            keyword: String,
            page: Int,
            limit: Int,
        ): SearchRequest {
            val body =
                buildJsonObject {
                    put("s", keyword)
                    put("type", 1000)
                    put("limit", limit)
                    put("total", page == 1)
                    put("offset", limit * (page - 1))
                }.toString()
            val message = "nobody${SEARCH_PATH}use${body}md5forencrypt"
            val digest = md5(message)
            val plain = "$SEARCH_PATH-36cd479b6b5-$body-36cd479b6b5-$digest".toByteArray(Charsets.UTF_8)
            val encrypted =
                Crypto.aesEncrypt(
                    plain,
                    "e82ckenh8dichen8".toByteArray(Charsets.UTF_8),
                    null,
                    "AES/ECB/PKCS5Padding",
                )
            val params =
                Base64
                    .getDecoder()
                    .decode(encrypted)
                    .joinToString("") { "%02X".format(it) }
            return SearchRequest(
                url = "http://interface.music.163.com/eapi/batch",
                method = "POST",
                headers =
                    mapOf(
                        "User-Agent" to USER_AGENT,
                        "origin" to "https://music.163.com",
                        "Content-Type" to "application/x-www-form-urlencoded",
                    ),
                form = mapOf("params" to params),
            )
        }

        fun parse(
            body: String,
            page: Int,
            limit: Int,
        ): SonglistSearchPage? {
            val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
            if (root["code"].asInt() != 200) return null
            val result = root["result"] as? JsonObject ?: return null
            val total = result["playlistCount"].asInt() ?: 0
            val raw = result["playlists"].asArray()
            val list =
                raw.mapNotNull { element ->
                    val item = element as? JsonObject ?: return@mapNotNull null
                    toItem(item)
                }
            return SonglistSearchPage(
                list = list,
                total = total,
                allPage = if (total == 0) 0 else (total + limit - 1) / limit,
                limit = limit,
                source = "wy",
            )
        }

        private fun toItem(item: JsonObject): SonglistSearchItem? {
            val id = item.text("id")
            if (id.isEmpty()) return null
            val creator = item["creator"] as? JsonObject
            val createTime = item["createTime"].asLong()
            return SonglistSearchItem(
                id = id,
                name = item.text("name"),
                author = creator?.get("nickname").text(),
                playCount = SonglistSearchSupport.playCount(item["playCount"].asLong() ?: 0L),
                total = item["trackCount"].asInt() ?: 0,
                img = SonglistSearchSupport.nullableText(item.text("coverImgUrl")),
                desc = item.text("description"),
                time = createTime?.let { SonglistSearchSupport.date(it.toString()) }.orEmpty(),
                source = "wy",
                grade = SonglistSearchSupport.nullableText(item.text("grade")),
            )
        }

        private fun md5(value: String): String =
            MessageDigest
                .getInstance("MD5")
                .digest(value.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }
}
