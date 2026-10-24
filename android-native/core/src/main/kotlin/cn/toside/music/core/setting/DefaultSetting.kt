package cn.toside.music.core.setting

/**
 * 应用设置默认值 —— 从 RN 侧 src/config/defaultSetting.ts 全量移植。
 *
 * 值类型：String / Boolean / Int / null（与 RN 的 primitive 一致）。
 * 新年皮肤逻辑（1、2 月切主题）保留：defaultSetting() 按当前月份返回。
 */
object DefaultSetting {
    const val DEFAULT_BUILTIN_API_SOURCE_ID = "builtin_xinghai"
    const val SETTING_VERSION = "2.2"

    /** 完整默认表（不含新年皮肤切换）。 */
    val base: Map<String, Any?> =
        mapOf(
            "version" to SETTING_VERSION,
            "common.isAutoTheme" to false,
            "common.langId" to null,
            "common.apiSource" to DEFAULT_BUILTIN_API_SOURCE_ID,
            "common.userApiUpdateCheck" to "daily",
            "common.userApiAllowShowUpdateAlert" to false,
            "common.userApiAutoUpdate" to true,
            "common.sourceNameType" to "alias",
            "common.shareType" to "system",
            "common.isAgreePact" to false,
            "common.autoHidePlayBar" to true,
            "common.drawerLayoutPosition" to "left",
            "common.allowProgressBarSeek" to true,
            "common.showBackBtn" to false,
            "common.showExitBtn" to true,
            "common.useSystemFileSelector" to true,
            "common.alwaysKeepStatusbarHeight" to false,
            "player.startupAutoPlay" to false,
            "player.startupPushPlayDetailScreen" to false,
            "player.togglePlayMethod" to "listLoop",
            "player.playQuality" to "128k",
            "player.isSavePlayTime" to false,
            "player.volume" to 1.0,
            "player.playbackRate" to 1.0,
            "player.cacheSize" to "1024",
            "player.preloadNextMusic" to true,
            "player.preloadNextMusicAudio" to "head",
            "player.timeoutExit" to "",
            "player.timeoutExitPlayed" to true,
            "player.isAutoCleanPlayedList" to false,
            "player.isHandleAudioFocus" to true,
            "player.isEnableAudioOffload" to true,
            "player.isEnableVolumeBalancer" to false,
            "player.volumeBalancerLevel" to "mid",
            "player.isShowLyricTranslation" to true,
            "player.isShowLyricRoma" to false,
            "player.isShowNotificationImage" to true,
            "player.isS2t" to false,
            "player.isShowBluetoothLyric" to false,
            "player.isShowBluetoothFullLyric" to false,
            "playDetail.style.align" to "left",
            "playDetail.vertical.style.lrcFontSize" to 210,
            "playDetail.horizontal.style.lrcFontSize" to 220,
            "playDetail.isShowLyricProgressSetting" to true,
            "desktopLyric.enable" to false,
            "desktopLyric.isLock" to false,
            "desktopLyric.width" to 100,
            "desktopLyric.maxLineNum" to 5,
            "desktopLyric.isSingleLine" to false,
            "desktopLyric.showToggleAnima" to true,
            "desktopLyric.position.x" to 0,
            "desktopLyric.position.y" to 0,
            "desktopLyric.textPosition.x" to "left",
            "desktopLyric.textPosition.y" to "top",
            "desktopLyric.style.fontSize" to 180,
            "desktopLyric.style.opacity" to 100,
            "desktopLyric.style.lyricUnplayColor" to "rgba(255, 255, 255, 1)",
            "desktopLyric.style.lyricPlayedColor" to "rgba(7, 197, 86, 1)",
            "desktopLyric.style.lyricShadowColor" to "rgba(0, 0, 0, 0.6)",
            "search.isShowHotSearch" to false,
            "search.isShowHistorySearch" to false,
            "list.isShowSource" to true,
            "list.isShowAlbumName" to false,
            "list.isShowInterval" to true,
            "list.isSaveScrollLocation" to true,
            "list.addMusicLocationType" to "top",
            "list.isClickPlayList" to false,
            "download.fileName" to "歌名 - 歌手",
            "download.savePath" to "",
            "download.savePathName" to "",
            "shareCard.savePath" to "",
            "shareCard.savePathName" to "",
            "sync.enable" to false,
            "theme.id" to "cyan",
            "theme.lightId" to "cyan",
            "theme.darkId" to "black",
            "theme.hideBgDark" to false,
            "theme.fontShadow" to false,
            "theme.dynamicBg" to true,
            "theme.dynamicBgAlgorithm" to "blur",
        )

    /**
     * 默认设置表（含 RN 侧新年皮肤逻辑：1、2 月使用 happy_new_year 主题）。
     * @param month 当前月份（1-12；测试注入）
     */
    fun defaultSetting(month: Int = currentMonth()): Map<String, Any?> =
        if (month < 3) {
            base.toMutableMap().apply {
                put("theme.id", "happy_new_year")
                put("desktopLyric.style.lyricPlayedColor", "rgba(255, 18, 34, 1)")
            }
        } else {
            base
        }

    private fun currentMonth(): Int =
        java.time.LocalDate
            .now()
            .monthValue
}
