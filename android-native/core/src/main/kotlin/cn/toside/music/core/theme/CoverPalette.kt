package cn.toside.music.core.theme

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * 播控页动态背景的封面取色器 —— 对照 RN `src/utils/monet/` 的配色语义移植。
 *
 * 与 RN 版（Material Color Utilities 的 QuantizerCelebi + HCT）的对应关系：
 * - 同样先量三个值：源色（画面里最跳的一块）、全图平均色、最亮局部块；
 * - 洗色浓度看全图平均彩度，源色只提供色相（`WASH_RATIO`）；
 * - 底色为白字服务，必须过 `MIN_CONTRAST`（4.5）；过不了就压暗明度重试，仍过不了返回 null
 *   （界面回落到主题纯色，与 RN "够不到就 null"一致）；
 * - 蒙版把最亮块压到闸门线：`scrim = clamp(1 - 4/drift, .55, 1)`，再按 0.01 步进补到过线；
 * - 合成按 sRGB 通道做（RN 注释实证：线性光混会把场算亮 4~6 个 L*）。
 *
 * 差异（有意）：用 HSL + WCAG 相对亮度代替 HCT；不引入 @material 依赖，
 * 保证纯 JVM 可测。量化用**可注入种子**的 k-means（RN 的莫奈抖动教训：
 * 上游 JS 量化用裸 `Math.random()`，同一张封面 50 次出 5 种源色）。
 */
data class CoverPalette(
    /** 量化挑出的源色（色相来源）。 */
    val sourceArgb: Int,
    /** 全图平均色（彩度来源）。 */
    val averageArgb: Int,
    /** 最亮局部块的平均色（蒙版闸门的参照物）。 */
    val highlightArgb: Int,
    /** 铺在最底下的纯色。 */
    val baseArgb: Int,
    /** 底色蒙版不透明度（0..1，两位小数）。 */
    val scrimAlpha: Double,
    /** 蒙版与最亮块合成后用户看到的场色。 */
    val fieldArgb: Int,
)

object CoverPaletteExtractor {
    /** 固定种子：同一份像素在任何一次运行、任何一次取色里都得出同一支色。 */
    const val DEFAULT_SEED: Long = 20261014L

    const val BLOCK_GRID = 8
    const val MIN_CONTRAST = 4.5
    private const val QUANTIZE_COLORS = 8
    private const val SAMPLE_LIMIT = 4096
    private const val DARK_ANCHOR_LIGHTNESS = 0.32
    private const val CHROMA_LIMIT = 0.62
    private const val WASH_RATIO = 0.65
    private const val WASH_FLOOR = 0.10
    private const val SCRIM_MIN = 0.55
    private const val TONE_DRIFT_LIMIT = 4.0
    private const val MAX_TONE_STEPS = 8
    private const val WHITE = 0xFFFFFFFF.toInt()
    private const val GRAY_CHROMA = 0.03

