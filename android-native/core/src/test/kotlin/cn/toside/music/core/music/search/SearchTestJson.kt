package cn.toside.music.core.music.search

import cn.toside.music.core.songlist.text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** 专辑/歌手黄金测试共用的小取值器（与主源码的 `text(key)` 同义，测试侧独立声明）。 */
internal fun JsonObject.str(key: String): String = this[key].text()

internal fun JsonObject.arr(key: String): List<JsonObject> = (this[key] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()

internal fun JsonObject.int(key: String): Int = this[key].text().trim().toIntOrNull() ?: 0

internal fun JsonObject.primitiveList(key: String): List<String> =
    (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()
