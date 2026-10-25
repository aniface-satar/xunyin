package cn.toside.music.nativeapp.ui.songlist

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import cn.toside.music.core.storage.StorageKeys
import cn.toside.music.nativeapp.data.ListRuntime
import com.moriafly.salt.ui.Item
import com.moriafly.salt.ui.ItemArrowType
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle

/**
 * 「加入我的歌单」列表选择弹层（搜索页与在线歌单详情共用）。
 *
 * 条目顺序对照 RN `MusicAddModal/List`：试听列表 → 我的收藏 → 用户自建歌单。
 * 去重与插入位置由 [cn.toside.music.core.list.ListStore.listMusicAdd] 负责，
 * 这里只把选中的 listId 交给调用方。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun AddToListDialog(
    title: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    val context = LocalContext.current
    val lists = remember { ListRuntime.get(context) }
    val listState by lists.store.state.collectAsState()
    LaunchedEffect(Unit) { lists.ensureLoaded() }
    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(title)
        Item(
            onClick = { onPick(StorageKeys.ListIds.DEFAULT) },
            text = "试听列表",
            arrowType = ItemArrowType.None,
        )
        Item(
            onClick = { onPick(StorageKeys.ListIds.LOVE) },
            text = "我的收藏",
            arrowType = ItemArrowType.None,
        )
        listState.userLists.forEach { info ->
            Item(
                onClick = { onPick(info.id) },
                text = info.name,
                arrowType = ItemArrowType.None,
            )
        }
    }
}
