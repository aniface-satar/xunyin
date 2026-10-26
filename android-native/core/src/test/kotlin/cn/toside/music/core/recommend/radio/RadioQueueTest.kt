package cn.toside.music.core.recommend.radio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 本地候选队列（RN `queue.ts`）单元测试：版本号、去重、出队。 */
class RadioQueueTest {
    private fun item(name: String): RecommendQueueItem =
        RecommendQueueItem(
            musicInfo = RadioFixtures.musicInfo(id = name, name = name, singer = "歌手$name"),
            channel = ChannelId.A,
        )

    @Test
    fun enqueueAcceptsOnlyCurrentVersion() {
        val queue = RadioQueue()
        val token = queue.version
        assertTrue(queue.enqueue(listOf(item("a")), token))
        assertFalse("旧版本结果必须整批丢弃", queue.enqueue(listOf(item("b")), token - 1))
        assertEquals(1, queue.size())
    }

    @Test
    fun enqueueDedupesSameTrackKey() {
        val queue = RadioQueue()
        val token = queue.version
        assertTrue(queue.enqueue(listOf(item("a"), item("a")), token))
        assertEquals(1, queue.size())
        assertFalse(queue.enqueue(listOf(item("a")), token))
        assertEquals(1, queue.size())
    }

    @Test
    fun shiftPopsFromHeadAndForgetsKeys() {
        val queue = RadioQueue()
        val token = queue.version
        queue.enqueue(listOf(item("a"), item("b")), token)
        val taken = queue.shift(1, token)
        assertEquals(1, taken.size)
        assertEquals(1, queue.size())
        assertFalse(queue.has(RadioTrackKeys.buildTrackKey(taken.first().musicInfo)))
    }

    @Test
    fun shiftRejectsStaleToken() {
        val queue = RadioQueue()
        val token = queue.version
        queue.enqueue(listOf(item("a")), token)
        assertTrue(queue.shift(1, token + 1).isEmpty())
        assertEquals(1, queue.size())
    }

    @Test
    fun invalidateBumpsVersionAndClears() {
        val queue = RadioQueue()
        val token = queue.version
        queue.enqueue(listOf(item("a")), token)
        val next = queue.invalidate()
        assertTrue(next > token)
        assertEquals(0, queue.size())
        assertFalse(queue.enqueue(listOf(item("b")), token))
    }

    @Test
    fun removeManyHonoursVersion() {
        val queue = RadioQueue()
        val token = queue.version
        queue.enqueue(listOf(item("a"), item("b"), item("c")), token)
        val removedKeys =
            setOf(
                RadioTrackKeys.buildTrackKey(item("a").musicInfo),
                RadioTrackKeys.buildTrackKey(item("c").musicInfo),
            )
        assertEquals(0, queue.removeMany(removedKeys, token + 1))
        assertEquals(2, queue.removeMany(removedKeys, token))
        assertEquals(1, queue.size())
    }

    @Test
    fun removeTrackKeyReportsRemovedCount() {
        val queue = RadioQueue()
        val token = queue.version
        queue.enqueue(listOf(item("a"), item("b")), token)
        val key = RadioTrackKeys.buildTrackKey(item("a").musicInfo)
        assertEquals(1, queue.removeTrackKey(key))
        assertEquals(0, queue.removeTrackKey(key))
        assertEquals(1, queue.size())
    }

    @Test
    fun peekReturnsHeadWithoutConsuming() {
        val queue = RadioQueue()
        queue.enqueue(listOf(item("a"), item("b")), queue.version)
        assertEquals(2, queue.peek(5).size)
        assertEquals(1, queue.peek(1).size)
        assertEquals(2, queue.size())
    }
}
