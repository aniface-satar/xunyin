package cn.toside.music.core.local

/**
 * 同目录同名歌词的算路 —— RN 的 `.lrc` 是「同路径换扩展名」
 * （见 `listAction.ts` / `core/music/local.ts` 的 `readLyric`）；SAF 下没有真实路径，
 * 用 `DocumentsContract` 的 document id 做同样的替换：
 *
 * ```
 * "primary:Music/album/song.mp3" → "primary:Music/album/song.lrc"
 * ```
 *
 * 纯字符串规则，放 `:core` 便于锁测；真正开文件由 app 侧 `DocumentsContract` 完成。
 */
object LocalSibling {
    const val LYRIC_EXTENSION: String = "lrc"

    /**
     * 把文件名的扩展名换掉；**没有扩展名时返回 null**（不去猜、也不追加到末尾），
     * 避免把 `song` 误算成 `song.lrc` 之后读到同目录另一首歌词。
     */
    fun replaceExtension(
        name: String,
        extension: String,
    ): String? {
        val slash = name.lastIndexOf('/')
        val dot = name.lastIndexOf('.')
        if (dot <= slash || dot < 0 || slash == name.length - 1) return null
        if (dot == name.length - 1) return null
        return name.substring(0, dot) + "." + extension
    }

    /** document id → 同目录 `/同名 .lrc` 的 document id；无法推导时 null。 */
    fun lyricDocumentId(
        documentId: String,
        extension: String = LYRIC_EXTENSION,
    ): String? = replaceExtension(documentId, extension)
}
