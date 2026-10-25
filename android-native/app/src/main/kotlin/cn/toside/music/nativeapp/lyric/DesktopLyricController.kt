package cn.toside.music.nativeapp.lyric

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import cn.toside.music.nativeapp.data.SettingsRuntime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * 桌面歌词启停控制器（进程级单例）—— RN `components/DesktopLyricEnable.tsx` 的等价物。
 *
 * 流程对照 RN：
 * 1. 开：先查悬浮窗权限；有权限就起浮窗服务；没权限跳系统授权页（RN 是确认框后跳，
 *    MVP 直接跳），回到应用后再决定起服务还是把开关落回 false。
 * 2. 关：停服务。
 * 3. `desktopLyric.enable` 始终落库，冷启动后可据此恢复（RN `core/init/player/lyric.ts:33`）。
 *
 * 当前只在播放页「更多」弹层打开时调用 [sync]，没有 Application 级启动钩子；
 * 进程被杀后需要再进一次弹层才会恢复浮窗（已记入 lane 报告）。
 */
class DesktopLyricController private constructor(
    context: Context,
) {
    private val appContext = context.applicationContext
    private val settings = SettingsRuntime.get(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _enabled = MutableStateFlow(settings.store.bool(DesktopLyricKeys.ENABLE))
    private var waitingForPermission = false

    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    init {
        scope.launch {
            settings.ensureLoaded()
            sync()
        }
    }

    /** 按设置与权限纠正当前状态；弹层每次打开/回到前台都会调用。 */
    fun sync() {
        val stored = settings.store.bool(DesktopLyricKeys.ENABLE)
        when {
            stored && canDrawOverlays() -> {
                _enabled.value = true
                startService()
            }
            stored -> {
                // 权限被回收：与 RN 启动时一样把开关落回 false
                _enabled.value = false
                stopService()
                persist(false)
            }
            else -> {
                _enabled.value = false
                stopService()
            }
        }
    }

    fun setEnabled(enabled: Boolean) {
        if (enabled) {
            if (!canDrawOverlays()) {
                // 先记下「想要开」，授权回来后由 [onActivityResumed] 接着起服务
                waitingForPermission = true
                _enabled.value = true
                persist(true)
                toast("请允许本应用显示在其他应用的上层")
                openPermissionSettings()
                return
            }
            startService()
        } else {
            waitingForPermission = false
            stopService()
        }
        _enabled.value = enabled
        persist(enabled)
    }

    /** 授权页返回：用户开没开权限都以系统事实为准。 */
    fun onActivityResumed() {
        if (!waitingForPermission) {
            sync()
            return
        }
        waitingForPermission = false
        if (canDrawOverlays()) {
            _enabled.value = true
            startService()
            persist(true)
        } else {
            _enabled.value = false
            stopService()
            persist(false)
            toast("未授予悬浮窗权限，桌面歌词已关闭")
        }
    }

    fun canDrawOverlays(): Boolean = Settings.canDrawOverlays(appContext)

    /**
     * 进程收尾用（RN exitApp 里的 `hideDesktopLyric()`）：只停浮窗服务，
     * **不改** `desktopLyric.enable`，下次启动仍按用户开关恢复。
     */
    fun shutdown() {
        waitingForPermission = false
        stopService()
    }

    private fun startService() {
        runCatching {
            appContext.startService(Intent(appContext, DesktopLyricService::class.java))
        }.onFailure {
            toast("桌面歌词启动失败：${it.message}")
        }
    }

    private fun stopService() {
        appContext.stopService(Intent(appContext, DesktopLyricService::class.java))
    }

    private fun persist(enabled: Boolean) {
        scope.launch {
            // 先等持久层合并完再写，避免把默认表整表覆盖回存储
            settings.ensureLoaded()
            settings.store.set(DesktopLyricKeys.ENABLE, enabled)
        }
    }

    private fun openPermissionSettings() {
        val intent =
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:${appContext.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val resolvable =
            appContext.packageManager
                .queryIntentActivities(intent, 0)
                .isNotEmpty()
        if (!resolvable || runCatching { appContext.startActivity(intent) }.isFailure) {
            toast("系统没有悬浮窗权限页，请到应用权限设置里手动开启")
        }
    }

    private fun toast(message: String) {
        Toast.makeText(appContext, message, Toast.LENGTH_SHORT).show()
    }

    companion object {
        @Volatile
        private var instance: DesktopLyricController? = null

        fun get(context: Context): DesktopLyricController =
            instance ?: synchronized(this) {
                instance ?: DesktopLyricController(context.applicationContext).also { instance = it }
            }
    }
}

/** 从 Compose 的 LocalContext 里找到宿主 Activity（Context 可能被主题包装过）。 */
internal fun Context.findComponentActivity(): ComponentActivity? =
    when (this) {
        is ComponentActivity -> this
        is ContextWrapper -> baseContext.findComponentActivity()
        else -> null
    }
