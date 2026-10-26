package cn.toside.music.nativeapp.ui.list

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import cn.toside.music.core.local.LocalImportProgress
import cn.toside.music.nativeapp.data.LocalMusicRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle

/**
 * 本地文件导入弹层（对照 RN `list_select_local_file_*` 四条文案与流程）。
 *
 * RN 的进度只靠 toast（「已快速添加到当前列表，现在将进入文件标签读取流程」）+
 * 结束时一条结果 toast；这里做成一个可观察的弹层：导入中显示进度与「取消」，
 * 结束后显示结果汇总（成功/失败条数照抄 RN 文案）。
 *
 * Wave6 追加「重新定位失效曲目（N）」入口：N = 当前列表里 document URI 已失效的
 * 曲目数（[staleCount]），0 时按钮不渲染。默认参数保证既有调用方（HomePage 的
 * 常驻弹层）不传也编译通过，只有列表详情页会接上真实的失效计数。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun LocalFileImportDialog(
    listTitle: String,
    progress: LocalImportProgress?,
    outcome: LocalMusicRuntime.Outcome?,
    onCancel: () -> Unit,
    onDismiss: () -> Unit,
    staleCount: Int = 0,
    relinking: Boolean = false,
    relinkOutcome: LocalMusicRuntime.RelinkOutcome? = null,
    onRelink: () -> Unit = {},
) {
    BasicDialog(onDismissRequest = { if (outcome != null) onDismiss() }) {
        DialogTitle(text = "添加本地歌曲")
        Text(text = "目标列表：$listTitle", color = SaltTheme.colors.subText)

        if (outcome == null) {
            Text(text = localImportProgressText(progress), color = SaltTheme.colors.text)
            ImportProgressBar(ratio = progress?.ratio ?: 0f)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onCancel,
                    text = "取消",
                    appearance = ButtonAppearance.Subtle,
                    modifier = Modifier.weight(1f),
                )
            }
        } else {
            Text(text = localImportResultText(outcome), color = SaltTheme.colors.text)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onDismiss,
                    text = "完成",
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (staleCount > 0) {
            Spacer(Modifier.height(10.dp))
            when {
                relinking -> Text(text = "正在重新定位失效曲目…", color = SaltTheme.colors.text)
                relinkOutcome != null -> Text(text = relinkResultText(relinkOutcome), color = SaltTheme.colors.text)
                else ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = onRelink,
                            text = relinkButtonText(staleCount),
                            modifier = Modifier.weight(1f),
                        )
                    }
            }
        }
    }
}

/** 细进度条：Compose material 不在依赖里（SaltUI 不向下游传递），用 Canvas 自绘。 */
@Composable
private fun ImportProgressBar(ratio: Float) {
    val track = SaltTheme.colors.stroke
    val accent = SaltTheme.colors.highlight
    Canvas(
        Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .height(4.dp),
    ) {
        val radius = CornerRadius(size.height / 2f, size.height / 2f)
        drawRoundRect(color = track, size = size, cornerRadius = radius)
        drawRoundRect(
            color = accent,
            size = Size(size.width * ratio.coerceIn(0f, 1f), size.height),
            cornerRadius = radius,
        )
    }
}

/**
 * 导入中的进度文案。
 *
 * `total == 0` 表示还在扫目录（SAF 列目录是异步的），此时给「正在扫描」而不是空白；
 * 之后的文案对照 RN `list_select_local_file_temp_add_tip`（共找到 N 个符合要求的文件…）。
 */
internal fun localImportProgressText(progress: LocalImportProgress?): String {
    if (progress == null || progress.total == 0) return "正在扫描所选目录…"
    return buildString {
        append("共找到 ${progress.total} 个符合要求的文件，已快速添加到当前列表。\n")
        append("正在读取文件标签 ${progress.processed}/${progress.total}")
        if (progress.failed > 0) append("，失败 ${progress.failed}")
        append("，请勿退出应用！")
    }
}

/**
 * 结束文案，逐字对照 RN：
 * - `list_select_local_file_empty_tip`：没有在当前文件夹中发现歌曲
 * - `list_select_local_file_result_tip`：共发现 {total} 首歌曲，已全部添加！
 * - `list_select_local_file_result_failed_tip`：共发现 {total} 首歌曲，成功添加 {success} 首，失败 {failed} 首…
 */
internal fun localImportResultText(outcome: LocalMusicRuntime.Outcome): String =
    when {
        outcome.isEmptyDir -> "没有在当前文件夹中发现歌曲"
        outcome.cancelled -> "已取消。共 ${outcome.total} 首，已添加 ${outcome.added} 首，失败 ${outcome.failed} 首"
        outcome.failed == 0 -> "共发现 ${outcome.total} 首歌曲，已全部添加！"
        else ->
            "共发现 ${outcome.total} 首歌曲，成功添加 ${outcome.added} 首，" +
                "失败 ${outcome.failed} 首（失败的已从列表移除）"
    }

/** 重定位入口按钮文案（N = 失效曲目数）。 */
internal fun relinkButtonText(stale: Int): String = "重新定位失效曲目（$stale）"

/**
 * 重定位结果文案。歧义/未命中的曲目**保留在列表里**（不删），文案要明说，
 * 否则「失效曲目还在列表」会被当成 bug 报上来。
 */
internal fun relinkResultText(outcome: LocalMusicRuntime.RelinkOutcome): String {
    if (outcome.noPermission) return "没有可用的文件夹授权，无法重扫目录。请重新导入一次本地歌曲以恢复授权后再试。"
    if (outcome.stale == 0) return "列表里没有失效曲目"
    return buildString {
        append("共 ${outcome.stale} 首失效，恢复 ${outcome.matched} 首")
        if (outcome.unmatched > 0) append("，未找到 ${outcome.unmatched} 首")
        if (outcome.ambiguous > 0) append("，歧义 ${outcome.ambiguous} 首")
        append("（未恢复的曲目仍保留在列表中，未被删除）")
    }
}
