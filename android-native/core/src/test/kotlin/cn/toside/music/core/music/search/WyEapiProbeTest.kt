package cn.toside.music.core.music.search

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.IllegalBlockSizeException
import javax.crypto.spec.SecretKeySpec

/** Reproduces the RN Java AES/ECB/NoPadding failure on a real search-shaped plaintext. */
class WyEapiProbeTest {
    @Test
    fun `RN no padding rejects the non block aligned eapi plaintext`() {
        val path = "/api/search/song/list/page"
        val body = """{"keyword":"周杰伦","needCorrect":"1","channel":"typing","offset":0,"scene":"normal","total":true,"limit":3}"""
        val digest = "2b52f10236ee71537f282fea85fc98a8"
        val plain = "$path-36cd479b6b5-$body-36cd479b6b5-$digest".toByteArray(Charsets.UTF_8)

        assertEquals(195, plain.size)
        assertEquals(3, plain.size % 16)
        val cipher = Cipher.getInstance("AES/ECB/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec("e82ckenh8dichen8".toByteArray(), "AES"))
        assertThrows(IllegalBlockSizeException::class.java) { cipher.doFinal(plain) }
    }
}
