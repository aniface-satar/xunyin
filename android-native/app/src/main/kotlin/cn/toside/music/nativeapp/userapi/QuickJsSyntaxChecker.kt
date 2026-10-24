package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.userapi.ScriptSyntaxChecker
import com.whl.quickjs.android.QuickJSLoader
import com.whl.quickjs.wrapper.QuickJSContext
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * 语法闸门：把候选脚本交给 QuickJS 只编译、不执行。
 *
 * 编译能认出「只下了一半」的更新（截断、括号不配对）；不执行是为了不让还没落盘的
 * 新脚本在网络和存储写入之前就跑起来。
 *
 * QuickJS 上下文有线程亲和性（create/compile/destroy 必须在同一线程），所以每次检查
 * 独占一条线程。超时后连线程一起丢掉：卡住的编译不该把后面的检查全堵在队列里。
 */
class QuickJsSyntaxChecker : ScriptSyntaxChecker {
    private companion object {
        const val CHECK_TIMEOUT_SECONDS = 20L
    }

    override fun check(script: String): String? {
        val executor =
            Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "UserApiSyntaxCheck").apply { isDaemon = true }
            }
        return try {
            executor.submit<String?> { compile(script) }.get(CHECK_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (e: TimeoutException) {
            "脚本语法检查超时"
        } catch (e: ExecutionException) {
            e.cause?.message ?: "脚本语法检查失败"
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            "脚本语法检查被中断"
        } finally {
            executor.shutdownNow()
        }
    }

    private fun compile(script: String): String? {
        QuickJSLoader.init()
        val context = QuickJSContext.create()
        return try {
            context.compile(script)
            null
        } catch (e: Throwable) {
            e.message ?: "脚本语法不完整"
        } finally {
            runCatching { context.destroy() }
        }
    }
}
