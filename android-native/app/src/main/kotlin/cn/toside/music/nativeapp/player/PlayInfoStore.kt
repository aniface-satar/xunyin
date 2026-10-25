package cn.toside.music.nativeapp.player

import android.content.Context
import cn.toside.music.core.player.SavedPlayInfo
import cn.toside.music.core.player.SavedPlayInfoCodec
import cn.toside.music.core.player.SavedPlayInfoStorage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 播放进度落盘 —— RN `utils/data.ts#savePlayInfo/getPlayInfo`（AsyncStorage 的
 * `storageDataPrefix.playInfo`）的对应物。
 *
 * 单独一个 SharedPreferences 文件：设置表是「用户偏好」，且每次 set 都整表写回；
 * 进度每秒级更新混进去会把设置文件放大成热写入点。
 */
class PlayInfoStore(
    context: Context,
) : SavedPlayInfoStorage {
    private val prefs =
        context.applicationContext.getSharedPreferences(
            PREF_NAME,
            Context.MODE_PRIVATE,
        )

    override suspend fun save(info: SavedPlayInfo) {
        withContext(Dispatchers.IO) {
            prefs.edit().putString(KEY, SavedPlayInfoCodec.encode(info)).apply()
        }
    }

    override suspend fun load(): SavedPlayInfo? =
        withContext(Dispatchers.IO) {
            SavedPlayInfoCodec.decode(prefs.getString(KEY, null))
        }

    companion object {
        private const val PREF_NAME = "xunyin_play_info"
        private const val KEY = "playInfo"
    }
}
