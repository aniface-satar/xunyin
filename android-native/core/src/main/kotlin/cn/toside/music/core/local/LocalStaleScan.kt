package cn.toside.music.core.local

/**
 * 失效曲目的**批量**判定（W6-5）—— 纯字符串规则，SAF 列举由 app 侧完成。
 *
 * Wave6 的 `countStale` 是逐曲 `DocumentFile` query（每首一次 IPC），1000 首时明显卡；
 * 这里改成「每个授权树根只列一次 children，拿回来的 documentId 集合与曲目比对」。
 *
 * ## 键的选择
 *
 * 用 `documentId`（`primary:Music/歌名 - 歌手.mp3`）而不是 document URI 字符串：
 * URI 里的编码/authority 会随 provider 变化，documentId 在「同一树根单层」内稳定，
 * 且与 `SafDocuments.listChildren` 回来的条目同一个命名空间。
 *
 * ## 回退
 *
 * 解析不出 documentId 的曲目（URI 形态异常）进 [ScanResult.unresolved]，
 * 由 app 侧对它们回到逐曲 query —— 宁可多查几首，也不要把「查不动」误判成失效。
 */
object LocalStaleScan {
    /** 一条待判定的本地曲目。 */
    data class Track(
        val id: String,
        val documentId: String?,
    )

    /** [stale] 判定失效；[unresolved] 批量判不了（需退回逐曲 query）。 */
    data class ScanResult(
        val stale: List<String>,
        val unresolved: List<String>,
    )

    /**
     * @param listedIds 各授权树根单层列举出的 documentId 并集（一次列举供全部曲目比对）。
     */
    fun scan(
        tracks: List<Track>,
        listedIds: Set<String>,
    ): ScanResult {
        val stale = mutableListOf<String>()
        val unresolved = mutableListOf<String>()
        for (track in tracks) {
            val documentId = track.documentId
            when {
                documentId.isNullOrEmpty() -> unresolved.add(track.id)
                documentId !in listedIds -> stale.add(track.id)
            }
        }
        return ScanResult(stale = stale, unresolved = unresolved)
    }

    /**
     * 从 document URI 字符串里抠 documentId（导入生成的 URI 一定能解出）。
     *
     * `content://…/document/primary%3AMusic%2F歌名.mp3` → `primary:Music/歌名.mp3`
     * —— 与 `DocumentsContract.getDocumentId` 同结果，这里不依赖 Android API，
     * 便于 JVM 单测；app 侧优先用 `DocumentsContract`，解不出时退回这里。
     */
    fun documentIdOf(uriString: String): String? {
        if ('/' !in uriString) return null
        return percentDecode(uriString.substringAfterLast('/')).ifEmpty { null }
    }

    /**
     * 解 `%XX`（SAF document id 里最常见的编码），解不动的片段原样保留。
     *
     * 中文名的 document id 是 UTF-8 逐字节百分号编码的，所以按**字节**收集再整体
     * 按 UTF-8 解码（逐 `%XX` 当字符会解出乱码，乱码 id 会被误判成失效）。
     */
    private fun percentDecode(value: String): String {
        if ('%' !in value) return value
        val out = java.io.ByteArrayOutputStream(value.length)
        var index = 0
        while (index < value.length) {
            val ch = value[index]
            if (ch == '%' && index + 2 < value.length) {
                val code = value.substring(index + 1, index + 3).toIntOrNull(16)
                if (code != null) {
                    out.write(code)
                    index += 3
                    continue
                }
            }
            val text =
                if (ch.isHighSurrogate() && index + 1 < value.length && value[index + 1].isLowSurrogate()) {
                    value.substring(index, index + 2).also { index += 1 }
                } else {
                    ch.toString()
                }
            out.write(text.toByteArray(Charsets.UTF_8))
            index += 1
        }
        return String(out.toByteArray(), Charsets.UTF_8)
    }
}
