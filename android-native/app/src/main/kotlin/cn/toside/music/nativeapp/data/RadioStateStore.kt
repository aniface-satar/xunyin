package cn.toside.music.nativeapp.data

import android.content.Context
import cn.toside.music.core.recommend.radio.RadioState
import cn.toside.music.core.recommend.radio.RadioStateCodec
import cn.toside.music.core.storage.ShardedKvStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 电台状态落盘 —— RN `core/recommend/storage.ts` 的键位等价物。
 *
 * 单独一个键（不分片到设置表）：电台状态是「派生学习数据」，
 * 写频率由编排层的 1500ms 防抖控制，混进 `@setting_v1` 会把设置表写成热写点。
 * 编解码由 `:core` 的 [RadioStateCodec] 负责，解析失败按冷启动处理。
 */
class RadioStateStore(
    context: Context,
) {
    private val kv = ShardedKvStore(DataStoreKvStore(context.applicationContext))

    suspend fun read(): RadioState? =
        withContext(Dispatchers.IO) {
            RadioStateCodec.decode(runCatching { kv.getString(STATE_KEY) }.getOrNull())
        }

    suspend fun write(state: RadioState) {
        withContext(Dispatchers.IO) {
            runCatching { kv.saveString(STATE_KEY, RadioStateCodec.encode(state)) }
        }
    }

    suspend fun clear() {
        withContext(Dispatchers.IO) { runCatching { kv.removeData(STATE_KEY) } }
    }

    companion object {
        /** 与 RN 的 `xunyin_recommend_state_v2` 分开存：形状不同，互不解析。 */
        const val STATE_KEY = "xunyin_recommend_radio_state_v1"
    }
}
