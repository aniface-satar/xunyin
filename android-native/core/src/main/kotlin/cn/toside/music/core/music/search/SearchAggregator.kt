package cn.toside.music.core.music.search

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Pure RN-compatible accumulation rules for single-source and all-source search. */
object SearchAggregator {
    private const val ALL_LIMIT = 30

    fun emptyPage(
        source: String,
        limit: Int = ALL_LIMIT,
    ): SearchPage = SearchPage(emptyList(), total = 0, allPage = 1, limit = limit, source = source)

    fun single(
        current: SearchPage,
        page: Int,
        previous: SearchPage? = null,
    ): SearchPage {
        val combined = if (page == 1) current.list else previous?.list.orEmpty() + current.list
        val total =
            if (page == 1 || (current.total != 0 && current.list.isNotEmpty())) {
                current.total
            } else {
                current.limit * page
            }
        return current.copy(list = deduplicate(combined), total = total)
    }

    fun all(
        keyword: String,
        results: List<SearchPage>,
        page: Int,
        previous: SearchPage? = null,
    ): SearchPage {
        val current = mutableListOf<JsonObject>()
        val pages = mutableListOf<Int>()
        val totals = mutableListOf<Int>()
        var maxLimit = 0
        results.forEach { result ->
            maxLimit = maxOf(maxLimit, result.limit)
            if (result.allPage < page) return@forEach
            current.addAll(result.list)
            pages.add(result.allPage)
            totals.add(result.total)
        }
        val sorted = sortBySimilarity(current, keyword)
        val combined = if (page == 1) sorted else previous?.list.orEmpty() + sorted
        val maxPage = pages.maxOrNull() ?: 0
        val maxTotal = totals.maxOrNull() ?: 0
        val total =
            if (page == 1 || (maxTotal != 0 && sorted.isNotEmpty())) {
                maxTotal
            } else {
                maxLimit * page
            }
        return SearchPage(
            list = deduplicate(combined),
            total = total,
            allPage = maxPage,
            limit = previous?.limit ?: ALL_LIMIT,
            source = "all",
        )
    }

    private fun sortBySimilarity(
        list: List<JsonObject>,
        keyword: String,
    ): List<JsonObject> {
        val sorted = mutableListOf<Scored>()
        list.forEach { item ->
            val name = item["name"].text()
            val singer = item["singer"].text()
            sortInsert(sorted, Scored(similar(keyword, "$name $singer"), item))
        }
        return sorted.asReversed().map { it.data }
    }

    private fun sortInsert(
        list: MutableList<Scored>,
        data: Scored,
    ) {
        val key = data.score
        var left = 0
        var right = list.lastIndex
        while (left <= right) {
            val middle = (left + right) / 2
            when {
                key == list[middle].score -> {
                    left = middle
                    break
                }

                key < list[middle].score -> right = middle - 1
                else -> left = middle + 1
            }
        }
        while (left > 0 && list[left - 1].score == key) left--
        list.add(left, data)
    }

    private fun similar(
        a: String,
        b: String,
    ): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val first = if (a.length > b.length) b else a
        val second = if (a.length > b.length) a else b
        val distances = IntArray(second.length + 1) { it }
        for (i in 1..first.length) {
            val char = first[i - 1]
            var diagonal = distances[0]
            distances[0]++
            for (j in 1..second.length) {
                val next =
                    minOf(
                        distances[j] + 1,
                        distances[j - 1] + 1,
                        diagonal + if (char == second[j - 1]) 0 else 1,
                    )
                diagonal = distances[j]
                distances[j] = next
            }
        }
        return 1 - distances[second.length].toDouble() / second.length
    }

    private fun deduplicate(list: List<JsonObject>): List<JsonObject> {
        val ids = mutableSetOf<String>()
        return list.filter { ids.add(it["id"].text()) }
    }

    private fun kotlinx.serialization.json.JsonElement?.text(): String = (this as? JsonPrimitive)?.content.orEmpty()

    private data class Scored(
        val score: Double,
        val data: JsonObject,
    )
}