    /**
     * @param pixels 行主序 ARGB（alpha 非 255 的像素会被跳过）
     * @param seed 量化初始簇的种子；同种子同结果
     * @return 取色失败返回 null（非法输入 / 全透明 / 白字过不了闸门）
     */
    fun extract(
        pixels: IntArray?,
        width: Int,
        height: Int,
        seed: Long = DEFAULT_SEED,
    ): CoverPalette? {
        if (pixels == null || pixels.isEmpty() || width < 1 || height < 1) return null
        if (pixels.size != width * height) return null

        var sumR = 0L
        var sumG = 0L
        var sumB = 0L
        var opaqueCount = 0
        for (pixel in pixels) {
            if ((pixel ushr 24) and 0xFF != 255) continue
            sumR += CssColor.red(pixel)
            sumG += CssColor.green(pixel)
            sumB += CssColor.blue(pixel)
            opaqueCount++
        }
        if (opaqueCount == 0) return null
        val average = argb((sumR / opaqueCount).toInt(), (sumG / opaqueCount).toInt(), (sumB / opaqueCount).toInt())
        val highlight = blockHighlight(pixels, width, height) ?: average

        val sample = sampleOpaque(pixels)
        val source = quantizeSource(sample, seed) ?: average
        val avgHsl = rgbToHsl(average)
        val srcHsl = rgbToHsl(source)
        val neutral = srcHsl.s < GRAY_CHROMA && avgHsl.s < GRAY_CHROMA
        val chroma =
            if (neutral) {
                0.0
            } else {
                min(CHROMA_LIMIT, max(WASH_FLOOR, WASH_RATIO * avgHsl.s))
            }

        var lightness = DARK_ANCHOR_LIGHTNESS
        var base = hslToArgb(srcHsl.h, chroma, lightness)
        var steps = 0
        while (CssColor.contrastRatio(base, WHITE) < MIN_CONTRAST && steps < MAX_TONE_STEPS) {
            lightness = max(0.0, lightness - 0.04)
            base = hslToArgb(srcHsl.h, chroma, lightness)
            steps++
        }
        if (CssColor.contrastRatio(base, WHITE) < MIN_CONTRAST) return null

        val drift = abs(CssColor.lightnessStar(highlight) - CssColor.lightnessStar(base))
        val initial = if (drift <= TONE_DRIFT_LIMIT) SCRIM_MIN else 1 - TONE_DRIFT_LIMIT / drift
        var scrimCenti = (min(1.0, max(SCRIM_MIN, initial)) * 100).roundToInt()
        var field = composite(base, highlight, scrimCenti / 100.0)
        while (scrimCenti < 100 && CssColor.contrastRatio(field, WHITE) < MIN_CONTRAST) {
            scrimCenti++
            field = composite(base, highlight, scrimCenti / 100.0)
        }
        if (CssColor.contrastRatio(field, WHITE) < MIN_CONTRAST) return null

        return CoverPalette(
            sourceArgb = source,
            averageArgb = average,
            highlightArgb = highlight,
            baseArgb = base,
            scrimAlpha = scrimCenti / 100.0,
            fieldArgb = field,
        )
    }

    private fun argb(
        r: Int,
        g: Int,
        b: Int,
    ): Int = (0xFF shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)

    private fun composite(
        base: Int,
        highlight: Int,
        alpha: Double,
    ): Int =
        argb(
            (alpha * CssColor.red(base) + (1 - alpha) * CssColor.red(highlight)).roundToInt(),
            (alpha * CssColor.green(base) + (1 - alpha) * CssColor.green(highlight)).roundToInt(),
            (alpha * CssColor.blue(base) + (1 - alpha) * CssColor.blue(highlight)).roundToInt(),
        )

    /** 8×8 分块里取相对亮度最高的一块；块内全透明时回落到 null。 */
    private fun blockHighlight(
        pixels: IntArray,
        width: Int,
        height: Int,
    ): Int? {
        val cellW = width.toDouble() / BLOCK_GRID
        val cellH = height.toDouble() / BLOCK_GRID
        var best: Int? = null
        var bestLuminance = -1.0
        for (by in 0 until BLOCK_GRID) {
            for (bx in 0 until BLOCK_GRID) {
                val x0 = (bx * cellW).roundToInt()
                val x1 = max(x0 + 1, ((bx + 1) * cellW).roundToInt()).coerceAtMost(width)
                val y0 = (by * cellH).roundToInt()
                val y1 = max(y0 + 1, ((by + 1) * cellH).roundToInt()).coerceAtMost(height)
                var sumR = 0L
                var sumG = 0L
                var sumB = 0L
                var count = 0
                for (y in y0 until y1) {
                    for (x in x0 until x1) {
                        val pixel = pixels[y * width + x]
                        if ((pixel ushr 24) and 0xFF != 255) continue
                        sumR += CssColor.red(pixel)
                        sumG += CssColor.green(pixel)
                        sumB += CssColor.blue(pixel)
                        count++
                    }
                }
                if (count == 0) continue
                val block = argb((sumR / count).toInt(), (sumG / count).toInt(), (sumB / count).toInt())
                val luminance = CssColor.luminance(block)
                if (luminance > bestLuminance) {
                    bestLuminance = luminance
                    best = block
                }
            }
        }
        return best
    }

    private fun sampleOpaque(pixels: IntArray): IntArray {
        val opaque = pixels.filter { (it ushr 24) and 0xFF == 255 }
        if (opaque.size <= SAMPLE_LIMIT) return opaque.toIntArray()
        val stride = opaque.size.toDouble() / SAMPLE_LIMIT
        return IntArray(SAMPLE_LIMIT) { index -> opaque[(index * stride).toInt()] }
    }

