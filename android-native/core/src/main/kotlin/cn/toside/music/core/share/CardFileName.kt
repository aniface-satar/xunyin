package cn.toside.music.core.share

/** 分享图文件名判据（`src/utils/shareCard/cardFileName.ts` 的移植）。 */
private const val MAX_BASE_NAME = 72
private const val FALLBACK_NAME = "lyric-poster"

/** 文件名里的非法字符一律去掉：落盘那边不会替你报错，只会写不出或者写歪。 */
private val ILLEGAL_FILE_NAME_CHARS = Regex("[\\\\/:*?\"<>|\\u0000-\\u001F]")
private val WHITESPACE_RUN = Regex("\\s+")

fun cardFileName(
    name: String,
    singer: String,
): String {
    val title = cleanFileNamePart(name)
    val artist = cleanFileNamePart(singer)
    val joined = if (artist.isNotEmpty()) "$title - $artist" else title
    return joined.ifEmpty { FALLBACK_NAME }.take(MAX_BASE_NAME)
}

/**
 * 同名不覆盖（`saveCard.ts` 的 `uniqueName`）：`base.png` 已存在就依次试 `base (1).png`。
 * 存在性由调用方探测（RN 走 SAF，原生走 MediaStore）。
 */
fun uniqueCardFileName(
    baseName: String,
    extension: String = "png",
    exists: (String) -> Boolean,
): String {
    var name = "$baseName.$extension"
    var index = 1
    while (exists(name)) {
        name = "$baseName ($index).$extension"
        index++
    }
    return name
}

private fun cleanFileNamePart(value: String): String =
    value
        .replace(ILLEGAL_FILE_NAME_CHARS, "")
        .replace(WHITESPACE_RUN, " ")
        .trim()
