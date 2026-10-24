package cn.toside.music.core.lyric

/**
 * 桌面歌词浮窗的纯逻辑 —— RN `mobile/lyric/LyricPlayer.java` 与 `LyricView.java` 的静态部分。
 *
 * 只做「播放位置 → 显示哪些行」和「百分比 → 窗口坐标」；窗口创建、拖动、逐行动画
 * 属于 app 层。桌面歌词的 `offset` 是 150ms，与 Kotlin 播放页的 100ms 不同
 * （RN `LyricPlayer.offset = 150`，Kotlin `LyricParser.DEFAULT_OFFSET_MS = 100`）。
 */
object DesktopLyricLine {
    /** RN `LyricPlayer.offset`：桌面歌词比播放位置提前 150ms 切行。 */
    const val OFFSET_MS = 150

    /** 当前行号；空歌词返回 -1。行选取规则与播放页共用 [ParsedLyric.indexAt]。 */
    fun indexAt(
        parsed: ParsedLyric,
        positionMs: Long,
    ): Int = parsed.indexAt(positionMs, OFFSET_MS)

    fun lineAt(
        parsed: ParsedLyric,
        positionMs: Long,
    ): LyricLine? = parsed.lines.getOrNull(indexAt(parsed, positionMs))

    /**
     * 浮窗要显示的文本行：当前行 + 该行的翻译/音译。
     * 对照 RN `LyricView.setLyric`：单行模式或 `maxLineNum <= 1` 只显示当前行，
     * 否则最多 `maxLineNum` 行；`Lyric.java` 只滤掉空串，这里连纯空白也跳过。
     */
    fun lines(
        parsed: ParsedLyric,
        positionMs: Long,
        singleLine: Boolean,
        maxLineNum: Int,
    ): List<String> {
        val line = lineAt(parsed, positionMs) ?: return emptyList()
        val limit = if (singleLine) 1 else maxLineNum.coerceAtLeast(1)
        if (limit == 1) return listOf(line.text)
        return buildList {
            add(line.text)
            for (extended in line.extendedLyrics) {
                if (size >= limit) break
                if (extended.isBlank()) continue
                add(extended)
            }
        }
    }

    /** 窗口宽度：RN `(int)(maxWidth * widthPercentage)`。 */
    fun windowWidth(
        maxWidthPx: Int,
        widthPercent: Int,
    ): Int = maxWidthPx * widthPercent / 100

    /** 窗口高度：RN `fontMetrics.height * maxLineNum`，封顶 `maxHeight - 100`。 */
    fun windowHeight(
        lineHeightPx: Int,
        maxLineNum: Int,
        maxHeightPx: Int,
    ): Int {
        val raw = lineHeightPx * maxLineNum.coerceAtLeast(1)
        val cap = (maxHeightPx - 100).coerceAtLeast(0)
        return if (raw > cap) cap else raw
    }

    data class WindowPosition(
        val x: Int,
        val y: Int,
    )

    /**
     * 百分比位置 → 窗口坐标并夹在屏幕内（RN `fixViewPosition`）。
     * 窗口比屏幕还大时贴左上，避免 RN 的负坐标（`maxX < 0`）。
     */
    fun clampPosition(
        maxWidthPx: Int,
        maxHeightPx: Int,
        widthPx: Int,
        heightPx: Int,
        percentX: Double,
        percentY: Double,
    ): WindowPosition {
        val x = (maxWidthPx * percentX / 100.0).toInt()
        val y = (maxHeightPx * percentY / 100.0).toInt()
        return WindowPosition(
            x = clampAxis(x, maxWidthPx - widthPx),
            y = clampAxis(y, maxHeightPx - heightPx),
        )
    }

    /** 松手后存回设置的百分比（RN `layoutParams.x / maxWidth * 100f`）。 */
    fun percentOf(
        valuePx: Int,
        totalPx: Int,
    ): Double = if (totalPx <= 0) 0.0 else valuePx.toDouble() / totalPx * 100.0

    private fun clampAxis(
        value: Int,
        max: Int,
    ): Int =
        when {
            max <= 0 -> 0
            value < 0 -> 0
            value > max -> max
            else -> value
        }
}
