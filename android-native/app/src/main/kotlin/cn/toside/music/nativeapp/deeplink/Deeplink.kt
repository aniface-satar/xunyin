package cn.toside.music.nativeapp.deeplink

import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.songlist.SonglistLinkParser
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import java.net.URI
import java.net.URLDecoder

/** 播放器动作（对照 RN `deeplink/playerAction.ts` 的 `PlayerAction`）。 */
enum class PlayerActionKind {
    PLAY,
    PAUSE,
    SKIP_NEXT,
    SKIP_PREV,
    TOGGLE_PLAY,
    COLLECT,
    UNCOLLECT,
    DISLIKE,
    ;

    companion object {
        /** RN 的 action 字面量 → 枚举；未知动作返回 null（RN 走 default 分支静默忽略）。 */
        fun fromAction(action: String): PlayerActionKind? =
            when (action) {
                "play" -> PLAY
                "pause" -> PAUSE
                "skipNext" -> SKIP_NEXT
                "skipPrev" -> SKIP_PREV
                "togglePlay" -> TOGGLE_PLAY
                "collect" -> COLLECT
                "uncollect" -> UNCOLLECT
                "dislike" -> DISLIKE
                else -> null
            }
    }
}

/**
 * deeplink 解析结果。
 *
 * 只放纯数据，解析过程不碰 Android API —— 样本表可以直接进 JVM 单测
 * （任务书验收：解析不许埋在 `onCreate` 里）。
 */
sealed interface DeeplinkCommand {
    /** `songlist/play/<source>/<url>[/<index>]`（`url` 位置上 RN 允许放 id 或链接）。 */
    data class SonglistPlay(
        val source: String,
        val id: String?,
        val url: String?,
        val index: Int?,
    ) : DeeplinkCommand

    /** `music/play?data=<json>`：整首播放信息走 query 的 data。 */
    data class MusicPlay(
        val musicInfo: JsonObject,
        val playLater: Boolean,
    ) : DeeplinkCommand

    data class PlayerAction(
        val action: PlayerActionKind,
    ) : DeeplinkCommand

    /**
     * `music/searchPlay`：按「歌名 / 歌手」跨源搜一首再播（RN `handleSearchPlayMusic`）。
     *
     * 与 `music/play` 的区别：`play` 自带完整音源信息直接可播，这里只有元信息，
     * 需要先走跨源搜索（Wave6 Lane B 落的能力），搜不到就什么都不做（RN 同）。
     */
    data class SearchPlay(
        val name: String,
        val singer: String,
        val albumName: String,
        val interval: String?,
        val playLater: Boolean,
    ) : DeeplinkCommand

    /** 文件打开（`file://` / `content://`）：json/lxmc 走列表导入，js 走音源，音频走试听列表。 */
    data class OpenFile(
        val uri: String,
        val extension: String,
        val kind: FileKind,
    ) : DeeplinkCommand

    /** 解析失败；[reason] 直接拼进 RN 的 `deep_link__handle_error_tip`。 */
    data class Invalid(
        val reason: String,
    ) : DeeplinkCommand
}

/**
 * 文件打开的三种落点（对照 RN `fileAction.ts#handleFileAction` 的 switch）：
 *
 * - [LIST_BACKUP]：`json` / `lxmc` → `handleFileLXMCAction`（确认后导入列表备份）；
 * - [USER_API_SCRIPT]：`js` → `handleFileJSAction`（确认后导入自定义音源）；
 * - [AUDIO]：`ogg` / `flac` / `wav` / `mp3` → `handleFileMusicAction`（不确认，直接进试听列表起播）。
 *
 * RN 的 default 分支还会按 `mimeType.startsWith('audio/')` 兜底，SAF 侧拿不到稳定 mime，
 * 所以这里只认扩展名白名单（与 RN 四个 case 逐字一致）。
 */
enum class FileKind {
    LIST_BACKUP,
    USER_API_SCRIPT,
    AUDIO,
}

/**
 * `lxmusic://` 与文件链接的纯解析器（对照 RN `src/core/init/deeplink/index.ts`）。
 *
 * 与 RN 逐位对齐的几处细节：
 * - 先按第一个 `?` 切开，路径段逐个 `decodeURIComponent`，query 只取 `key=value` 的**前两段**
 *   （RN `param.split('=')` 解构，值里再出现 `=` 会被截断）；
 * - `data` 先 decode 再 `JSON.parse`；
 * - `songlist` 无 data 时取 `paths[0]` 作 source、`paths[1]` 作 url、`paths[2]` 作 index；
 * - 未知 type/action 静默忽略（RN 的 switch 没有 default 抛错分支）；
 * - 解析/校验失败才报错，文案走 `调用失败：<message>`。
 */
object DeeplinkParser {
    const val SCHEME = "lxmusic://"

