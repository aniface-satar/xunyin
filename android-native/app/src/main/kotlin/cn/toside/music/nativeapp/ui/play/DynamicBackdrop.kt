package cn.toside.music.nativeapp.ui.play

import android.os.Build
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import cn.toside.music.core.theme.CoverPalette
import cn.toside.music.core.theme.CoverPaletteExtractor

/**
 * 播放页背景（`theme.dynamicBg` / `theme.dynamicBgAlgorithm` 接线）。
 *
 * RN 侧两档（`src/utils/monet`）：
 * - `blur`（默认）：重度模糊封面直接铺底，再用测量色算出的蒙版压到白字可读；
 * - `monet`：封面量化源色 + 洗色后的纯色底（这里是 base→field 的纵向渐变，
 *   两端都已由 [CoverPaletteExtractor] 保证对白字 ≥ 4.5）。
 *
 * 取色只用 32px 缩略图（[CoverArt.blurSource]），一次 1024 像素，放在组合里同步算完；
 * 种子固定（[CoverPaletteExtractor.DEFAULT_SEED]），同一封面每次进页颜色一致。
 * 取色失败或封面未到时不硬切纯色：回落到模糊层，与改造前的观感连续。
 *
 * 关闭 `dynamicBg` 时铺 [themeBackground]（由调用方保证是深色；播放页墨色恒白，
 * 浅色主题仍给深底，见 lane 报告遗留）。
 */
@Composable
internal fun DynamicBackdrop(
    cover: CoverArt?,
    dynamicBg: Boolean,
    algorithm: String,
    themeBackground: Color,
) {
    val palette = remember(cover) { cover?.coverPalette() }
    Box(Modifier.fillMaxSize().background(themeBackground)) {
        if (cover != null && dynamicBg) {
            if (algorithm == "monet" && palette != null) {
                MonetLayer(palette)
            } else {
                BlurLayer(cover, palette)
            }
            ReadabilityGradient()
        }
    }
}

@Composable
private fun MonetLayer(palette: CoverPalette) {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to Color(palette.baseArgb),
                    0.55f to Color(palette.fieldArgb),
                    1f to Color(palette.baseArgb),
                ),
            ),
    )
}

@Composable
private fun BlurLayer(
    cover: CoverArt,
    palette: CoverPalette?,
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // API 31+：RenderEffect 硬件模糊
        Image(
            bitmap = cover.cover,
            contentDescription = null,
            modifier = Modifier.fillMaxSize().blur(70.dp),
            contentScale = ContentScale.Crop,
            alpha = 0.85f,
        )
    } else {
        // 低版本 Modifier.blur 无效：拿 32px 小图放大，双线性插值近似模糊
        Image(
            bitmap = cover.blurSource ?: cover.cover,
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
            filterQuality = FilterQuality.Low,
            alpha = 0.9f,
        )
    }
    // 与 RN 同一把尺：蒙版按取色结果解出来的 scrimAlpha，铺底色后合成场才对白字过闸
    palette?.let {
        Box(Modifier.fillMaxSize().background(Color(it.baseArgb).copy(alpha = it.scrimAlpha.toFloat())))
    }
}

/** 页面底部的压暗层：保证标题/控件在任何封面上都读得出来（沿用改造前的三档梯度）。 */
@Composable
private fun ReadabilityGradient() {
    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.30f),
                    0.55f to Color.Black.copy(alpha = 0.42f),
                    1f to Color(0xF0121016),
                ),
            ),
    )
}

/** 从 32px 缩略图提取确定性的封面调色板；任何失败返回 null（调用方回落模糊层）。 */
private fun CoverArt.coverPalette(): CoverPalette? =
    runCatching {
        val bitmap = (blurSource ?: cover).asAndroidBitmap()
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 0 || height <= 0) return@runCatching null
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
        CoverPaletteExtractor.extract(pixels, width, height)
    }.getOrNull()
