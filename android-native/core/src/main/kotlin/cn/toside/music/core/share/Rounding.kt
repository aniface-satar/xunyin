package cn.toside.music.core.share

/** JS `Math.round(value * 10) / 10` 的等价实现（正数与 JS 的半入方向一致）。 */
internal fun round1(value: Double): Double = Math.round(value * 10) / 10.0
