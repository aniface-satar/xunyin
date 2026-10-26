package cn.toside.music.nativeapp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import cn.toside.music.nativeapp.deeplink.DeeplinkRuntime

/**
 * 单 Activity 宿主。
 *
 * deeplink 两个入口都在这里：冷启动走 [onCreate] 的 initial intent，
 * 已在前台/后台走 [onNewIntent]——所以 `AndroidManifest` 给 MainActivity 加了
 * `launchMode="singleTop"`（本应用只有一个 Activity，singleTop 等价于「复用当前实例」，
 * 不需要 singleTask 那种清栈副作用）。方向属性未动（AGENTS.md 竖屏约束）。
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        DeeplinkRuntime.dispatch(this, intent)
        setContent {
            MusicApp()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // 让 getIntent() 与最新一次保持一致（返回前台再取 intent 拿到的是旧值）
        setIntent(intent)
        DeeplinkRuntime.dispatch(this, intent)
    }
}
