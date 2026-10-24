package cn.toside.music.core.storage

/**
 * 存储键名表 —— 从 RN 侧 src/config/constant.ts 的 storageDataPrefix 全量移植。
 *
 * 迁移兼容：DataStore 里沿用相同的键名，使老版本（RN）数据在原生版可读
 * （B7 双通道并行期间两版读写同一存储语义）。
 */
object StorageKeys {
    const val SETTING = "@setting_v1"
    const val USER_LIST = "@user_list"
    const val VIEW_PREV_STATE = "@view_prev_state"

    const val LIST_PREFIX = "@list__"
    const val LIST_SCROLL_POSITION = "@list_scroll_position"
    const val LIST_PREV_SELECT_ID = "@list_prev_select_id"

    const val LYRIC_PREFIX = "@lyric__"
    const val MUSIC_URL_PREFIX = "@music_url__"
    const val MUSIC_OTHER_SOURCE_PREFIX = "@music_other_source__"
    const val PLAY_INFO = "@play_info"
    const val PLAYLIST_HISTORY = "@playlist_history"
    const val PLAY_HISTORY = "@play_history"
    const val TEMP_LIST_META = "@temp_list_meta"

    const val SYNC_AUTH_KEY_PREFIX = "@sync_auth_key"
    const val SYNC_HOST = "@sync_host"
    const val SYNC_HOST_HISTORY = "@sync_host_history"

    const val OPEN_STORAGE_PATH = "@open_storage_path"
    const val SELECTED_MANAGED_FOLDER = "@selected_managed_folder"
    const val NOTIFICATION_TIP_ENABLE = "@notification_tip_enable"
    const val IGNORING_BATTERY_OPTIMIZATION_TIP_ENABLE = "@ignoring_battery_optimization_tip_enable"

    const val SEARCH_HISTORY_LIST = "@search_history_list"
    const val LIST_UPDATE_INFO = "@list_update_info"
    const val IGNORE_VERSION = "@ignore_version"
    const val IGNORE_VERSION_FAIL_TIP_TIME = "@ignore_version_fail_tip_time"
    const val NOTICE_ID = "@notice_id"
    const val LEADERBOARD_SETTING = "@leaderboard_setting"
    const val SONG_LIST_SETTING = "@songist_setting"
    const val SEARCH_SETTING = "@search_setting"

    const val FONT_SIZE = "@font_size"

    const val THEME = "@theme"

    const val CHEAT_TIP = "@cheat_tip"
    const val REMOTE_LYRIC_TIP = "@remote_lyric_tip"

    const val DISLIKE_LIST_PREFIX = "@dislike_list"
    const val DOWNLOAD_LIST = "@download_list"

    const val USER_API_PREFIX = "@user_api__"

    const val MUSIC_ADD_TIME = "@music_add_time"
    const val MUSIC_PLAY_COUNT = "@music_play_count"

    // v0.x.x 旧版键（迁移读取用）
    object Legacy {
        const val SETTING = "@setting"
        const val LIST_POSITION_PREFIX = "@listposition__"
        const val LIST_SORT_PREFIX = "@listsort__"
    }

    /** 固定列表 id —— 对应 RN LIST_IDS。 */
    object ListIds {
        const val DEFAULT = "default"
        const val LOVE = "love"
        const val TEMP = "temp"
        const val DOWNLOAD = "download"
    }
}