    /** 种子化 k-means；挑"数量 × 彩度"最高的一簇当源色。 */
    private fun quantizeSource(
        sample: IntArray,
        seed: Long,
    ): Int? {
        if (sample.isEmpty()) return null
        val k = min(QUANTIZE_COLORS, sample.size)
        val random = Random(seed)
        val centerIndexes = LinkedHashSet<Int>()
        while (centerIndexes.size < k) centerIndexes.add(random.nextInt(sample.size))
        val centerR = DoubleArray(k)
        val centerG = DoubleArray(k)
        val centerB = DoubleArray(k)
        centerIndexes.forEachIndexed { index, sampleIndex ->
            val pixel = sample[sampleIndex]
            centerR[index] = CssColor.red(pixel).toDouble()
            centerG[index] = CssColor.green(pixel).toDouble()
            centerB[index] = CssColor.blue(pixel).toDouble()
        }
        val sumsR = LongArray(k)
        val sumsG = LongArray(k)
        val sumsB = LongArray(k)
        val counts = IntArray(k)
        repeat(8) {
            sumsR.fill(0)
            sumsG.fill(0)
            sumsB.fill(0)
            counts.fill(0)
            for (pixel in sample) {
                val r = CssColor.red(pixel)
                val g = CssColor.green(pixel)
                val b = CssColor.blue(pixel)
                var best = 0
                var bestDistance = Double.MAX_VALUE
                for (index in 0 until k) {
                    val dr = r - centerR[index]
                    val dg = g - centerG[index]
                    val db = b - centerB[index]
                    val distance = dr * dr + dg * dg + db * db
                    if (distance < bestDistance) {
                        bestDistance = distance
                        best = index
                    }
                }
                counts[best]++
                sumsR[best] += r
                sumsG[best] += g
                sumsB[best] += b
            }
            for (index in 0 until k) {
                if (counts[index] == 0) continue
                centerR[index] = sumsR[index].toDouble() / counts[index]
                centerG[index] = sumsG[index].toDouble() / counts[index]
                centerB[index] = sumsB[index].toDouble() / counts[index]
            }
        }
        var bestColor: Int? = null
        var bestScore = -1.0
        for (index in 0 until k) {
            if (counts[index] == 0) continue
            val center = argb(centerR[index].roundToInt(), centerG[index].roundToInt(), centerB[index].roundToInt())
            // 彩度优先于数量：灰底 + 一小块红应当取红，而不是被大面积灰压过去
            val score = Math.sqrt(counts[index].toDouble()) * (1 + 3 * rgbToHsl(center).s)
            if (score > bestScore) {
                bestScore = score
                bestColor = center
            }
        }
        return bestColor
    }

    private data class Hsl(
        val h: Double,
        val s: Double,
        val l: Double,
    )

    private fun rgbToHsl(argb: Int): Hsl {
        val r = CssColor.red(argb) / 255.0
        val g = CssColor.green(argb) / 255.0
        val b = CssColor.blue(argb) / 255.0
        val maxC = max(r, max(g, b))
        val minC = min(r, min(g, b))
        val l = (maxC + minC) / 2
        if (maxC == minC) return Hsl(0.0, 0.0, l)
        val d = maxC - minC
        val s = if (l > 0.5) d / (2 - maxC - minC) else d / (maxC + minC)
        val h =
            when (maxC) {
                r -> ((g - b) / d + (if (g < b) 6 else 0)) / 6
                g -> ((b - r) / d + 2) / 6
                else -> ((r - g) / d + 4) / 6
            }
        return Hsl(h, s, l)
    }

    private fun hslToArgb(
        h: Double,
        s: Double,
        l: Double,
    ): Int {
        fun hue(
            p: Double,
            q: Double,
            t: Double,
        ): Double {
            var value = t
            if (value < 0) value += 1
            if (value > 1) value -= 1
            return when {
                value < 1.0 / 6 -> p + (q - p) * 6 * value
                value < 1.0 / 2 -> q
                value < 2.0 / 3 -> p + (q - p) * (2.0 / 3 - value) * 6
                else -> p
            }
        }
        if (s == 0.0) {
            val v = (l * 255).roundToInt()
            return argb(v, v, v)
        }
        val q = if (l < 0.5) l * (1 + s) else l + s - l * s
        val p = 2 * l - q
        return argb(
            (hue(p, q, h + 1.0 / 3) * 255).roundToInt(),
            (hue(p, q, h) * 255).roundToInt(),
            (hue(p, q, h - 1.0 / 3) * 255).roundToInt(),
        )
    }
}
