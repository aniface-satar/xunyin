package cn.toside.music.nativeapp.ui.settings

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.userapi.UpdatePreview
import cn.toside.music.core.userapi.UserApiInfo
import cn.toside.music.nativeapp.player.PlayerRuntime
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.ItemSpacer
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.dialog.InputDialog
import com.moriafly.salt.ui.dialog.YesNoDialog
import com.moriafly.salt.ui.screen.BasicScreen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * 自定义源管理页（对照 RN `Setting/settings/Basic/UserApiEditModal`）。
 *
 * RN 那边「选中哪个源」是单选按钮、「编辑」是另一颗按钮；这里一行只有一处可点，
 * 所以点一行打开这个源的操作面板，换源、改更新地址、检查更新和删除都在里面 ——
 * 手一滑就把正在播的源换掉，比多点一下更糟。
 *
 * 所有动作都走 [PlayerRuntime] 里那份运行时单例：换源要真的把脚本起来才写设置，
 * 删除要保住「正在用的源」和「随包内置源」两种不该删的，规则都在运行时那侧。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun UserApiManagePage(onBack: () -> Unit) {
    val context = LocalContext.current
    val userApi = remember { PlayerRuntime.get(context).userApi }
    val scope = rememberCoroutineScope()

    var sources by remember { mutableStateOf<List<UserApiInfo>>(emptyList()) }
    var currentId by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    var importUrlVisible by remember { mutableStateOf(false) }
    var importUrl by remember { mutableStateOf("") }
    var pasteVisible by remember { mutableStateOf(false) }
    var pasteText by remember { mutableStateOf("") }
    var actionsFor by remember { mutableStateOf<UserApiInfo?>(null) }
    var editUrlFor by remember { mutableStateOf<UserApiInfo?>(null) }
    var editUrl by remember { mutableStateOf("") }
    var deleteFor by remember { mutableStateOf<UserApiInfo?>(null) }
    var confirmUpdate by remember { mutableStateOf<Pair<UserApiInfo, UpdatePreview>?>(null) }

    val showTip: (String) -> Unit = { message ->
        Toast.makeText(context, message, Toast.LENGTH_LONG).show()
    }

    suspend fun refresh() {
        sources = userApi.sources()
        currentId = userApi.currentSourceId
    }

    LaunchedEffect(Unit) { refresh() }

    /** 导入、检查更新这些都要走网络，慢的时候顶部提示「处理中…」并吃掉新的点击，免得连点两次。 */
    fun runBusy(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                showTip(e.message ?: "操作失败")
            } finally {
                busy = false
            }
        }
    }

    BasicScreen(onBack = onBack, title = "自定义源管理") { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(padding),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ItemSpacer()
            Text(
                text = if (busy) "处理中…" else "点一行看这个源的操作：换用、改更新地址、检查更新、删除。",
                color = SaltTheme.colors.subText,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            Item(
                onClick = {
                    importUrl = ""
                    importUrlVisible = true
                },
                text = "按地址导入",
                arrowType = ItemArrowType.Arrow,
            )
            Item(
                onClick = {
                    pasteText = ""
                    pasteVisible = true
                },
                text = "粘贴脚本导入",
                arrowType = ItemArrowType.Arrow,
            )
            ItemSpacer()
            sources.forEach { source ->
                Item(
                    onClick = {
                        actionsFor = source
                        editUrl = source.updateUrl
                    },
                    text = source.name.ifEmpty { source.id } + "  ${source.version}",
                    tag = sourceTags(source.id == currentId, source.builtin),
                    arrowType = ItemArrowType.Arrow,
                )
            }
            ItemSpacer()
            Text(
                text = "提示：脚本已经尽量关在沙箱里跑，但导入来路不明的源仍然可能出问题，请只导入你信任的脚本。",
                color = SaltTheme.colors.subText,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
            ItemSpacer()
        }
    }

    // ---------- 导入 ----------
    if (importUrlVisible) {
        InputDialog(
            onDismissRequest = { importUrlVisible = false },
            onConfirm = {
                importUrlVisible = false
                val url = importUrl.trim()
                if (url.isNotEmpty()) {
                    runBusy {
                        val result = userApi.importFromUrl(url)
                        refresh()
                        result
                            .onSuccess { showTip("导入成功：${it.name}") }
                            .onFailure { showTip("自定义源导入失败：${it.message}") }
                    }
                }
            },
            onChange = { importUrl = it },
            title = "在线导入",
            text = importUrl,
            hint = "请输入脚本原文的 HTTP 链接",
            cancelText = "取消",
            confirmText = "导入",
        )
    }
    if (pasteVisible) {
        PasteScriptDialog(
            text = pasteText,
            onChange = { pasteText = it },
            onDismiss = { pasteVisible = false },
            onImport = {
                pasteVisible = false
                val script = pasteText
                runBusy {
                    val result = userApi.importScript(script)
                    refresh()
                    result
                        .onSuccess { showTip("导入成功：${it.name}") }
                        .onFailure { showTip("自定义源导入失败：${it.message}") }
                }
            },
        )
    }

    // ---------- 单个源的操作 ----------
    actionsFor?.let { source ->
        BasicDialog(onDismissRequest = { actionsFor = null }) {
            DialogTitle(text = source.name.ifEmpty { source.id })
            Text(
                text = "版本 ${source.version} · ${if (source.builtin != null) "随包内置源" else "自定义源"}",
                color = SaltTheme.colors.subText,
            )
            if (source.id != currentId) {
                Item(
                    onClick = {
                        actionsFor = null
                        runBusy {
                            val result = userApi.switchSource(source.id)
                            refresh()
                            if (result.isFailure) {
                                showTip("音源「${source.name}」加载失败：${result.exceptionOrNull()?.message ?: "未知错误"}")
                            }
                        }
                    },
                    text = "使用这个源",
                    arrowType = ItemArrowType.None,
                )
            }
            Item(
                onClick = {
                    editUrlFor = source
                    editUrl = source.updateUrl
                    actionsFor = null
                },
                text = "更新地址",
                tag = if (source.updateUrl.isEmpty()) "未填" else "已填",
                arrowType = ItemArrowType.None,
            )
            Item(
                onClick = {
                    actionsFor = null
                    runBusy {
                        val preview = userApi.updater.preview(source.id)
                        val tip = userApiCheckTip(preview, source.name)
                        if (tip != null) showTip(tip) else confirmUpdate = source to preview
                    }
                },
                text = "检查更新",
                arrowType = ItemArrowType.None,
            )
            Item(
                onClick = {
                    actionsFor = null
                    deleteFor = source
                },
                text = "删除这个源",
                arrowType = ItemArrowType.None,
            )
        }
    }

    // ---------- 更新地址 ----------
    editUrlFor?.let { source ->
        InputDialog(
            onDismissRequest = { editUrlFor = null },
            onConfirm = {
                editUrlFor = null
                val url = editUrl.trim()
                val cleared = url.isEmpty() && source.updateUrl.isNotEmpty()
                runBusy {
                    userApi.store.setUpdateUrl(source.id, url)
                    refresh()
                    if (cleared) showTip("已清空更新地址，以后不再自动检查这个源")
                }
            },
            onChange = { editUrl = it },
            title = "更新地址",
            text = editUrl,
            hint = "填你平时用浏览器打开、能看到脚本原文的那个链接；留空则用这个源自己报的地址。",
            cancelText = "取消",
            confirmText = "保存",
        )
    }

    // ---------- 检查到结果，问要不要换上 ----------
    confirmUpdate?.let { (source, preview) ->
        YesNoDialog(
            onDismissRequest = { confirmUpdate = null },
            onConfirm = {
                confirmUpdate = null
                runBusy {
                    val outcome = userApi.updater.apply(source.id, preview, allowDowngrade = preview is UpdatePreview.Older)
                    refresh()
                    showTip(userApiUpdateOutcomeTip(outcome))
                }
            },
            title = "检查更新",
            content = userApiUpdateConfirmTip(preview) ?: "发现新的脚本内容，要换上吗？",
            cancelText = "取消",
            confirmText = "更新",
        )
    }

    // ---------- 删除 ----------
    deleteFor?.let { source ->
        YesNoDialog(
            onDismissRequest = { deleteFor = null },
            onConfirm = {
                deleteFor = null
                runBusy {
                    when {
                        source.id == currentId -> showTip("正在使用的源不能删，先换用别的源")
                        source.builtin != null -> showTip("随包内置的源删不掉：下次启动它还会回来")
                        userApi.removeSource(source.id) -> {
                            refresh()
                            showTip("已移除「${source.name}」")
                        }
                        else -> showTip("这个源已经不在了，返回列表再进来一次看看")
                    }
                }
            },
            title = "删除源",
            content = "你真的要移除「${source.name}」吗？",
            cancelText = "取消",
            confirmText = "移除",
        )
    }
}

/**
 * 粘贴脚本导入：一份源脚本是几十到几百行，[InputDialog] 那种单行输入框装不下，
 * 所以这里用可上下滚的多行输入框。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
private fun PasteScriptDialog(
    text: String,
    onChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onImport: () -> Unit,
) {
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = "粘贴脚本导入")
        Text(
            text = "把源脚本的全文粘进来，第一行必须是带 @name 的头部注释，不然认不出是音源。",
            color = SaltTheme.colors.subText,
        )
        BasicTextField(
            value = text,
            onValueChange = onChange,
            modifier =
                Modifier
                    .fillMaxSize()
                    .widthIn(max = 320.dp)
                    .heightIn(min = 140.dp, max = 260.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SaltTheme.colors.subBackground)
                    .padding(12.dp),
            textStyle = TextStyle(color = SaltTheme.colors.text, fontSize = 12.sp),
            cursorBrush = SolidColor(SaltTheme.colors.highlight),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onDismiss,
                text = "取消",
                appearance = ButtonAppearance.Subtle,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = onImport,
                text = "导入",
                modifier = Modifier.weight(1f),
            )
        }
    }
}
