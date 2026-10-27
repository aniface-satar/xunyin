package cn.toside.music.nativeapp.deeplink

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import cn.toside.music.core.local.LocalSourceQuery
import cn.toside.music.core.local.LocalTrack
import cn.toside.music.core.music.MusicInfoTools
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.HomeNavigator
import cn.toside.music.nativeapp.data.SearchRuntime
import cn.toside.music.nativeapp.player.PlayerRuntime
import cn.toside.music.nativeapp.util.SafDocuments
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** 待确认的文件打开请求（HomePage 渲染确认弹层，确认后才真导入）；音频不经过这里（直接起播）。 */
data class FileOpenRequest(
    val uri: String,
    val extension: String,
    val kind: FileKind,
)

/**
 * deeplink 落地点（对照 RN `initDeeplink`）。
 *
 * 分工：[DeeplinkParser] 只做纯解析，这里只做三件事——把命令翻译成既有公开方法的调用、
 * 把需要界面确认的部分抛成状态（[fileRequest]）、以及冷启动时把「还没建导航器」的命令
 * 排队（[attach] 时补发）。
 *
 * 不碰 `app/player/`（归 Lane B）：所有播控动作都走 [PlayerRuntime.core] 与
 * `PlayerRuntime.radio` 的既有公开方法，缺方法的动作降级成 toast 并记遗留。
 */
object DeeplinkRuntime {
    /** 「全部」聚合源不是真源，逐源搜索时跳过。 */
    private const val ALL_SOURCE = "all"

