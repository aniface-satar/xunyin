package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.crypto.Crypto
import java.util.Base64

/**
 * 网易云 weapi 加密 —— 对照 RN `musicSdk/wy/utils/crypto.js#weapi`
 * （上游 Binaryify/NeteaseCloudMusicApi）。
 *
 * 流程：text = JSON(obj)；secretKey = 16 位随机数字串；
 * params = AES-CBC-PKCS7(presetKey, iv) 加密 text 的 Base64
 *          → 再用 secretKey（Base64 形式）加密一次的 Base64；
 * encSecKey = RSA-NoPadding(secretKey 的字节**反转**并左补零到 128 字节) 的 hex。
 *
 * RN 的 AES_MODE 枚举值都是 Cipher transformation 字符串（CBC_128_PKCS7Padding =
 * 'AES/CBC/PKCS7Padding'），这里直接用同名字符串。
 */
object WyWeapi {
    private const val IV = "0102030405060708"
    private const val PRESET_KEY = "0CoJUm6Qyw8W8jud"
    private const val PUBLIC_KEY =
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB"
    private const val CBC = "AES/CBC/PKCS7Padding"

    data class WeapiForm(
        val params: String,
        val encSecKey: String,
    )

    fun encrypt(objectJson: String): WeapiForm {
        // RN: String(Math.random()).substring(2, 18) —— 16 位随机数字串
        val secretKey =
            buildString {
                repeat(16) { append((0..9).random()) }
            }
        val ivBase64 = Base64.getEncoder().encodeToString(IV.toByteArray(Charsets.UTF_8))
        val presetBase64 = Base64.getEncoder().encodeToString(PRESET_KEY.toByteArray(Charsets.UTF_8))
        val secretBase64 = Base64.getEncoder().encodeToString(secretKey.toByteArray(Charsets.UTF_8))

        val first =
            Crypto.aesEncrypt(
                Base64.getEncoder().encodeToString(objectJson.toByteArray(Charsets.UTF_8)),
                presetBase64,
                ivBase64,
                CBC,
            )
        val params =
            Crypto.aesEncrypt(
                first,
                secretBase64,
                ivBase64,
                CBC,
            )

        // secretKey 字节反转后左补零到 128 字节，RSA NoPadding，输出 hex
        val reversed = secretKey.toByteArray(Charsets.UTF_8).reversedArray()
        val padded = ByteArray(128)
        System.arraycopy(reversed, 0, padded, 128 - reversed.size, reversed.size)
        val rsaBase64 = Crypto.rsaEncrypt(Base64.getEncoder().encodeToString(padded), PUBLIC_KEY, "RSA/ECB/NoPadding")
        val encSecKey = Base64.getDecoder().decode(rsaBase64).joinToString("") { "%02x".format(it) }
        return WeapiForm(params, encSecKey)
    }
}
