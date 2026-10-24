package cn.toside.music.core.music.leaderboard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger
import java.security.KeyFactory
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * WyWeapi 测试 —— 金标对照 node crypto 独立实现的 RN `weapi`
 * （`crypto.publicEncrypt` RSA_NO_PADDING + `aes-128-cbc` 双轮，见 lane 报告）。
 *
 * 纯 JVM 下 PKCS7 拼写不可用（实测 NoSuchAlgorithmException），
 * 生产代码统一走 PKCS5Padding（AES 16 字节块下即 PKCS#7）。
 */
class WyWeapiTest {
    private val fixedKey = "1234567890123456"

    @Test
    fun `encrypt matches node crypto golden params with fixed secret key`() {
        val text = """{"id":"3778678","n":100000,"p":1}"""
        val form = WyWeapi.encrypt(text, fixedKey)
        // node: aes(aes(base64(utf8(text)), presetKey), secretKey) —— 第二轮吃的是
        // 第一轮 Base64「文本」的 utf8 字节（对应 RN 的 btoa 包裹）
        assertEquals(
            "FSfSanZArfIQG3/7BlNqYqtzHjFqhYfmh3ZISNTav4ejFnQCGrGb0dRGNJ83u58G" +
                "zy6ZcWGsZ0c+NGe6ufZcJqk3GhaolwmNyqxpaJ/PkrQ=",
            form.params,
        )
    }

    @Test
    fun `params decrypts back to original text through secret then preset key`() {
        val text = """{"c":"[{\"id\":3000002}]","ids":"[3000002]"}"""
        val form = WyWeapi.encrypt(text, fixedKey)
        assertEquals(text, wyapiDecrypt(form.params, fixedKey))
    }

    @Test
    fun `encSecKey matches node publicEncrypt with RSA no padding`() {
        val secret = "0123456789abcdef"
        val form = WyWeapi.encrypt("""{"id":"1"}""", secret)
        assertTrue(Regex("[0-9a-f]{256}").matches(form.encSecKey))
        // node crypto 独立实现的金标（reversed secret 左补零到 128 字节后 NoPadding 加密）
        assertEquals(
            "35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b9" +
                "49debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de9" +
                "48206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520e" +
                "a826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52",
            form.encSecKey,
        )
        // 再用 JCE 自己加密一遍作为第二重对照（与生产实现同一 JDK 路径）
        assertEquals(jceEncSecKey(secret), form.encSecKey)
    }

    @Test
    fun `encSecKey is textbook rsa of reversed secret padded to 128 bytes`() {
        val secret = "0123456789abcdef"
        val form = WyWeapi.encrypt("""{"id":"1"}""", secret)
        val publicKey = loadPublicKey()
        val ciphertext = BigInteger(form.encSecKey, 16)
        // NoPadding = m^e mod n，反向验算 m ≡ c^d 不可用公钥，改为校验值域与幂等重构：
        // 用公钥指数把补齐后的明文再加密一次，必须得到同一段密文
        val m = BigInteger(1, paddedMessage(secret))
        assertEquals(ciphertext, m.modPow(publicKey.publicExponent, publicKey.modulus))
    }

    @Test
    fun `default secret key is random 16 digits`() {
        val a = WyWeapi.encrypt("""{"x":1}""")
        val b = WyWeapi.encrypt("""{"x":1}""")
        assertEquals(256, a.encSecKey.length)
        assertNotEquals(a.params, b.params)
    }

    private fun paddedMessage(secret: String): ByteArray {
        val reversed = secret.toByteArray(Charsets.UTF_8).reversedArray()
        return ByteArray(128 - reversed.size) + reversed
    }

    private fun loadPublicKey(): RSAPublicKey {
        val der =
            Base64
                .getMimeDecoder()
                .decode(
                    "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7cl" +
                        "FSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZ" +
                        "MldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB",
                )
        return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der)) as RSAPublicKey
    }

    private fun jceEncSecKey(secret: String): String {
        val cipher = Cipher.getInstance("RSA/ECB/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, loadPublicKey())
        return cipher.doFinal(paddedMessage(secret)).joinToString("") { "%02x".format(it) }
    }

    /** RN weapi params 的逆向：第二轮用 secretKey 解出 Base64 文本，再 Base64 解码后用 presetKey 解密。 */
    private fun wyapiDecrypt(
        params: String,
        secretKey: String,
    ): String {
        val preset = "0CoJUm6Qyw8W8jud".toByteArray(Charsets.UTF_8)
        val secret = secretKey.toByteArray(Charsets.UTF_8)
        val ivBytes = "0102030405060708".toByteArray(Charsets.UTF_8)
        val firstText = String(aesDecryptBytes(Base64.getDecoder().decode(params), secret, ivBytes), Charsets.UTF_8)
        return String(
            aesDecryptBytes(Base64.getDecoder().decode(firstText), preset, ivBytes),
            Charsets.UTF_8,
        )
    }

    private fun aesDecryptBytes(
        data: ByteArray,
        key: ByteArray,
        iv: ByteArray,
    ): ByteArray {
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        return cipher.doFinal(data)
    }
}