    /** 懒建：JVM 单测不碰 Dispatchers.Main。 */
    private val scope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }

    private var context: Context? = null
    private var navigator: HomeNavigator? = null
    private val pending = ArrayDeque<DeeplinkCommand>()

    private val _fileRequest = MutableStateFlow<FileOpenRequest?>(null)

    /** 需要界面确认的文件打开（json / lxmc）。 */
    val fileRequest: StateFlow<FileOpenRequest?> = _fileRequest.asStateFlow()

    /** 界面挂载后绑定导航器，并补发冷启动期间排队的命令。 */
    fun attach(nav: HomeNavigator) {
        navigator = nav
        while (pending.isNotEmpty()) {
            apply(pending.removeFirst())
        }
    }

    /** 文件打开弹层处理完（确认或取消）后清空。 */
    fun clearFileRequest() {
        _fileRequest.value = null
    }

    /** Activity 的 onCreate / onNewIntent 统一入口；非 VIEW 或非本应用链接直接忽略。 */
    fun dispatch(
        activityContext: Context,
        intent: Intent?,
    ) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val raw = intent.dataString ?: return
        context = activityContext.applicationContext
        val command = DeeplinkParser.parse(raw) ?: return
        apply(command)
    }

    private fun apply(command: DeeplinkCommand) {
        when (command) {
            is DeeplinkCommand.Invalid -> toast("调用失败：${command.reason}")
            is DeeplinkCommand.OpenFile -> openFile(command)
            is DeeplinkCommand.SonglistPlay -> openSonglist(command)
            is DeeplinkCommand.MusicPlay -> playMusic(command)
            is DeeplinkCommand.SearchPlay -> searchPlay(command)
            is DeeplinkCommand.PlayerAction -> playerAction(command.action)
        }
    }

    /**
     * RN `handleFileAction` 的三条分支。
     *
     * 音频**不弹确认框**（RN `handleFileMusicAction` 同样直接起播），走 [playLocalFile]；
     * 备份与音源脚本要先确认，交给界面层的 [fileRequest]。
     */
    private fun openFile(command: DeeplinkCommand.OpenFile) {
        if (command.kind == FileKind.AUDIO) {
            playLocalFile(command.uri)
        } else {
            _fileRequest.value = FileOpenRequest(command.uri, command.extension, command.kind)
        }
    }

    /**
     * 单个音频文件进「稍后播放」并起播（RN `handleFileMusicAction`）。
     *
     * **降级**：RN 先 `readMetadata` 读标签再 `buildLocalMusicInfo`，而
     * `LocalMusicRuntime` 的标签读取是私有的、对外只有目录树导入
     * （[cn.toside.music.nativeapp.data.LocalMusicRuntime.importTree]），
     * 没有单文件入口，所以这里用 [LocalTrack.buildPlaceholder] 按文件名造一条占位曲目
     * —— 歌名 = 文件名去扩展名、歌手空、时长 null。曲目形状与目录导入一致
     * （`source=local`、`meta.filePath = id = URI`），起播后的在线兜底链路照旧。
     * 建议 Wave8 由 Lane B 暴露单文件导入入口补上标签。
     */
    private fun playLocalFile(uriString: String) {
        val ctx = context ?: return
        scope.launch {
            val uri = runCatching { Uri.parse(uriString) }.getOrNull() ?: return@launch
            val name = SafDocuments.displayName(ctx, uri) ?: uriString.substringAfterLast('/')
            val info = LocalTrack.buildPlaceholder(uriString, name)
            val core = PlayerRuntime.get(ctx).core
            core.addTempPlayList(listOf(Triple(null, info, true)))
            if (core.state.value.isPlay) core.playNext()
            toast("已加入试听列表：$name")
        }
    }

    /**
     * `music/searchPlay`：跨源搜一首再播（RN `handleSearchPlayMusic` + `searchMusic`）。
     *
     * 只调既有公开方法：[LocalSourceQuery.candidates] 出候选关键词、
     * [SearchRuntime.search] 逐源搜第 1 页、[LocalSourceQuery.matches] 判歌名/歌手对得上；
     * 与 `PlayerRuntime` 本地兜底用的是同一套阶梯，只是入口从「本地曲目」换成「deeplink 元信息」。
     * 一首都没对上就什么都不做（RN 只 `console.log('msuic not found')`）。
     */
    private fun searchPlay(command: DeeplinkCommand.SearchPlay) {
        val ctx = context ?: return
        scope.launch {
            val core = PlayerRuntime.get(ctx).core
            val found = findOnlineMatch(command.name, command.singer)
            if (found == null) {
                toast("没找到歌曲：${command.name}")
                return@launch
            }
            val fixed = MusicInfoTools.fixNewMusicInfoQuality(found)
            if (command.playLater) {
                core.addTempPlayList(listOf(Triple(null, fixed, false)))
            } else {
                core.addTempPlayList(listOf(Triple(null, fixed, true)))
                if (core.state.value.isPlay) core.playNext()
            }
        }
    }

    /** 六级候选 × 五源第 1 页，返回第一首匹配上的曲目。 */
    private suspend fun findOnlineMatch(
        name: String,
        singer: String,
    ): JsonObject? {
        for (candidate in LocalSourceQuery.candidates(name, singer)) {
            for ((source, _) in SearchRuntime.SOURCES) {
                if (source == ALL_SOURCE) continue
                val page =
                    runCatching { SearchRuntime.search(candidate.keyword, 1, source) }.getOrNull()
                        ?: continue
                for (info in page.list) {
                    if (LocalSourceQuery.matches(
                            expectName = candidate.expectName,
                            expectSinger = candidate.expectSinger,
                            actualName = info.text("name").orEmpty(),
                            actualSinger = info.text("singer").orEmpty(),
                        )
                    ) {
                        return info
                    }
                }
            }
        }
        return null
    }

    private fun openSonglist(command: DeeplinkCommand.SonglistPlay) {
        val nav = navigator
        if (nav == null) {
            pending.addLast(command)
            return
        }
        val listId = command.id ?: command.url ?: return
        // 详情页标题由页面自己按 id 回查（RN 的 deeplink 同样不传歌单名）
        nav.openFromDeeplink(HomeNavigator.Route.SonglistDetail(command.source, listId, listId))
    }

    /** RN `musicAction#handlePlayMusic`：塞进「稍后播放」并（正在播时）立刻切过去。 */
    private fun playMusic(command: DeeplinkCommand.MusicPlay) {
        val ctx = context ?: return
        scope.launch {
            val core = PlayerRuntime.get(ctx).core
            val info = MusicInfoTools.fixNewMusicInfoQuality(command.musicInfo)
            core.addTempPlayList(listOf(Triple(null, info, true)))
            if (core.state.value.isPlay) core.playNext()
        }
    }

    /** RN `playerAction.ts` 的八个动作。 */
    private fun playerAction(action: PlayerActionKind) {
        val ctx = context ?: return
        scope.launch {
            val player = PlayerRuntime.get(ctx)
            val core = player.core
            when (action) {
                PlayerActionKind.PLAY -> core.play()
                PlayerActionKind.PAUSE -> core.pause()
                PlayerActionKind.SKIP_NEXT -> core.playNext()
                PlayerActionKind.SKIP_PREV -> core.playPrev()
                PlayerActionKind.TOGGLE_PLAY -> core.togglePlay()
                PlayerActionKind.COLLECT -> toggleLove(player, add = true)
                PlayerActionKind.UNCOLLECT -> toggleLove(player, add = false)
                PlayerActionKind.DISLIKE -> {
                    val info = core.state.value.playMusicInfo.musicInfo
                    if (info == null) {
                        toast("当前没有播放中的歌曲")
                    } else {
                        player.radio.dislike(info)
                    }
                }
            }
        }
    }

    /** RN `collectMusic` / `uncollectMusic`：只动「我的收藏」列表。 */
    private suspend fun toggleLove(
        player: PlayerRuntime,
        add: Boolean,
    ) {
        val info = player.core.state.value.playMusicInfo.musicInfo
        if (info == null) {
            toast("当前没有播放中的歌曲")
            return
        }
        val id = info.text("id") ?: return
        val store = player.lists.store
        if (add) {
            val location =
                player.settings.store
                    .string("list.addMusicLocationType")
                    .ifEmpty { "top" }
            store.listMusicAdd(StorageKeys.ListIds.LOVE, listOf(info), location)
        } else {
            store.listMusicRemove(StorageKeys.ListIds.LOVE, listOf(id))
        }
        player.core.handleListMusicsUpdated(listOf(StorageKeys.ListIds.LOVE))
    }

    private fun toast(message: String) {
        val ctx = context ?: return
        Toast.makeText(ctx, message, Toast.LENGTH_SHORT).show()
    }

    private fun JsonObject.text(key: String): String? {
        val value = this[key] as? JsonPrimitive ?: return null
        return if (value is JsonNull) null else value.content
    }
}
