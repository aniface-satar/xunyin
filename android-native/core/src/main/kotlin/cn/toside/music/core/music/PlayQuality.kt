package cn.toside.music.core.music

/**
 * 播放音质决策 —— RN `src/core/music/utils.ts` 的 `getPlayQuality` 逐条移植。
 *
 * 设置里选的是「尽量高」的档位时，按 flac24bit → flac → 320k 依次降级：
 * 只有歌曲自身带这个音质（`meta._qualitys`）且当前音源声明支持（`qualityList`）才采用，
 * 都没有就落到 128k。
 */
object PlayQuality {
    val TRY_QUALITYS: List<String> = listOf("flac24bit", "flac", "320k")

    fun pick(
        highQuality: String,
        musicQualitys: Set<String>,
        sourceQualitys: Collection<String>,
    ): String {
        val start = TRY_QUALITYS.indexOf(highQuality)
        if (start < 0) return "128k"
        return TRY_QUALITYS.drop(start).firstOrNull { it in musicQualitys && it in sourceQualitys } ?: "128k"
    }
}
