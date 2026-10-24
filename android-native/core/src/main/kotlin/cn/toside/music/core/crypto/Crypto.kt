package cn.toside.music.core.crypto

import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 加解密工具 —— RN 侧 android crypto（RSA.java + AES.java）的等价移植。
 *
 * 用途：B3 音源脚本（userApi）的加解密链路与同步功能密钥协商。
 * 接口形状与 RN CryptoModule 对齐（Base64 字符串进出、失败返回空串）。
 */
object Crypto {
    // ---------- RSA（对照 RSA.java） ----------

    fun generateRsaKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance("RSA")
        kpg.initialize(2048)
        return kpg.generateKeyPair()
    }

    fun rsaPublicKeyBase64(keyPair: KeyPair): String = Base64.getEncoder().encodeToString(keyPair.public.encoded)

    fun rsaPrivateKeyBase64(keyPair: KeyPair): String = Base64.getEncoder().encodeToString(keyPair.private.encoded)

    fun rsaEncrypt(
        dataBase64: String,
        publicKeyBase64: String,
        padding: String = "RSA/ECB/PKCS1Padding",
    ): String =
        runCatching {
            val keyFac = KeyFactory.getInstance("RSA")
            // 脚本传进来的公钥带 PEM 换行（preload 只去掉 BEGIN/END 行），
            // 与 Android Base64.DEFAULT 一样要能跳过空白
            val key = keyFac.generatePublic(X509EncodedKeySpec(Base64.getMimeDecoder().decode(publicKeyBase64)))
            val cipher = Cipher.getInstance(padding)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            Base64.getEncoder().encodeToString(cipher.doFinal(Base64.getDecoder().decode(dataBase64)))
        }.getOrElse { "" }

    fun rsaDecrypt(
        dataBase64: String,
        privateKeyBase64: String,
        padding: String = "RSA/ECB/PKCS1Padding",
    ): String =
        runCatching {
            val keyFac = KeyFactory.getInstance("RSA")
            val key = keyFac.generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(privateKeyBase64.trim())))
            val cipher = Cipher.getInstance(padding)
            cipher.init(Cipher.DECRYPT_MODE, key)
            String(cipher.doFinal(Base64.getDecoder().decode(dataBase64)))
        }.getOrElse { "" }

    // ---------- AES（对照 AES.java） ----------

    fun aesEncrypt(
        data: ByteArray,
        key: ByteArray,
        iv: ByteArray?,
        mode: String,
    ): String =
        runCatching {
            val cipher = Cipher.getInstance(mode)
            val keySpec = SecretKeySpec(key, "AES")
            if (iv != null) {
                val finalIv = ByteArray(16)
                System.arraycopy(iv, 0, finalIv, 0, minOf(iv.size, 16))
                cipher.init(Cipher.ENCRYPT_MODE, keySpec, IvParameterSpec(finalIv))
            } else {
                cipher.init(Cipher.ENCRYPT_MODE, keySpec)
            }
            Base64.getEncoder().encodeToString(cipher.doFinal(data))
        }.getOrElse { "" }

    fun aesDecrypt(
        data: ByteArray,
        key: ByteArray,
        iv: ByteArray?,
        mode: String,
    ): String =
        runCatching {
            val cipher = Cipher.getInstance(mode)
            val keySpec = SecretKeySpec(key, "AES")
            if (iv != null) {
                val finalIv = ByteArray(16)
                System.arraycopy(iv, 0, finalIv, 0, minOf(iv.size, 16))
                cipher.init(Cipher.DECRYPT_MODE, keySpec, IvParameterSpec(finalIv))
            } else {
                cipher.init(Cipher.DECRYPT_MODE, keySpec)
            }
            String(cipher.doFinal(data), Charsets.UTF_8)
        }.getOrElse { "" }

    /** Base64 串接口（对照 CryptoModule.aesEncrypt(text, key, iv, mode)）。 */
    fun aesEncrypt(
        dataBase64: String,
        keyBase64: String,
        ivBase64: String,
        mode: String,
    ): String {
        val data = Base64.getDecoder().decode(dataBase64)
        val key = Base64.getDecoder().decode(keyBase64)
        return if (ivBase64.isEmpty()) {
            aesEncrypt(data, key, null, mode)
        } else {
            aesEncrypt(data, key, Base64.getDecoder().decode(ivBase64), mode)
        }
    }

    fun aesDecrypt(
        dataBase64: String,
        keyBase64: String,
        ivBase64: String,
        mode: String,
    ): String {
        val data = Base64.getDecoder().decode(dataBase64)
        val key = Base64.getDecoder().decode(keyBase64)
        return if (ivBase64.isEmpty()) {
            aesDecrypt(data, key, null, mode)
        } else {
            aesDecrypt(data, key, Base64.getDecoder().decode(ivBase64), mode)
        }
    }

    // ---------- SHA1（对照 CryptoModule.sha1） ----------

    fun sha1(input: String): String {
        val md = java.security.MessageDigest.getInstance("SHA-1")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