    private const val FILE_SCHEME = "file://"
    private const val CONTENT_SCHEME = "content://"

    /** RN `deeplink/utils.js#sources`。 */
    private val ONLINE_SOURCES = setOf("kw", "kg", "tx", "wy", "mg")

    /**
     * 五源歌单网页的 host 白名单（W8-C 任务 6：外部 https 链接直达歌单详情）。
     *
     * 域名按 `SonglistLinkParser` 实际能解析的网页形态列（用户分享出来的页面链接，
     * 不是内部 API 域名）：
     * - kw：`www.kuwo.cn/playlist_detail/<id>`
     * - kg：`www.kugou.com/yy/special/single/<id>.html`
     * - tx：`y.qq.com/.../playlist/<id>` 或 `...?id=<digits>`
     * - wy：`music.163.com/playlist?id=<digits>`（含 `#/playlist?id=` 形态）
     * - mg：`music.migu.cn/.../playlist/<id>` 或 `...?playlistId=<digits>`
     *
     * 移动端的二级域（`y.music.163.com` 等）链接形态另有约定，不在本白名单，
     * 拿到这类链接走系统浏览器，不在本应用拦截（记 lane 报告遗留）。
     */
    private val SONG_LIST_HOSTS =
        mapOf(
            "www.kuwo.cn" to "kw",
            "www.kugou.com" to "kg",
            "y.qq.com" to "tx",
            "music.163.com" to "wy",
            "music.migu.cn" to "mg",
        )

    /** RN `handleFileAction` 认的七种扩展名（见 [FileKind]）。 */
    private val SUPPORTED_FILE_EXTENSIONS = setOf("json", "lxmc", "js", "ogg", "flac", "wav", "mp3")

    /** RN `handleSearchPlayMusic` 拆「歌名 - 歌手」的分隔符。 */
    private const val ARTIST_SEPARATOR = "-"

    private const val MAX_NAME = 200
    private const val MAX_SINGER = 200
    private const val MAX_ALBUM = 64
    private const val MAX_INTERVAL = 64
    private const val MAX_ID = 64
    private const val MAX_URL = 500
    private const val MAX_INDEX = 1_000_000

    private val paramsJson = Json { ignoreUnknownKeys = true }

    /** @return null 表示不是本应用能处理的链接（RN 的 `runLinkAction` 同样只认两种前缀）。 */
    fun parse(raw: String?): DeeplinkCommand? {
        val link = raw?.trim().orEmpty()
        return when {
            link.isEmpty() -> null
            link.startsWith(FILE_SCHEME) || link.startsWith(CONTENT_SCHEME) -> parseFile(link)
            link.startsWith(SCHEME) -> parseDeepLink(link)
            link.startsWith("http://") || link.startsWith("https://") -> parseHttpSonglist(link)
            else -> null
        }
    }

    /**
     * 外部 http(s) 歌单链接 → [DeeplinkCommand.SonglistPlay]。
     *
     * 不在白名单的 host 返回 null（不是本应用的链接，manifest 侧同样拦不到）；
     * host 命中但解析不出 id 也返回 null（比如源官网的非歌单页面，让用户留在浏览器）。
     */
    private fun parseHttpSonglist(link: String): DeeplinkCommand? {
        val host =
            runCatching {
                URI(link)
                    .host
                    ?.lowercase()
            }.getOrNull() ?: return null
        val source = SONG_LIST_HOSTS[host] ?: return null
        val parsed = SonglistLinkParser.parse(link, source) ?: return null
        return DeeplinkCommand.SonglistPlay(source = parsed.source, id = parsed.id, url = null, index = null)
    }

    private fun parseFile(link: String): DeeplinkCommand {
        val name = link.substringAfterLast('/')
        val extension = name.substringAfterLast('.', "").lowercase()
        if (extension !in SUPPORTED_FILE_EXTENSIONS) {
            return DeeplinkCommand.Invalid("暂不支持打开 .$extension 文件")
        }
        return DeeplinkCommand.OpenFile(link, extension, fileKindOf(extension))
    }

    /**
     * 扩展名 → 落点。白名单之外返回 [FileKind.AUDIO] 是**不可能**的（调用前已过滤），
     * 这里让 `else` 落在 AUDIO 上只为让 `when` 穷尽，避免悄悄丢命令。
     */
    fun fileKindOf(extension: String): FileKind =
        when (extension.lowercase()) {
            "json", "lxmc" -> FileKind.LIST_BACKUP
            "js" -> FileKind.USER_API_SCRIPT
            else -> FileKind.AUDIO
        }

