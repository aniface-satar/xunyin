package cn.toside.music.nativeapp.userapi

import cn.toside.music.core.setting.SettingsStore
import cn.toside.music.core.userapi.UserApiCatalog

/** 当前音源（RN `common.apiSource`）。 */
const val USER_API_SOURCE_SETTING_KEY = "common.apiSource"

/**
 * 「这次该用哪个音源」的裁决 —— RN `src/core/init/userApi/index.ts` 里
 * 当前源不在清单时换源那一段。
 *
 * 单独拆出来是因为它只依赖清单和设置两个接口，能在 JVM 用例里跑：
 * 「正在用的源被下架/删掉了要换成哪个」这种保命路径不该只在真机上才第一次被走到。
 */
class UserApiSourceSelector(
    private val store: UserApiSourceStore,
    private val settings: SettingsStore,
    private val settingKey: String = USER_API_SOURCE_SETTING_KEY,
    private val fallbackId: String = BuiltinSourceRepository.DEFAULT_SOURCE_ID,
) {
    /**
     * 返回要加载的源 id；清单里一个源都没有时返回 null。
     *
     * 设置里那个源不在了（下架、删掉、清了一半数据）就按 [UserApiCatalog.pickAvailableId]
     * 换一个还能用的，并把换的结果写回设置 —— 否则下次启动还要再猜一次。
     */
    suspend fun resolve(): String? {
        val preferred = settings.string(settingKey).ifEmpty { fallbackId }
        val target = UserApiCatalog.pickAvailableId(store.list(), preferred)
        if (target.isEmpty()) return null
        if (target != preferred) settings.set(settingKey, target)
        return target
    }

    /** 用户手动换源：调用方确认脚本真的起来之后才写设置。 */
    suspend fun select(sourceId: String) {
        settings.set(settingKey, sourceId)
    }
}
