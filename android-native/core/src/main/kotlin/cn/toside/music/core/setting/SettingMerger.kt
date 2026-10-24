package cn.toside.music.core.setting

/**
 * 设置合并算法 —— 从 RN 侧 src/config/setting.ts 的 mergeSetting/updateSetting 移植。
 *
 * 行为（黄金测试锁死）：
 * - 只接受 primitive 值（string/boolean/number/null），非 primitive 跳过；
 * - 与原值相同或原值缺失的键跳过；
 * - 遍历方向：键少的一方（RN 原版优化遍历量）；
 * - 合并结果 version 恒为默认版本。
 */
object SettingMerger {
    data class MergeResult(
        val setting: Map<String, Any?>,
        val updatedKeys: List<String>,
        val updatedSetting: Map<String, Any?>,
    )

    private fun isPrimitive(value: Any?): Boolean =
        when (value) {
            null, is String, is Boolean, is Int, is Long, is Double, is Float -> true
            else -> false
        }

    fun merge(
        originSetting: Map<String, Any?>,
        targetSetting: Map<String, Any?>?,
    ): MergeResult {
        val originCopy = originSetting.toMutableMap()
        val updatedKeys = mutableListOf<String>()
        val updatedSetting = mutableMapOf<String, Any?>()

        if (targetSetting != null) {
            if (originCopy.size > targetSetting.size) {
                for (key in targetSetting.keys) {
                    val targetValue = targetSetting[key]
                    if (!isPrimitive(targetValue)) continue
                    if (targetValue == originCopy[key] || !originCopy.containsKey(key)) continue
                    updatedKeys.add(key)
                    updatedSetting[key] = targetValue
                    originCopy[key] = targetValue
                }
            } else {
                for (key in originCopy.keys) {
                    val targetValue = targetSetting[key] ?: continue
                    if (!isPrimitive(targetValue)) continue
                    if (targetValue == originCopy[key]) continue
                    updatedKeys.add(key)
                    updatedSetting[key] = targetValue
                    originCopy[key] = targetValue
                }
            }
        }

        return MergeResult(originCopy, updatedKeys, updatedSetting)
    }

    /** init：以默认表为底合并存量设置（对应 RN updateSetting(setting, true)）。 */
    fun initMerge(stored: Map<String, Any?>?): MergeResult {
        val result = merge(DefaultSetting.defaultSetting(), stored)
        val merged = result.setting.toMutableMap()
        merged["version"] = DefaultSetting.SETTING_VERSION
        return MergeResult(merged, result.updatedKeys, result.updatedSetting)
    }

    /** 版本比较（RN compareVer 语义）：curr < target 返回 -1，等返回 0，大于返回 1。 */
    fun compareVer(
        currentVer: String,
        targetVer: String,
    ): Int {
        val curr = currentVer.split('.').map { it.toIntOrNull() ?: 0 }
        val target = targetVer.split('.').map { it.toIntOrNull() ?: 0 }
        val len = maxOf(curr.size, target.size)
        for (i in 0 until len) {
            val c = curr.getOrElse(i) { 0 }
            val t = target.getOrElse(i) { 0 }
            if (c > t) return 1
            if (c < t) return -1
        }
        return 0
    }
}