    private fun parseDeepLink(link: String): DeeplinkCommand? {
        val urlPart = link.substringBefore('?')
        val queryPart = link.substringAfter('?', "")
        val segments = urlPart.removePrefix(SCHEME).split('/')
        val type = segments.getOrNull(0).orEmpty()
        val action = segments.getOrNull(1).orEmpty()
        val paths = segments.drop(2).map { percentDecode(it) }
        val query = parseQuery(queryPart)
        return when (type) {
            "songlist" -> parseSonglist(action, paths, query)
            "music" -> parseMusic(action, paths, query)
            "player" -> parsePlayer(action)
            // RN 的 switch 没有 default：未知 type 静默丢弃
            else -> DeeplinkCommand.Invalid("Unknown type: $type")
        }
    }

    private fun parseSonglist(
        action: String,
        paths: List<String>,
        query: Map<String, String>,
    ): DeeplinkCommand {
        if (action != "play") return DeeplinkCommand.Invalid("Unknown action: $action")
        val data = query["data"]?.let { parseData(it) }
        val source: String?
        val id: String?
        val url: String?
        val rawIndex: String?
        if (data != null) {
            source = data.str("source")
            id = data.scalar("id")
            url = data.str("url")
            rawIndex = data.scalar("index")
        } else {
            source = paths.getOrNull(0)
            id = null
            url = paths.getOrNull(1)
            rawIndex = paths.getOrNull(2)
        }
        // `!in` 不会把可空收窄成非空，先取有效源再往下走
        val validSource = source?.takeIf { it in ONLINE_SOURCES } ?: return DeeplinkCommand.Invalid("Source no match")
        if (id != null && id.length > MAX_ID) return DeeplinkCommand.Invalid("id max length no match")
        if (url != null && url.length > MAX_URL) return DeeplinkCommand.Invalid("url max length no match")
        if (id.isNullOrEmpty() && url.isNullOrEmpty()) return DeeplinkCommand.Invalid("id or url missing")
        val index = rawIndex?.toIntOrNull()?.takeIf { it in 1..MAX_INDEX }
        return DeeplinkCommand.SonglistPlay(validSource, id?.ifEmpty { null }, url?.ifEmpty { null }, index)
    }

    private fun parseMusic(
        action: String,
        paths: List<String>,
        query: Map<String, String>,
    ): DeeplinkCommand? =
        when (action) {
            "play" -> parseMusicPlay(paths, query)
            "searchPlay" -> parseSearchPlay(paths, query)
            else -> DeeplinkCommand.Invalid("Unknown action: $action")
        }

    private fun parseMusicPlay(
        paths: List<String>,
        query: Map<String, String>,
    ): DeeplinkCommand {
        val data = query["data"]?.let { parseData(it) } ?: return DeeplinkCommand.Invalid("data missing")
        val musicInfo = buildMusicInfo(data, paths) ?: return DeeplinkCommand.Invalid("data invalid")
        return DeeplinkCommand.MusicPlay(musicInfo, data.bool("playLater"))
    }

    /**
     * RN `handleSearchPlayMusic`：
     *
     * - 有 paths → 取 `paths[0]`，按第一个 `-` 拆成「歌名 - 歌手」（只取前两段，第三段起丢弃）；
     *   没有 paths → 整个 `data` 当 info；
     * - `verifyInfo` 的五项 `dataVerify`：**类型不符与超长都会抛**，所以这里照样报 Invalid；
     * - `if (!info.name) return` —— 空歌名是**静默返回**，不是报错，故这里返回 null
     *   （[parse] 返回 null = 不是本应用能处理的链接，RN 同样什么都不做）。
     */
    private fun parseSearchPlay(
        paths: List<String>,
        query: Map<String, String>,
    ): DeeplinkCommand? {
        val data = query["data"]?.let { parseData(it) }
        val (name, singer) =
            if (paths.isNotEmpty()) {
                val raw = paths[0].trim()
                if (raw.contains(ARTIST_SEPARATOR)) {
                    val parts = raw.split(ARTIST_SEPARATOR).map { it.trim() }
                    parts.getOrElse(0) { "" } to parts.getOrElse(1) { "" }
                } else {
                    raw to ""
                }
            } else {
                if (data == null) return DeeplinkCommand.Invalid("data missing")
                data.str("name").orEmpty() to data.str("singer").orEmpty()
            }
        if (name.isEmpty()) return null
        if (name.length > MAX_NAME) return DeeplinkCommand.Invalid("name max length no match")
        if (singer.length > MAX_SINGER) return DeeplinkCommand.Invalid("singer max length no match")
        val albumName = data?.str("albumName").orEmpty()
        if (albumName.length > MAX_ALBUM) return DeeplinkCommand.Invalid("albumName max length no match")
        val interval = data?.str("interval")?.takeIf { it.isNotEmpty() }
        if (interval != null && interval.length > MAX_INTERVAL) {
            return DeeplinkCommand.Invalid("interval max length no match")
        }
        return DeeplinkCommand.SearchPlay(name, singer, albumName, interval, data?.bool("playLater") ?: false)
    }

