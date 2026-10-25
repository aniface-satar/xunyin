package cn.toside.music.nativeapp.ui.list

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.list.DuplicateMusic
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import com.moriafly.salt.ui.dialog.YesNoDialog
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * 重复歌曲弹层（对照 RN `MyList/DuplicateMusic.tsx`）。
 *
 * 分组规则在 `core/list/DuplicateMusic`：清掉 (Live)/(Remix) 等变体后缀与标点后同名的
 * 歌曲归为一组，只展示成员 ≥2 的组，组间按名称排序。点击行切换选中，
 * 「移除」在有选中时批量删、无选中时只删当前行（RN `handleRemovePress`）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun DuplicateMusicDialog(
    title: String,
    items: List<JsonObject>,
    localeId: String,
    onDismiss: () -> Unit,
    onPlay: (String) -> Unit,
    onRemove: (List<String>) -> Unit,
) {
    val entries = remember(items, localeId) { DuplicateMusic.filter(items, localeId = localeId) }
    var selectedIds by remember(items) { mutableStateOf<Set<String>>(emptySet()) }
    var confirmRemove by remember { mutableStateOf(false) }

    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = "重复歌曲 · $title")
        if (entries.isEmpty()) {
            BasicText(
                text = "列表竟然是空的...",
                modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 14.sp),
            )
        } else {
            LazyColumn(Modifier.heightIn(max = 400.dp)) {
                items(entries, key = { it.id }) { entry ->
                    val music = entry.music
                    val selected = entry.id in selectedIds
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (selected) {
                                        SaltTheme.colors.highlight.copy(alpha = 0.10f)
                                    } else {
                                        Color.Transparent
                                    },
                                ).clickable {
                                    selectedIds = if (selected) selectedIds - entry.id else selectedIds + entry.id
                                }.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            BasicText(
                                text = music.text("name").orEmpty(),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style =
                                    TextStyle(
                                        color = SaltTheme.colors.text,
                                        fontSize = 14.sp,
                                        fontWeight = FontWeight.Medium,
                                    ),
                            )
                            val album = (music["meta"] as? JsonObject)?.text("albumName").orEmpty()
                            val meta =
                                listOfNotNull(
                                    music.text("singer")?.takeIf { it.isNotBlank() },
                                    album.takeIf { it.isNotBlank() },
                                ).joinToString(" · ")
                            BasicText(
                                text = meta,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                            )
                        }
                        BasicText(
                            text =
                                listOfNotNull(music.text("source"), music.text("interval"))
                                    .filter { it.isNotBlank() }
                                    .joinToString(" · "),
                            modifier = Modifier.padding(horizontal = 6.dp),
                            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
                        )
                        RowAction("播放", enabled = true) { onPlay(entry.id) }
                        RowAction("移除", enabled = true) {
                            if (selectedIds.isEmpty()) onRemove(listOf(entry.id)) else confirmRemove = true
                        }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = onDismiss,
                text = "关闭",
                appearance = ButtonAppearance.Subtle,
                modifier = Modifier.weight(1f),
            )
        }
    }

    if (confirmRemove) {
        YesNoDialog(
            onDismissRequest = { confirmRemove = false },
            onConfirm = {
                confirmRemove = false
                val ids = selectedIds.toList()
                selectedIds = emptySet()
                onRemove(ids)
            },
            title = "移除歌曲",
            content = "你真的想要移除所选的 ${selectedIds.size} 首歌曲吗？",
            cancelText = "取消",
            confirmText = "是的，没错",
        )
    }
}

@Composable
private fun RowAction(
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    BasicText(
        text = label,
        modifier =
            Modifier
                .clip(RoundedCornerShape(8.dp))
                .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(horizontal = 8.dp, vertical = 8.dp),
        style =
            TextStyle(
                color = if (enabled) SaltTheme.colors.highlight else SaltTheme.colors.subText.copy(alpha = 0.4f),
                fontSize = 13.sp,
            ),
    )
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
