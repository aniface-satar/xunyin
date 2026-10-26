package cn.toside.music.core.local

/**
 * 本地音频文件判定 —— 对照 RN `src/utils/localMediaMetadata.ts#scanAudioFiles`：
 *
 * ```js
 * files.filter(file => {
 *   if (file.mimeType?.startsWith('audio/')) return true
 *   if (extname(file?.name ?? '') === 'ogg') return true
 *   return false
 * })
 * ```
 *
 * 两条判据的顺序与内容都照抄：**先看 mime 前缀，再看 ogg 扩展名**。
 * 唯一扩展是 SAF 侧的 mime 缺失（见 [isAudio] 注释）。
 */
object LocalAudio {
    private const val AUDIO_MIME_PREFIX = "audio/"

    /** RN `utils/fs.ts#extname` 的 ogg 兜底。 */
    private const val OGG = "ogg"

    /** `MusicMetadata` 声明的四种容器（mp3/flac/ogg/wav）。 */
    val CONTAINER_EXTENSIONS: Set<String> = setOf("mp3", "flac", "ogg", "wav")

    /**
     * SAF 侧拿不到真实 mime 时的几种「什么都没说」的值。
     *
     * RN 走 `FileSystem.ls` 总能拿到系统给的 mime；SAF 的 `DocumentFile.getType()`
     * 对不少 provider 一律返回 `application/octet-stream` 或 null，此时只能退回扩展名白名单。
     */
    private val UNKNOWN_MIME_TYPES = setOf("", "application/octet-stream", "binary/octet-stream")

    /**
     * 扩展名（不带点、**不转小写**）—— 逐字对照 RN `utils/fs.ts#extname`：
     * `name.lastIndexOf('.') > 0 ? name.substring(idx + 1) : ''`。
     *
     * 注意 `lastIndexOf > 0` 这个守卫：`.hidden` 这类以点开头的文件名返回空串，
     * 与 [LocalTrack.splitNameAndExtension] 的 `index >= 0` 规则**不同**，别混用。
     */
    fun extensionOf(name: String?): String {
        val value = name.orEmpty()
        val index = value.lastIndexOf('.')
        return if (index > 0) value.substring(index + 1) else ""
    }

    /** 是否为音频：`audio/` 前缀优先，其次 `ext == "ogg"`，最后是 SAF 的扩展名兜底。 */
    fun isAudio(
        displayName: String?,
        mimeType: String?,
    ): Boolean {
        val mime = mimeType?.trim()?.lowercase().orEmpty()
        if (mime.startsWith(AUDIO_MIME_PREFIX)) return true
        val ext = extensionOf(displayName)
        if (ext == OGG) return true
        // SAF 扩展：mime 明确说了不是音频就尊重它，只有「没说」时才看扩展名
        return mime in UNKNOWN_MIME_TYPES && ext.lowercase() in CONTAINER_EXTENSIONS
    }
}
