package cn.toside.music.nativeapp.lyric

import android.app.NotificationChannel
import android.app.NotificationManager
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
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
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

/**
 * 桌面歌词浮窗服务 —— 对照 RN `mobile/lyric/Lyric*.java` 的窗口部分。
 *
 * - 窗口：`TYPE_APPLICATION_OVERLAY`，百分比定位，拖动后把百分比存回设置；
 * - 内容：订阅 [PlayerRuntime.lyrics] 公开流，按 [PlayerRuntime.positionMs] 每 200ms
 *   重算当前行，只在该换行时更新 TextView（TextSwitcher 才有动画）；
 * - 启停：只由 [DesktopLyricController] 拉起/停止；
 * - 前台身份（W7）：`specialUse` 类型 FGS——浮窗要长时间驻留，没有前台身份会被
 *   低内存与 OEM 策略优先回收（w3-A 任务 5 建议 2）；通知只做身份证明，不交互。
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
        // startForegroundService 语义下必须先拿到前台身份再谈退出，否则 5 秒内 stopSelf 会崩
        goForeground()
        if (!Settings.canDrawOverlays(this)) {
            // 权限在服务存活期间被回收：直接退出，由控制器把开关落回 false
            detach()
            stopSelf()
            return START_NOT_STICKY
        }
        attach()
        return START_NOT_STICKY
    }

    /** FGS 身份：常驻静默通知（W7）。MIN_API 26 起必须走渠道。 */
    private fun goForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "桌面歌词",
                    NotificationManager.IMPORTANCE_MIN,
                ).apply {
                    setShowBadge(false)
                    setSound(null, null)
                },
            )
        }
        val notification =
            NotificationCompat
                .Builder(this, CHANNEL_ID)
                .setSmallIcon(cn.toside.music.nativeapp.R.drawable.ic_launcher_foreground)
                .setContentTitle("桌面歌词运行中")
                .setContentText("正在展示当前播放歌曲的歌词浮窗")
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build()
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            },
        )
    }

    override fun onDestroy() {
        detach()
        scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
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
                showTranslation = config.showTranslation,
                showRoma = config.showRoma,
            )
        overlay.setLyric(lines)
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
                    percentX = next.positionX,
                    percentY = next.positionY,
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
                percentX = config.positionX,
                percentY = config.positionY,
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

    /**
     * 松手后把百分比写回设置。
     *
     * W7 写侧：RN 写的是 `x / maxWidth * 100` 的浮点数（会出现 `33.5` 这种值），
     * 这里同样写浮点（保留两位小数），与 RN 落盘形状对齐。
     *
     * W8 读侧（W7-1 收口）：字段与内存快照都保留小数，不再 `roundToInt` 回读；
     * 重启后不再截断还依赖 Lane A 把 `desktopLyric.position.x/y` 默认值改成 `0.0`
     * （Int 默认会在 `SettingsStore.merge` 时把 33.5 收窄成 33）——并流后全链路等值往返。
     */
    private fun savePosition(params: WindowManager.LayoutParams) {
        val config = config ?: return
        val rawX = DesktopLyricLine.percentOf(params.x, maxWidth).coerceIn(0.0, 100.0)
        val rawY = DesktopLyricLine.percentOf(params.y, maxHeight).coerceIn(0.0, 100.0)
        val x = DesktopLyricScrollMath.roundPercent(rawX)
        val y = DesktopLyricScrollMath.roundPercent(rawY)
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
        const val CHANNEL_ID = "desktop_lyric"
        const val NOTIFICATION_ID = 41
    }
}
