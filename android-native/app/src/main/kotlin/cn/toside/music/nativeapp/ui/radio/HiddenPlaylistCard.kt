package cn.toside.music.nativeapp.ui.radio

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.nativeapp.data.HiddenPlaylistEntry
import cn.toside.music.nativeapp.data.RecommendStores
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.Text
import com.moriafly.salt.ui.UnstableSaltUiApi
import kotlinx.coroutines.launch

/**
 * 「被隐藏的推荐歌单」管理卡（任务 7 的恢复入口）—— 落在电台页而不是推荐页。
 *
 * 理由：推荐页只有「隐藏」这一个动作（长按歌单），恢复是低频操作，
 * 放在电台页的设置区不会把推荐列表挤满；`PlaylistRank` 的过滤只看 key，
 * 所以隐藏后列表里那些歌单会直接消失，不给恢复入口就等于永久删掉了。
 *
 * 空表时整卡不渲染（没隐藏过就别多一块 UI）。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun HiddenPlaylistCard() {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<Map<String, HiddenPlaylistEntry>>(emptyMap()) }
    var loaded by remember { mutableStateOf(false) }
    var expanded by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        entries = runCatching { RecommendStores.hidden.entries() }.getOrElse { emptyMap() }
        loaded = true
    }
    if (!loaded || entries.isEmpty()) return

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 6.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(SaltTheme.colors.subBackground)
                .padding(14.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "已隐藏的歌单 ${entries.size}",
                modifier = Modifier.weight(1f),
                color = SaltTheme.colors.text,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = if (expanded) "收起" else "管理",
                color = SaltTheme.colors.highlight,
                fontSize = 13.sp,
            )
        }
        if (!expanded) return@Column

        Text(
            text = "在推荐页长按歌单即可隐藏；隐藏后它不会再出现在推荐列表里，排序也会跳过。",
            modifier = Modifier.padding(top = 8.dp),
            color = SaltTheme.colors.subText,
            fontSize = 12.sp,
        )
        val ordered = entries.entries.sortedByDescending { it.value.hiddenAt }
        for ((key, entry) in ordered) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = entry.name.ifEmpty { key },
                    modifier = Modifier.weight(1f),
                    color = SaltTheme.colors.text,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Box(
                    modifier =
                        Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(SaltTheme.colors.highlight.copy(alpha = 0.12f))
                            .clickable {
                                scope.launch {
                                    entries = runCatching { RecommendStores.hidden.unhide(key) }.getOrElse { entries }
                                }
                            }.padding(horizontal = 10.dp, vertical = 6.dp),
                ) {
                    Text(text = "恢复", color = SaltTheme.colors.highlight, fontSize = 13.sp)
                }
            }
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(SaltTheme.colors.background)
                    .clickable {
                        scope.launch {
                            runCatching { RecommendStores.hidden.clear() }
                            entries = emptyMap()
                        }
                    }.padding(vertical = 10.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(text = "全部恢复", color = SaltTheme.colors.highlight, fontSize = 13.sp)
        }
    }
}
