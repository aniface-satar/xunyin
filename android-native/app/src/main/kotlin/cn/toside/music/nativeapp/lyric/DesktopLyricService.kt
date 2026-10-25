package cn.toside.music.nativeapp.lyric

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import cn.toside.music.core.lyric.DesktopLyricLine
import cn.toside.music.nativeapp.data.SettingsRuntime
import cn.toside.music.nativeapp.player.LyricsState
import cn.toside.music.nativeapp.player.PlayerRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * 桌面歌词浮窗服务 —— 对照 RN `mobile/lyric/Lyric*.java` 的窗口部分。
 *
 * - 窗口：`TYPE_APPLICATION_OVERLAY`，百分比定位，拖动后把百分比存回设置；
 * - 内容：订阅 [PlayerRuntime.lyrics] 公开流，按 [PlayerRuntime.positionMs] 每 200ms
 *   重算当前行，只在该换行时更新 TextView（TextSwitcher 才有动画）；
 * - 启停：只由 [DesktopLyricController] 拉起/停止，没有独立通知。
 *
 * 不持有播放器/歌词解析：全部走 PlayerRuntime 的公开接口，避免和 `player/` 内部耦合。
 */
class DesktopLyricService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var windowManager: WindowManager
    private lateinit var runtime: PlayerRuntime
    private var overlay: DesktopLyricOverlay? = null
    private var params: WindowManager.LayoutParams? = null
    private var config: DesktopLyricConfig? = null
    private var maxWidth = 0
    private var maxHeight = 0
    private var lyrics = LyricsState()
    private var positionMs = 0L
    private var lastTouchX = 0f
    private var lastTouchY = 0f
    private var userMoved = false

    private val settings get() = SettingsRuntime.get(applicationContext)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        runtime = PlayerRuntime.get(applicationContext)
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        if (!Settings.canDrawOverlays(this)) {
            // 权限在服务存活期间被回收：直接退出，由控制器把开关落回 false
            detach()
            stopSelf()
            return START_NOT_STICKY
        }
        attach()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        detach()
        scope.cancel()
        super.onDestroy()
    }

    private fun attach() {
        if (overlay != null) return
        val config = settings.store.desktopLyricConfig()
        this.config = config
        val metrics = screenSize()
        maxWidth = metrics.first
        maxHeight = metrics.second
        val overlay = DesktopLyricOverlay(this, config)
        val widthPx = DesktopLyricLine.windowWidth(maxWidth, config.widthPercent)
        val heightPx = DesktopLyricLine.windowHeight(overlay.lineHeightPx(), config.maxLineNum, maxHeight)
        overlay.applySize(widthPx, heightPx)
        if (!config.locked) {
            overlay.setOnTouchListener { _, event -> handleDrag(event) }
        }
        val params = windowParams(config, widthPx, heightPx)
        this.overlay = overlay
        this.params = params
        runCatching { windowManager.addView(overlay, params) }
            .onFailure {
                this.overlay = null
                this.params = null
                stopSelf()
                return
            }
        // 持久值可能在服务启动后才 merge 完：读到了就按它重配一次；
        // 之后订阅设置流，锁定/字号/透明度/颜色/对齐/宽度都实时生效，不用重启服务。
        scope.launch {
            settings.ensureLoaded()
            refreshConfig()
            settings.state.collect { refreshConfig() }
        }
        scope.launch {
            runtime.lyrics.collect { state ->
                lyrics = state
                render()
            }
        }
        scope.launch {
            while (isActive) {
                positionMs = runtime.positionMs()
                render()
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    private fun detach() {
        val overlay = overlay ?: return
        runCatching { windowManager.removeView(overlay) }
        this.overlay = null
        params = null
    }

    private fun render() {
        val overlay = overlay ?: return
        val config = config ?: return
        val lines =
            DesktopLyricLine.lines(
                parsed = lyrics.parsed,
                positionMs = positionMs,
                singleLine = config.singleLine,
                maxLineNum = config.maxLineNum,
            )
        overlay.setLyric(lines.joinToString("\n"))
    }

    private fun refreshConfig() {
        val overlay = overlay ?: return
        val next = settings.store.desktopLyricConfig()
        val previous = config ?: next
        config = next
        overlay.applyConfig(next)
        resize(overlay, next)
        val params = params ?: return
        params.flags = windowFlags(next)
        params.alpha =
            if (next.locked && Build.VERSION.SDK_INT > Build.VERSION_CODES.R) LOCKED_ALPHA else 1f
        if (!userMoved) {
            val position =
                DesktopLyricLine.clampPosition(
                    maxWidthPx = maxWidth,
                    maxHeightPx = maxHeight,
                    widthPx = params.width,
                    heightPx = params.height,
                    percentX = next.positionX.toDouble(),
                    percentY = next.positionY.toDouble(),
                )
            params.x = position.x
            params.y = position.y
        }
        overlay.setOnTouchListener(
            if (next.locked) {
                null
            } else {
                View.OnTouchListener { _, event -> handleDrag(event) }
            },
        )
        runCatching { windowManager.updateViewLayout(overlay, params) }
        if (previous.locked != next.locked) render()
    }

    /** 按设置算窗口宽高；高度依赖字号，所以每次都从视图实际字体度量取行高。 */
    private fun resize(
        overlay: DesktopLyricOverlay,
        config: DesktopLyricConfig,
    ) {
        val widthPx = DesktopLyricLine.windowWidth(maxWidth, config.widthPercent)
        val heightPx = DesktopLyricLine.windowHeight(overlay.lineHeightPx(), config.maxLineNum, maxHeight)
        overlay.applySize(widthPx, heightPx)
        params?.apply {
            width = widthPx
            height = heightPx
        }
    }

    private fun windowParams(
        config: DesktopLyricConfig,
        widthPx: Int,
        heightPx: Int,
    ): WindowManager.LayoutParams {
        val position =
            DesktopLyricLine.clampPosition(
                maxWidthPx = maxWidth,
                maxHeightPx = maxHeight,
                widthPx = widthPx,
                heightPx = heightPx,
                percentX = config.positionX.toDouble(),
                percentY = config.positionY.toDouble(),
            )
        val params =
            WindowManager.LayoutParams(
                widthPx,
                heightPx,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                windowFlags(config),
                PixelFormat.TRANSPARENT,
            )
        params.gravity = Gravity.TOP or Gravity.START
        params.x = position.x
        params.y = position.y
        params.alpha =
            if (config.locked && Build.VERSION.SDK_INT > Build.VERSION_CODES.R) LOCKED_ALPHA else 1f
        return params
    }

    private fun windowFlags(config: DesktopLyricConfig): Int {
        var flags =
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        if (config.locked) {
            flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }
        return flags
    }

    private fun handleDrag(event: MotionEvent): Boolean {
        val overlay = overlay ?: return false
        val params = params ?: return false
        val maxX = (maxWidth - params.width).coerceAtLeast(0)
        val maxY = (maxHeight - params.height).coerceAtLeast(0)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastTouchX = event.rawX
                lastTouchY = event.rawY
            }
            MotionEvent.ACTION_MOVE -> {
                userMoved = true
                params.x = (params.x + (event.rawX - lastTouchX).toInt()).coerceIn(0, maxX)
                params.y = (params.y + (event.rawY - lastTouchY).toInt()).coerceIn(0, maxY)
                lastTouchX = event.rawX
                lastTouchY = event.rawY
                runCatching { windowManager.updateViewLayout(overlay, params) }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> savePosition(params)
        }
        return true
    }

    private fun savePosition(params: WindowManager.LayoutParams) {
        val config = config ?: return
        val x = DesktopLyricLine.percentOf(params.x, maxWidth).roundToInt().coerceIn(0, 100)
        val y = DesktopLyricLine.percentOf(params.y, maxHeight).roundToInt().coerceIn(0, 100)
        if (x == config.positionX && y == config.positionY) return
        this.config = config.copy(positionX = x, positionY = y)
        scope.launch {
            settings.ensureLoaded()
            settings.store.set(DesktopLyricKeys.POSITION_X, x)
            settings.store.set(DesktopLyricKeys.POSITION_Y, y)
        }
    }

    @Suppress("DEPRECATION")
    private fun screenSize(): Pair<Int, Int> =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.maximumWindowMetrics.bounds
            bounds.width() to bounds.height()
        } else {
            val point = android.graphics.Point()
            windowManager.defaultDisplay.getRealSize(point)
            point.x to point.y
        }

    private companion object {
        const val POLL_INTERVAL_MS = 200L
        const val LOCKED_ALPHA = 0.8f
    }
}
