package cn.toside.music.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * Crypto 测试：RSA/AES 往返 + SHA1 黄金值。
 */
class CryptoTest {
    @Test
    fun rsaRoundTrip() {
        val keyPair = Crypto.generateRsaKeyPair()
        val publicKey = Crypto.rsaPublicKeyBase64(keyPair)
        val privateKey = Crypto.rsaPrivateKeyBase64(keyPair)
        // 公私钥是不同的 Base64 串
        assertNotEquals(publicKey, privateKey)

        val plain = Base64.getEncoder().encodeToString("寻音 crypto test 123".toByteArray())
        val encrypted = Crypto.rsaEncrypt(plain, publicKey)
        assertTrue(encrypted.isNotEmpty())
        // RN decryptRSAToString 语义：解出的是明文字符串（非 Base64 回编码）
        val decrypted = Crypto.rsaDecrypt(encrypted, privateKey)
        assertEquals("寻音 crypto test 123", decrypted)
    }

    @Test
    fun rsaDecryptWithWrongKeyReturnsEmpty() {
        val keyPair = Crypto.generateRsaKeyPair()
        val otherKeyPair = Crypto.generateRsaKeyPair()
        val plain = Base64.getEncoder().encodeToString("hello".toByteArray())
        val encrypted = Crypto.rsaEncrypt(plain, Crypto.rsaPublicKeyBase64(keyPair))
        val decrypted = Crypto.rsaDecrypt(encrypted, Crypto.rsaPrivateKeyBase64(otherKeyPair))
        assertEquals("", decrypted)
    }

    @Test
    fun aesCbcRoundTrip() {
        val key = ByteArray(32) { it.toByte() } // AES-256
        val iv = ByteArray(16) { (it * 3).toByte() }
        val data = "对称加密测试数据 symmetric test".toByteArray()
        val encrypted = Crypto.aesEncrypt(data, key, iv, "AES/CBC/PKCS5Padding")
        assertTrue(encrypted.isNotEmpty())
        val decrypted = Crypto.aesDecrypt(Base64.getDecoder().decode(encrypted), key, iv, "AES/CBC/PKCS5Padding")
        assertEquals("对称加密测试数据 symmetric test", decrypted)
    }

    @Test
    fun aesBase64StringInterface() {
        val keyBase64 = Base64.getEncoder().encodeToString(ByteArray(16) { (it + 1).toByte() }) // AES-128
        val ivBase64 = Base64.getEncoder().encodeToString(ByteArray(16) { (it * 2).toByte() })
        val plain = "base64 接口测试"
        val dataBase64 = Base64.getEncoder().encodeToString(plain.toByteArray())
        val encrypted = Crypto.aesEncrypt(dataBase64, keyBase64, ivBase64, "AES/CBC/PKCS5Padding")
        assertTrue(encrypted.isNotEmpty())
        // RN decrypt 语义：返回明文字符串
        val decrypted = Crypto.aesDecrypt(encrypted, keyBase64, ivBase64, "AES/CBC/PKCS5Padding")
        assertEquals(plain, decrypted)
    }

    @Test
    fun aesEmptyIvUsesEcbPath() {
        // iv 为空串 → 不带 IV 初始化（ECB 模式路径）
        val keyBase64 = Base64.getEncoder().encodeToString(ByteArray(16) { 7 })
        val dataBase64 = Base64.getEncoder().encodeToString("ecb data".toByteArray())
        val encrypted = Crypto.aesEncrypt(dataBase64, keyBase64, "", "AES/ECB/PKCS5Padding")
        assertTrue(encrypted.isNotEmpty())
        val decrypted = Crypto.aesDecrypt(encrypted, keyBase64, "", "AES/ECB/PKCS5Padding")
        assertEquals("ecb data", decrypted)
    }

    @Test
    fun shortIvIsPaddedTo16Bytes() {
        // RN AES.java 行为：不足 16 字节的 IV 补零到 16
        val key = ByteArray(16) { 1 }
        val shortIv = ByteArray(8) { 9 }
        val data = "short iv test".toByteArray()
        val encrypted = Crypto.aesEncrypt(data, key, shortIv, "AES/CBC/PKCS5Padding")
        assertTrue(encrypted.isNotEmpty())
        val decrypted = Crypto.aesDecrypt(Base64.getDecoder().decode(encrypted), key, shortIv, "AES/CBC/PKCS5Padding")
        assertEquals("short iv test", decrypted)
    }

    @Test
    fun sha1GoldenValue() {
        // SHA1("abc") 的标准黄金值
        assertEquals("a9993e364706816aba3e25717850c26c9cd0d89d", Crypto.sha1("abc"))
        assertEquals("da39a3ee5e6b4b0d3255bfef95601890afd80709", Crypto.sha1(""))
        assertFalse(Crypto.sha1("abc") == Crypto.sha1("abd"))
    }
}