    private fun parsePlayer(action: String): DeeplinkCommand {
        val kind = PlayerActionKind.fromAction(action) ?: return DeeplinkCommand.Invalid("Unknown action: $action")
        return DeeplinkCommand.PlayerAction(kind)
    }

    /**
     * RN `data` → 原生动态音乐模型。
     *
     * 简化点：RN 的 `filterInfoByPlayMusic` 会按源逐字段 `dataVerify` 再 `qualityFilter`；
     * 原生取链是把整个 info 丢给音源脚本，所以这里只校验 name/singer/source 三个必需字段，
     * 其余字段整体搬到 `meta`（`songmid`/`hash`/`copyrightId` 等脚本要的键都在里面），
     * 最后过 `sanitizeMusicInfo` 补齐 `songId/picUrl/qualitys`。
     */
    private fun buildMusicInfo(
        data: JsonObject,
        paths: List<String>,
    ): JsonObject? {
        val source = data.str("source") ?: return null
        if (source !in ONLINE_SOURCES) return null
        val name = (data.str("name") ?: paths.firstOrNull()).orEmpty().trim()
        if (name.isEmpty() || name.length > MAX_NAME) return null
        val singer = data.str("singer").orEmpty()
        if (singer.length > MAX_SINGER) return null
        val albumName = data.str("albumName").orEmpty()
        if (albumName.length > MAX_ALBUM) return null
        val interval = data.str("interval").orEmpty()
        if (interval.length > MAX_INTERVAL) return null
        val id = data.scalar("id") ?: data.scalar("songmid") ?: data.scalar("copyrightId")
        if (id.isNullOrEmpty() || id.length > MAX_ID) return null

        val types = (data["types"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
        val qualities =
            buildJsonArray {
                types.forEach { type ->
                    val quality = type.str("type") ?: return@forEach
                    add(JsonPrimitive(quality))
                }
            }
        val qualitySizes =
            buildJsonObject {
                types.forEach { type ->
                    val quality = type.str("type") ?: return@forEach
                    put(quality, buildJsonObject { type.scalar("size")?.let { put("size", JsonPrimitive(it)) } })
                }
            }
        val meta =
            buildJsonObject {
                data.forEach { (key, value) ->
                    if (key !in TOP_LEVEL_KEYS && value !is JsonNull) put(key, value)
                }
                put("songId", JsonPrimitive(id))
                put("albumName", JsonPrimitive(albumName))
                put("picUrl", data["img"]?.takeIf { it !is JsonNull } ?: JsonNull)
                put("qualitys", qualities)
                put("_qualitys", qualitySizes)
            }
        return MusicInfoTools.sanitizeMusicInfo(
            buildJsonObject {
                put("id", JsonPrimitive(id))
                put("name", JsonPrimitive(name))
                put("singer", JsonPrimitive(singer))
                put("interval", if (interval.isEmpty()) JsonNull else JsonPrimitive(interval))
                put("source", JsonPrimitive(source))
                put("meta", meta)
            },
        )
    }

    private fun parseData(raw: String): JsonObject? =
        runCatching { paramsJson.parseToJsonElement(percentDecode(raw)).jsonObject }.getOrNull()

    /** RN `search.split('&')` + `param.split('=')` 解构：只取前两段。 */
    private fun parseQuery(query: String): Map<String, String> {
        if (query.isEmpty()) return emptyMap()
        val result = mutableMapOf<String, String>()
        query.split('&').forEach { param ->
            if (param.isEmpty()) return@forEach
            val key = param.substringBefore('=')
            val value = param.substringAfter('=', "").substringBefore('=')
            if (key.isNotEmpty()) result[key] = value
        }
        return result
    }

    /**
     * `decodeURIComponent` 的等价物。
     *
     * `URLDecoder` 会把 `+` 当空格，而 `decodeURIComponent` 不会——先把 `+` 转义掉再解，
     * 语义才对得上；非法转义序列保持原样（JS 会抛 URIError，原生这里宁愿不炸）。
     */
    private fun percentDecode(raw: String): String =
        runCatching {
            URLDecoder.decode(raw.replace("+", "%2B"), "UTF-8")
        }.getOrDefault(raw)
}

/** 顶层字段（不进 meta）。 */
private val TOP_LEVEL_KEYS = setOf("name", "singer", "source", "interval", "playLater", "id")

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

/** 数字字段也当字符串读（RN 的 `dataVerify` 允许 `string | number`）。 */
private fun JsonObject.scalar(key: String): String? = str(key)?.trim()

private fun JsonObject.bool(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.let { it !is JsonNull && it.content.equals("true", ignoreCase = true) } ?: false
