package cn.toside.music.core.list

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 列表排序规则测试：对照 RN src/screens/Home/Views/Mylist/MyList/utils.ts#sortListMusicInfo。
 *
 * 字符串比较用 java.text.Collator（Android 上委托 ICU，与 RN 的 localeCompare 同源）。
 * 两边已知方向不一致的边角（拉丁字母 vs 汉字、标点、重音）登记在车道报告「语义修正」节；
 * 这里只锁定实测一致、且不随语言环境漂移的顺序。
 */
class MusicSortTest {
    private fun music(
        id: String,
        name: String = id,
        singer: String = "s",
        albumName: String = "",
        interval: String? = "03:00",
        releaseDate: String? = null,
    ): JsonObject =
        buildJsonObject {
            put("id", id)
            put("name", name)
            put("singer", singer)
            put("source", "kw")
            put("interval", interval?.let(::JsonPrimitive) ?: JsonNull)
            put(
                "meta",
                buildJsonObject {
                    put("songId", id)
                    put("albumName", albumName)
                    if (releaseDate != null) put("releaseDate", releaseDate)
                },
            )
        }

    private fun ids(list: List<JsonObject>): List<String> = list.map { it.text("id").orEmpty() }

    private fun sort(
        list: List<JsonObject>,
        sortId: MusicSortId,
        locale: String = "zh-cn",
        addTimes: Map<String, Long> = emptyMap(),
        playCounts: Map<String, Long> = emptyMap(),
    ): List<JsonObject> =
        MusicSort.sort(
            list = list,
            sortId = sortId,
            localeId = locale,
            getAddTime = { addTimes[it] ?: 0L },
            getPlayCount = { playCounts[it] ?: 0L },
        )

    @Test
    fun sortByNameUsesPinyinOrder() {
        val list =
            listOf(
                music("1", name = "张"),
                music("2", name = "曾"),
                music("3", name = "李"),
            )
        assertEquals(listOf("3", "2", "1"), ids(sort(list, MusicSortId.NAME)))
    }

    @Test
    fun sortByNameMatchesJsForAsciiAndDigits() {
        // JS localeCompare 与 Java Collator 实测一致：字母不分大小写先比、数字按字典序。
        val list =
            listOf(
                music("1", name = "9"),
                music("2", name = "10"),
                music("3", name = "b"),
                music("4", name = "A"),
                music("5", name = "a"),
            )
        assertEquals(listOf("2", "1", "5", "4", "3"), ids(sort(list, MusicSortId.NAME)))
    }

    @Test
    fun sortByNameIsStableForEqualNames() {
        val list =
            listOf(
                music("1", name = "同名"),
                music("2", name = "同名"),
                music("3", name = "同名"),
            )
        assertEquals(listOf("1", "2", "3"), ids(sort(list, MusicSortId.NAME)))
    }

    @Test
    fun sortBySingerKeepsNullFirstAsInRn() {
        val list =
            listOf(
                music("1", singer = "张"),
                music("2", singer = ""),
                music("3", singer = "李"),
            )
        assertEquals(listOf("2", "3", "1"), ids(sort(list, MusicSortId.SINGER)))
    }

    @Test
    fun sortByAlbumGroupsSongsThenByName() {
        val list =
            listOf(
                music("1", name = "b2", albumName = "B"),
                music("2", name = "a2", albumName = "A"),
                music("3", name = "b1", albumName = "B"),
            )
        assertEquals(listOf("2", "3", "1"), ids(sort(list, MusicSortId.ALBUM)))
    }

    @Test
    fun durationUpPutsMissingIntervalFirst() {
        val list =
            listOf(
                music("1", interval = "03:00"),
                music("2", interval = null),
                music("3", interval = "02:00"),
                music("4", interval = "01:02:03"),
            )
        assertEquals(listOf("2", "3", "1", "4"), ids(sort(list, MusicSortId.DURATION_UP)))
    }

    @Test
    fun durationDownPutsMissingIntervalLast() {
        val list =
            listOf(
                music("1", interval = "03:00"),
                music("2", interval = null),
                music("3", interval = "02:00"),
                music("4", interval = "01:02:03"),
            )
        assertEquals(listOf("4", "1", "3", "2"), ids(sort(list, MusicSortId.DURATION_DOWN)))
    }

