package cn.toside.music.core.music.search

import kotlinx.serialization.json.JsonObject

/** Transport-neutral HTTP request built by a search source. */
data class SearchRequest(
    val url: String,
    val method: String = "GET",
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
    val form: Map<String, String>? = null,
)

/** RN-compatible single-source search result. */
data class SearchPage(
    val list: List<JsonObject>,
    val total: Int,
    val allPage: Int,
    val limit: Int,
    val source: String,
)
