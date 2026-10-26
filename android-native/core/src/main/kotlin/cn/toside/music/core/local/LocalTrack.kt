package cn.toside.music.core.local

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * 本地曲目构造 —— 对照 RN `src/screens/Home/Views/Mylist/MyList/listAction.ts`：
 *
 * - `buildLocalMusicInfoByFilePath(file)`：**先按文件名**算命一条占位曲目，导入时立刻入库；
 * - `buildLocalMusicInfo(filePath, metadata)`：读到标签后再按同 `id` 覆盖（`listMusicUpdateInfo`）。
 *
 * 两条路径的字段形状逐字对齐（`source: 'local'`、`meta.filePath = songId = id = 路径`、
 * `meta.picUrl` 恒空、`ext` 来自文件名/标签）。
 */
object LocalTrack {
    const val SOURCE: String = "local"

    /**
     * 读到的标签值（`MusicMetadataFull` 的子集）。
     *
     * RN 的原生模块还返回 `type` / `size` / `bitrate`，但 `buildLocalMusicInfo` 一个都不用，
     * 这里保留 [durationSec] 与 [ext] 两个真正落库的字段即可。
     */
    data class Metadata(
        val name: String? = null,
        val singer: String? = null,
        val albumName: String? = null,
        val durationSec: Int? = null,
        val ext: String? = null,
    )

    /**
     * RN `buildLocalMusicInfoByFilePath` 的 `lastIndexOf('.')` 规则：
     * - 有扩展名 → `(点前, 点后)`；
     * - 没有点 → `("", 整个文件名)`（JS `substring(0, -1)` 归一为 `""`）。
     *
     * 与 [LocalAudio.extensionOf] 的 `lastIndexOf > 0` 守卫**不是**同一套规则，
     * 前者用于构造曲目、后者用于扫描过滤，各自照抄各自的 RN 实现。
     */
    fun splitNameAndExtension(fileName: String): Pair<String, String> {
        val index = fileName.lastIndexOf('.')
        return if (index < 0) {
            "" to fileName
        } else {
            fileName.substring(0, index) to fileName.substring(index + 1)
        }
    }

    /**
     * 文件名 → (歌名, 歌手) —— 对照 RN `core/music/local.ts#getOtherSourceByLocal`：
     * `name.split('-')` 后只取前两段并 trim（三段以上的第三段起被丢弃）。
     * 不含 `-` 时返回 null（RN 该分支直接用整名去搜）。
     */
    fun splitArtist(stem: String): Pair<String, String>? {
        if (!stem.contains('-')) return null
        val parts = stem.split('-').map { it.trim() }
        if (parts.size < 2) return null
        return parts[0] to parts[1]
    }

    /**
     * RN `utils/common.ts#formatPlayTime2`：`trunc(m) + ':' + numFix(s)`，
     * 分钟**不封顶两位**（90 分钟是 `90:00`，不是 `1:30:00`）。
     */
    fun formatPlayTime2(seconds: Int): String {
        val safe = seconds.coerceAtLeast(0)
        val minute = safe / 60
        val second = safe % 60
        return "${numFix(minute)}:${numFix(second)}"
    }

    /** 占位曲目（还没读标签）：歌名 = 文件名去扩展名，歌手空，时长 null。 */
    fun buildPlaceholder(
        id: String,
        fileName: String,
    ): JsonObject = build(id, fileName, metadata = null, coverUri = null)

    /**
     * 读标签后的曲目。
     *
     * 一处**有意的健壮性补强**：标签里的歌名为空时退回文件名（RN 直接用 `metadata.name`，
     * 空名会被 `filterMusicList` 丢掉，表现为「导入后歌曲凭空消失」）。
     */
    fun buildInfo(
        id: String,
        fileName: String,
        metadata: Metadata?,
        coverUri: String? = null,
    ): JsonObject = build(id, fileName, metadata, coverUri)

    /** 去重键：RN 用路径当 `id`，SAF 侧即 document URI 字符串。 */
    fun dedupeKey(info: JsonObject): String? = (info["id"] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private fun build(
        id: String,
        fileName: String,
        metadata: Metadata?,
        coverUri: String?,
    ): JsonObject {
        val (stem, extFromName) = splitNameAndExtension(fileName)
        val name = metadata?.name?.takeIf { it.isNotBlank() } ?: stem
        val singer = metadata?.singer.orEmpty()
        val ext = metadata?.ext?.takeIf { it.isNotBlank() } ?: extFromName
        val interval = metadata?.durationSec?.let { JsonPrimitive(formatPlayTime2(it)) } ?: JsonNull

        return buildJsonObject {
            put("id", JsonPrimitive(id))
            put("name", JsonPrimitive(name))
            put("singer", JsonPrimitive(singer))
            put("interval", interval)
            put("source", JsonPrimitive(SOURCE))
            put(
                "meta",
                buildJsonObject {
                    put("albumName", JsonPrimitive(metadata?.albumName.orEmpty()))
                    put("filePath", JsonPrimitive(id))
                    put("songId", JsonPrimitive(id))
                    put("picUrl", JsonPrimitive(coverUri.orEmpty()))
                    put("ext", JsonPrimitive(ext))
                },
            )
        }
    }

    private fun numFix(n: Int): String = if (n < 10) "0$n" else n.toString()
}
