package cn.toside.music.core.data

import cn.toside.music.core.storage.InMemoryKvStore
import cn.toside.music.core.storage.ShardedKvStore
import cn.toside.music.core.storage.StorageKeys
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 取链缓存（W6-1）—— RN `utils/data.ts` 键口径 + 原生 TTL 增强。
 *
 * 键形如 `@music_url__<musicId>_<quality>_c`（RN 的纯 url 键是 `@music_url__<id>_<type>`，
 * 加 `_c` 后缀分开存，两边互不覆盖）。
 */
class MusicUrlCacheTest {
    private val now = 1_700_000_000_000L

    private fun repo(): DataRepository = DataRepository(ShardedKvStore(InMemoryKvStore()))

    // ---------- 键与新鲜度（纯规则） ----------

    @Test
    fun cacheKeyCarriesMusicIdAndQuality() {
        assertEquals(
            StorageKeys.MUSIC_URL_PREFIX + "kw_123_flac_c",
            MusicUrlCache.key("kw_123", "flac"),
        )
    }

    @Test
    fun freshWithinTtlAndStaleBeyond() {
        assertTrue(MusicUrlCache.isFresh(now - 1_000, now))
        assertTrue(MusicUrlCache.isFresh(now - MusicUrlCache.DEFAULT_TTL_MS + 1, now))
        org.junit.Assert.assertFalse(MusicUrlCache.isFresh(now - MusicUrlCache.DEFAULT_TTL_MS, now))
        org.junit.Assert.assertFalse(MusicUrlCache.isFresh(0, now))
        // 时钟回拨（未来时间）按坏记录处理
        org.junit.Assert.assertFalse(MusicUrlCache.isFresh(now + 1_000, now))
    }

    @Test
    fun pickReturnsUrlOnlyWhenFresh() {
        val entry = MusicUrlEntry(url = "https://cdn/a.flac", savedAt = now - 1_000)
        assertEquals("https://cdn/a.flac", MusicUrlCache.pick(entry, now))
        assertNull(MusicUrlCache.pick(entry, now + MusicUrlCache.DEFAULT_TTL_MS))
        assertNull(MusicUrlCache.pick(MusicUrlEntry(url = "", savedAt = now), now))
        assertNull(MusicUrlCache.pick(null, now))
    }

    @Test
    fun ttlCanBeShortenedByCaller() {
        val entry = MusicUrlEntry(url = "u", savedAt = now - 10_000)
        assertNull(MusicUrlCache.pick(entry, now, ttlMs = 5_000))
        assertEquals("u", MusicUrlCache.pick(entry, now, ttlMs = 60_000))
    }

    // ---------- 落盘往返 ----------

    @Test
    fun savesAndReadsEntry() =
        runBlocking {
            val repo = repo()
            assertNull(repo.getMusicUrlEntry("kw_1", "flac"))
            repo.saveMusicUrlEntry("kw_1", "flac", "https://cdn/a.flac", now)
            assertEquals(MusicUrlEntry("https://cdn/a.flac", now), repo.getMusicUrlEntry("kw_1", "flac"))
            // 音质入键：换音质不算同一条（RN online.ts:56 同口径）
            assertNull(repo.getMusicUrlEntry("kw_1", "320k"))
            // 曲目 id 入键
            assertNull(repo.getMusicUrlEntry("kw_2", "flac"))
        }

    @Test
    fun clearRemovesOnlyThatEntry() =
        runBlocking {
            val repo = repo()
            repo.saveMusicUrlEntry("kw_1", "flac", "a", now)
            repo.saveMusicUrlEntry("kw_1", "320k", "b", now)
            repo.clearMusicUrlEntry("kw_1", "flac")
            assertNull(repo.getMusicUrlEntry("kw_1", "flac"))
            assertEquals("b", repo.getMusicUrlEntry("kw_1", "320k")?.url)
        }

    @Test
    fun doesNotTouchRnStylePlainUrlKey() =
        runBlocking {
            val repo = repo()
            repo.saveMusicUrl("kw_1", "flac", "https://rn/url")
            repo.saveMusicUrlEntry("kw_1", "flac", "https://native/url", now)
            assertEquals("https://rn/url", repo.getMusicUrl("kw_1", "flac"))
            assertEquals("https://native/url", repo.getMusicUrlEntry("kw_1", "flac")?.url)
        }

    @Test
    fun corruptEntryIsTreatedAsMiss() =
        runBlocking {
            val kv = ShardedKvStore(InMemoryKvStore())
            kv.saveString(MusicUrlCache.key("kw_1", "flac"), "not-json")
            assertNull(DataRepository(kv).getMusicUrlEntry("kw_1", "flac"))
        }
}
