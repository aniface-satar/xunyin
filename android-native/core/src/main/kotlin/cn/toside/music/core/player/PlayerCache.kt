package cn.toside.music.core.player

/**
 * 播放器缓存能力 —— RN `plugins/player/utils.ts` 的 isCached/cacheTrack/cancelCacheTrack/
 * getCacheSize/clearCache 五个接口的抽象。
 *
 * 预热必须写进播放器正在用的那一份 SimpleCache（同目录二开会撞 `SimpleCache.isCacheFolderLocked`），
 * 所以这些能力由平台实现持有缓存实例，而不是单独起一个缓存模块。
 */
interface PlayerCache {
    /**
     * 把 [url] 的字节预热进播放器缓存；[maxBytes] <= 0 表示整首（原生按 C.LENGTH_UNSET）。
     * 返回 true 仅当读循环完整跑完且期间没被 [cancelCacheTrack] 取消。
     */
    suspend fun cacheTrack(
        url: String,
        headers: Map<String, String>,
        maxBytes: Long,
        token: String,
    ): Boolean

    /** 在途预热按 token 收摊（用户跳走时省流量）。未知 token 为 no-op。 */
    fun cancelCacheTrack(token: String)

    suspend fun isCached(url: String): Boolean

    /** 播放器缓存当前占用字节数；缓存未建（cacheSize<=0）时为 0。 */
    suspend fun getCacheSize(): Long

    suspend fun clearCache()
}
