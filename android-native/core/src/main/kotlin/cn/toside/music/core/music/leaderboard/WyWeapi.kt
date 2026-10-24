package cn.toside.music.core.music.leaderboard

import cn.toside.music.core.crypto.Crypto
import java.util.Base64

/**
 * 网易云 weapi 加密 —— 对照 RN `musicSdk/wy/utils/crypto.js#weapi`
 * （上游 Binaryify/NeteaseCloudMusicApi）。
 *
 * 流程：text = JSON(obj)；secretKey = 16 位随机数字串；
 * params = AES-CBC-PKCS7(presetKey, iv) 加密 text 的 utf8 字节 → Base64 文本；
 *          再 AES-CBC-PKCS7(secretKey, iv) 加密「上面那段 Base64 文本」的 utf8 字节 → Base64
 *          （对应 RN 里的 btoa(aesEncrypt(...)) 二次包裹）；
 * encSecKey = RSA-NoPadding(secretKey 的字节**反转**并左补零到 128 字节) 的 hex。
 *
 * RN 的 AES_MODE 枚举值是 Android 侧 transformation 字符串
 * （CBC_128_PKCS7Padding = 'AES/CBC/PKCS7Padding'）。纯 JVM（单测环境）没有
 * PKCS7 拼写（实测 NoSuchAlgorithmException），JCE 的 PKCS5Padding 即 AES 16
 * 字节块下的 PKCS#7，二者等价，这里统一用 'AES/CBC/PKCS5Padding'
 * （与 WySearch eapi、KwLeaderboard wbd 的先例一致）。
 */
object WyWeapi {
    private const val IV = "0102030405060708"
    private const val PRESET_KEY = "0CoJUm6Qyw8W8jud"
    private const val PUBLIC_KEY =
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB"
    private const val CBC = "AES/CBC/PKCS5Padding"

    data class WeapiForm(
        val params: String,
        val encSecKey: String,
    )

    fun encrypt(
        objectJson: String,
        secretKeyOverride: String? = null,
    ): WeapiForm {
        // RN: String(Math.random()).substring(2, 18) —— 16 位随机数字串。
        // 注：Math.random() 约 10% 概率第 17 位小数为 0（截短串），RN 同样带短 key 请求、
        // params/encSecKey 自洽即可解密，这里恒 16 位数字不破坏协议。
        val secretKey =
            secretKeyOverride ?: buildString {
                repeat(16) { append((0..9).random()) }
            }
        val ivBytes = IV.toByteArray(Charsets.UTF_8)
        // 第一轮：text 的 utf8 字节 → AES(presetKey) → Base64 文本
        val first =
            Crypto.aesEncrypt(
                objectJson.toByteArray(Charsets.UTF_8),
                PRESET_KEY.toByteArray(Charsets.UTF_8),
                ivBytes,
                CBC,
            )
        // 第二轮：RN 用 btoa(...) 把上一轮的 Base64「文本」再喂给 AES，
        // 所以这里加密的是 first 字符串的 utf8 字节，不是解码后的密文字节。
        val params =
            Crypto.aesEncrypt(
                first.toByteArray(Charsets.UTF_8),
                secretKey.toByteArray(Charsets.UTF_8),
                ivBytes,
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