    @Test
    fun intervalSecondsParsesColonFormat() {
        assertEquals(180, MusicSort.intervalSeconds("03:00"))
        assertEquals(3723, MusicSort.intervalSeconds("01:02:03"))
        assertEquals(59, MusicSort.intervalSeconds("59"))
        // RN 侧缺失即 0；非法串 parseInt→NaN，比较时按相等处理，这里同样兜底为 0。
        assertEquals(0, MusicSort.intervalSeconds(null))
        assertEquals(0, MusicSort.intervalSeconds(""))
        assertEquals(0, MusicSort.intervalSeconds("abc"))
    }

    @Test
    fun sortByYearAscendingWithMissingLast() {
        val list =
            listOf(
                music("1", releaseDate = "2020-05-01"),
                music("2", releaseDate = null),
                music("3", releaseDate = "2018"),
                music("4", releaseDate = "abcd"),
            )
        assertEquals(listOf("3", "1", "2", "4"), ids(sort(list, MusicSortId.YEAR)))
    }

    @Test
    fun sortByAddTimeUpKeepsUnrecordedFirst() {
        val list = listOf(music("1"), music("2"), music("3"))
        assertEquals(
            listOf("2", "3", "1"),
            ids(sort(list, MusicSortId.ADD_TIME_UP, addTimes = mapOf("1" to 100L, "2" to 0L, "3" to 50L))),
        )
    }

    @Test
    fun sortByAddTimeDownKeepsUnrecordedLast() {
        val list = listOf(music("1"), music("2"), music("3"))
        assertEquals(
            listOf("1", "3", "2"),
            ids(sort(list, MusicSortId.ADD_TIME_DOWN, addTimes = mapOf("1" to 100L, "2" to 0L, "3" to 50L))),
        )
    }

    @Test
    fun sortByPlayCountDescendingIsStable() {
        val list = listOf(music("1"), music("2"), music("3"))
        assertEquals(
            listOf("1", "3", "2"),
            ids(sort(list, MusicSortId.PLAY_COUNT, playCounts = mapOf("1" to 5L, "2" to 0L, "3" to 5L))),
        )
    }

    @Test
    fun emptyAndSingleListsPassThrough() {
        assertEquals(emptyList<String>(), ids(sort(emptyList(), MusicSortId.NAME)))
        assertEquals(listOf("only"), ids(sort(listOf(music("only")), MusicSortId.YEAR)))
    }

    @Test
    fun sortIdsCoverRnOptions() {
        assertEquals(
            listOf("name", "album", "duration_up", "duration_down", "add_time_up", "add_time_down", "singer", "year", "play_count"),
            MusicSortId.entries.map { it.key },
        )
        assertEquals(MusicSortId.ALBUM, MusicSortId.fromKey("album"))
        assertNull(MusicSortId.fromKey("custom"))
        assertNull(MusicSortId.fromKey("unknown"))
    }

    @Test
    fun localeIdUnderscoreIsNormalized() {
        val list = listOf(music("1", name = "张"), music("2", name = "李"))
        assertEquals(
            ids(sort(list, MusicSortId.NAME, locale = "zh-CN")),
            ids(sort(list, MusicSortId.NAME, locale = "zh_cn")),
        )
    }

    /**
     * 锁定 JVM Collator 与 JS localeCompare(zh-CN) 的已知方向差异（实测，见车道报告「语义修正」节）。
     * RN 实测：阿 < b、"a-b" < ab；JVM 方向相反。
     * 若未来更换比较实现（ICU4J / 自定义排序）导致本用例失败，必须同步复核报告差异表。
     */
    @Test
    fun jvmCollatorDivergenceFromJsIsLocked() {
        val cjkVsLatin =
            listOf(
                music("cjk", name = "阿"),
                music("latin", name = "b"),
            )
        assertEquals(listOf("latin", "cjk"), ids(sort(cjkVsLatin, MusicSortId.NAME)))

        val punctuation =
            listOf(
                music("dash", name = "a-b"),
                music("plain", name = "ab"),
            )
        assertEquals(listOf("plain", "dash"), ids(sort(punctuation, MusicSortId.NAME)))
    }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
}
