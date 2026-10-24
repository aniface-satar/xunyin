package cn.toside.music.core.music.leaderboard

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * KwLeaderboard 测试：
 * - buildParam：appId/加密数据/时间戳/MD5 签名的组合形状与往返可解；
 * - parse：musiclist → MusicInfo 映射（音质档位排序、Set 去重、实体解码）；
 * - 重试语义：musiclist 缺失重试至 3 次后抛错。
 */
class KwLeaderboardTest {
    @Test
    fun `buildRequest produces url encoded params and decrypts back`() {
        val url = KwLeaderboard.buildRequest("16", page = 1, limit = 100, time = 1_728_000_000_000)

        assertTrue(url.startsWith("https://wbd.kuwo.cn/api/bd/bang/bang_info?"))
        val query = url.substringAfter('?')
        val params =
            query.split('&').associate {
                val (k, v) = it.split('=', limit = 2)
                k to java.net.URLDecoder.decode(v, "UTF-8")
            }
        assertEquals("y67sprxhhpws", params["appId"])
        assertEquals("1728000000000", params["time"])
        // data 解出来应是可解密的 Base64（AES-ECB-PKCS5，直接传响应串）
        val data = params["data"]!!
        val crypto = cn.toside.music.core.crypto.Crypto
        val plain =
            crypto.aesDecrypt(
                data,
                "cFcnPcf6Kb85RC1y3V6M5A==",
                "",
                "AES/ECB/PKCS5Padding",
            )
        // 加密输入是 base64(json)，Crypto 内部先 decode 再加密 → 解密直接得 JSON 明文
        val inner = Json.parseToJsonElement(plain).jsonObject
        assertEquals("16", (inner["id"] as JsonPrimitive).content)
        assertEquals(0, (inner["pn"] as JsonPrimitive).content.toInt())
        assertEquals(100, (inner["rn"] as JsonPrimitive).content.toInt())
        // sign = MD5(appId + data + time).upper
        val md5 =
            java.security.MessageDigest
                .getInstance("MD5")
                .digest("y67sprxhhpws$data${params["time"]}".toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
                .uppercase()
        assertEquals(md5, params["sign"])
    }

    @Test
    fun `parse maps musiclist to music infos with sorted deduped qualities`() {
        val body =
            encryptResponse(
                """
                {"code":200,"data":{"total":"4","musiclist":[
                  {"id":"100","name":"晴天","artist":"周杰伦&费玉清","album":"叶惠美","albumId":"1",
                   "duration":"429","pic":"http://img/pic.jpg",
                   "n_minfo":"level:flac,bitrate:2000,format:flac,size:52.83MB;;level:mp3l,bitrate:128,format:mp3,size:4.12Mb;level:mp3h,bitrate:320,format:mp3,size:10.29MB;level:flac,bitrate:2000,format:flac,size:52.83MB"},
                  {"id":"101","name":"七里香","artist":"周杰伦","album":"七里香","albumId":"2",
                   "duration":"270","pic":"","n_minfo":"level:mp3l,bitrate:128,format:mp3,size:4.12Mb"}
                ]}}
                """.trimIndent(),
            )
        val parsed = KwLeaderboard.parse(body, bangid = "16", page = 1)!!

        assertEquals("kw", parsed.source)
        assertEquals(4, parsed.total)
        assertEquals(100, parsed.limit)
        assertEquals(2, parsed.list.size)

        val first = parsed.list[0]
        assertEquals("kw_100", (first["id"] as JsonPrimitive).content)
        assertEquals("晴天", (first["name"] as JsonPrimitive).content)
        assertEquals("周杰伦、费玉清", (first["singer"] as JsonPrimitive).content)
        assertEquals("07:09", (first["interval"] as JsonPrimitive).content)
        val meta = (first["meta"] as JsonObject)
        assertEquals("叶惠美", (meta["albumName"] as JsonPrimitive).content)
        assertEquals("http://img/pic.jpg", (meta["picUrl"] as JsonPrimitive).content)
        // 音质：flac 2000 重复被 Set 去重；排序按档位升序 128k → 320k → flac
        val qualitys = meta["qualitys"] as JsonArray
        assertEquals(
            listOf("128k", "320k", "flac"),
            qualitys.map { (it.jsonObject()["type"] as JsonPrimitive).content },
        )
        assertEquals("4.12MB", ((qualitys[0] as JsonObject)["size"] as JsonPrimitive).content)

        val second = parsed.list[1]
        val secondMeta = (second["meta"] as JsonObject)
        assertTrue(secondMeta["picUrl"] is kotlinx.serialization.json.JsonNull)
    }

    @Test
    fun `parse returns null when musiclist is missing`() {
        val body = encryptResponse("""{"code":200,"data":{"total":"0"}}""")
        assertNull(KwLeaderboard.parse(body, bangid = "16", page = 1))
    }

    @Test
    fun `getList retries then fails after max attempts`() =
        runBlocking {
            var calls = 0
            val leaderboard =
                KwLeaderboard(
                    fetch = { _ ->
                        calls++
                        encryptResponse("""{"code":200,"data":{"total":"0"}}""")
                    },
                )

            var error: Exception? = null
            try {
                leaderboard.getList("16", 1)
            } catch (e: Exception) {
                error = e
            }
            assertEquals(3, calls)
            assertTrue(error is IllegalStateException)
        }

    private fun encryptResponse(plainJson: String): String {
        val crypto = cn.toside.music.core.crypto.Crypto
        val cipher =
            crypto.aesEncrypt(
                java.util.Base64
                    .getEncoder()
                    .encodeToString(plainJson.toByteArray(Charsets.UTF_8)),
                "cFcnPcf6Kb85RC1y3V6M5A==",
                "",
                "AES/ECB/PKCS5Padding",
            )
        return java.net.URLEncoder.encode(cipher, "UTF-8")
    }

    private fun kotlinx.serialization.json.JsonElement.jsonObject(): JsonObject = this as JsonObject
}
