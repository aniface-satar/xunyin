package cn.toside.music.nativeapp.ui.radio

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import cn.toside.music.core.recommend.m3.Onboarding
import com.moriafly.salt.ui.Button
import com.moriafly.salt.ui.ButtonAppearance
import com.moriafly.salt.ui.SaltTheme
import com.moriafly.salt.ui.UnstableSaltUiApi
import com.moriafly.salt.ui.dialog.BasicDialog
import com.moriafly.salt.ui.dialog.DialogTitle
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 偏好问卷（RN `Onboarding.tsx` 的四档版）。
 *
 * 与 RN 的差异：RN 用 0-100 连续滑条，原生（W5-6）用**四档吸附滑条**——自绘、零新依赖
 * （项目只有 foundation + SaltUI，不引 material）。**持久化形状完全一致** —— 写进
 * `onboarding.weights` 的仍是百分数（0/50/70/100），所以语种配额、
 * 分类播种（以 50% 为中轴，0% 会产生负权）都不受 UI 直接影响。
 *
 * 换成滑条后档位语义一个字没动（见 [TIERS]）：改的只是「怎么选」，
 * 不是「选了之后落什么值」，因此不需要动 `Onboarding` / 推荐侧的任何一个数。
 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun OnboardingSheet(
    initial: Map<String, Double>,
    onDismiss: () -> Unit,
    onSubmit: (Map<String, Double>) -> Unit,
) {
    val scope = rememberCoroutineScope()
    var answers by remember(initial) { mutableStateOf(initial) }
    var hint by remember { mutableStateOf<String?>(null) }
    val languageOptions = remember { Onboarding.OPTIONS.filter { it.question == Onboarding.Question.LANGUAGE } }
    val genreOptions = remember { Onboarding.OPTIONS.filter { it.question == Onboarding.Question.GENRE } }
    val onPick: (String, Double) -> Unit = { id, percent ->
        answers =
            if (percent == Onboarding.NEUTRAL_PERCENT.toDouble()) {
                answers - id
            } else {
                answers + (id to percent)
            }
    }

    BasicDialog(onDismissRequest = onDismiss) {
        DialogTitle(text = "偏好设置")
        BasicText(
            text = "拖动滑条选档位，改完立刻生效。「无所谓」等于没表态，不会影响推荐。",
            modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
            style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
        )
        LazyColumn(Modifier.heightIn(max = 420.dp)) {
            item(key = "lang-header") { GroupTitle("常听的语种") }
            items(languageOptions, key = { "lang_${it.id}" }) { option ->
                OptionRow(
                    title = option.aliases.first(),
                    percent = answers[option.id] ?: Onboarding.NEUTRAL_PERCENT.toDouble(),
                    onPick = { onPick(option.id, it) },
                )
            }
            item(key = "genre-header") { GroupTitle("喜欢的风格") }
            items(genreOptions, key = { "genre_${it.id}" }) { option ->
                OptionRow(
                    title = option.aliases.first(),
                    percent = answers[option.id] ?: Onboarding.NEUTRAL_PERCENT.toDouble(),
                    onPick = { onPick(option.id, it) },
                )
            }
        }
        hint?.let {
            BasicText(
                text = it,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Button(
                onClick = {
                    // 跳过 = 空答案：只回退旧播种，不写新分量
                    scope.launch {
                        onSubmit(emptyMap())
                        onDismiss()
                    }
                },
                text = "跳过",
                appearance = ButtonAppearance.Subtle,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = {
                    val cleaned = Onboarding.sanitizeWeights(answers)
                    if (answers.isNotEmpty() && cleaned.isEmpty()) {
                        hint = "全部选了「无所谓」等于没表态，点具体档位或直接跳过。"
                    } else {
                        scope.launch {
                            onSubmit(cleaned)
                            onDismiss()
                        }
                    }
                },
                text = "保存",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** 问卷入口卡片（推荐面板顶部；答过卷后变成一行「修改」入口，避免每次都占一大块）。 */
@OptIn(UnstableSaltUiApi::class)
@Composable
fun OnboardingEntryCard(
    answered: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (answered) {
                        SaltTheme.colors.subBackground
                    } else {
                        SaltTheme.colors.highlight.copy(alpha = 0.12f)
                    },
                ).clickable(onClick = onClick)
                .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            BasicText(
                text = if (answered) "偏好已设置" else "先花 30 秒设置偏好",
                style =
                    TextStyle(
                        color = SaltTheme.colors.text,
                        fontSize = if (answered) 14.sp else 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
            )
            BasicText(
                text =
                    if (answered) {
                        "语种与风格偏好会参与电台配额与分类播种，点这里修改"
                    } else {
                        "电台按你的口味取曲：告诉它你常听什么语种、喜欢什么风格"
                    },
                modifier = Modifier.padding(top = 4.dp),
                style = TextStyle(color = SaltTheme.colors.subText, fontSize = 12.sp),
            )
        }
        BasicText(
            text = if (answered) "修改 ›" else "去设置 ›",
            style = TextStyle(color = SaltTheme.colors.highlight, fontSize = 13.sp, fontWeight = FontWeight.Medium),
        )
    }
}

@Composable
private fun GroupTitle(text: String) {
    BasicText(
        text = text,
        modifier = Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 4.dp),
        style = TextStyle(color = SaltTheme.colors.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold),
    )
}

/**
 * 四档档位（W5-6 换滑条后**语义逐字不动**）：
 *
 * - 不想听 = 0% → 最强负播种，且语种配额给 0 首；
 * - 无所谓 = 50% → 中性，[Onboarding.sanitizeWeights] 直接丢弃（等于没表态）；
 * - 喜欢 / 很喜欢 = 70% / 100%。
 */
private val TIERS =
    listOf(
        0.0 to "不想听",
        50.0 to "无所谓",
        70.0 to "喜欢",
        100.0 to "很喜欢",
    )

/** 档位下标（0..3）；不在四档上的值取最近的一档。 */
internal fun tierIndexOf(percent: Double): Int = TIERS.indices.minByOrNull { abs(TIERS[it].first - percent) } ?: 0

/** 档位下标 → 落库的百分数。 */
internal fun percentOfTier(index: Int): Double = TIERS[index.coerceIn(TIERS.indices)].first

/**
 * 滑条位置（0..1）→ 落库的百分数：吸附到最近档位。
 *
 * **只换控件不改语义**：落库值仍然是四档那四个 Double，
 * 所以 [Onboarding.sanitizeWeights] / 语种配额 / 分类播种全部照旧。
 */
internal fun snapTierPercent(fraction: Float): Double {
    val index = (fraction * (TIERS.size - 1)).roundToInt().coerceIn(0, TIERS.size - 1)
    return percentOfTier(index)
}

/**
 * 四档滑条（自绘，零新依赖：只用 foundation + SaltTheme 配色）。
 *
 * 与原来四个档位按钮的关系：**只换了控件**。点按轨/拖 thumb 都按最近档位吸附，
 * 落库的仍是 [TIERS] 里那四个百分数，「无所谓」依旧等于「从答案里移除」。
 */
@Composable
private fun OptionRow(
    title: String,
    percent: Double,
    onPick: (Double) -> Unit,
) {
    val index = tierIndexOf(percent)
    val fraction = index.toFloat() / (TIERS.size - 1)
    var trackPx by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val thumbSize = 16.dp
    val trackWidth = remember(trackPx, density) { with(density) { trackPx.toDp() } }
    val travelPx = (trackPx - with(density) { thumbSize.toPx() }).coerceAtLeast(0f)

    fun pickAt(offsetX: Float) {
        if (travelPx <= 0f) return
        val moved = ((offsetX - with(density) { thumbSize.toPx() } / 2f) / travelPx).coerceIn(0f, 1f)
        onPick(snapTierPercent(moved))
    }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BasicText(
                text = title,
                modifier = Modifier.weight(1f),
                style = TextStyle(color = SaltTheme.colors.text, fontSize = 13.sp),
            )
            BasicText(
                text = TIERS[index].second,
                style =
                    TextStyle(
                        color = if (index == 1) SaltTheme.colors.subText else SaltTheme.colors.highlight,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
            )
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(24.dp)
                    .onSizeChanged { trackPx = it.width.toFloat() }
                    .pointerInput(Unit) {
                        // 按下即取档（onDragStart 兼作点按），拖动过程连续吸附
                        detectDragGestures(
                            onDragStart = { pickAt(it.x) },
                            onDrag = { change, _ -> pickAt(change.position.x) },
                        )
                    },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(SaltTheme.colors.subBackground),
            )
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(SaltTheme.colors.highlight.copy(alpha = 0.5f)),
            )
            Box(
                modifier =
                    Modifier
                        .offset(x = ((trackWidth - thumbSize) * fraction).coerceAtLeast(0.dp))
                        .size(thumbSize)
                        .clip(CircleShape)
                        .background(SaltTheme.colors.highlight),
            )
        }
    }
}
